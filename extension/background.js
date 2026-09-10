import {
  REVIEW_IDLE_MS,
  appendBounded,
  appendFailedEntries,
  isCandidatePageState,
  isPermanentUploadStatus,
  isSupportedStudyHostURL,
  isTrackedStudyURL,
  isTrustedExtensionPageSender,
  isValidPageState,
  nextUploadBatch,
  normalizeQueueEntry,
  partitionQueueAfterResponse,
  savedSessionIDs,
  sessionEndTime,
  sessionStartTime,
  shouldForgetTabStateAfterDisconnect,
  studyActivityForTrackingType,
  studyActivityForURL,
  studySessionPayload,
  trackingTransition,
} from "./lib/session.js";
import {
  base64ToBlob,
  buildAudioRecognitionCardPayload,
  createULID,
  isSupportedMediaURL,
} from "./lib/card.js";

const API_BASE_URL = "https://convo-lab.com";
const TOKEN_KEY = "convoLabAccessToken";
const USER_KEY = "convoLabUser";
// Retain the original storage keys so an extension upgrade cannot strand an
// active WaniKani session or any retry-safe queued uploads.
const ACTIVE_KEY = "activeWaniKaniSession";
const QUEUE_KEY = "pendingWaniKaniSessionsByUser";
const DEAD_LETTER_KEY = "failedWaniKaniSessionsByUser";
const FAILED_OVERFLOW_KEY = "failedWaniKaniSessionOverflowByUser";
const ERROR_KEY = "lastSyncError";
const TRACKING_ERROR_KEY = "lastTrackingError";
const BROWSER_SESSION_KEY = "convoLabBrowserSession";
const ALARM_NAME = "convoLabWaniKaniReconcile";
const MIN_SESSION_MS = 1_000;
const MAX_PENDING_SESSIONS = 1_000;
const MAX_FAILED_SESSIONS = 20;
const MAX_UPLOAD_ATTEMPTS = 3;
const MEDIA_CAPTURE_TAB_KEY = "convoLabMediaCaptureTabId";
const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
const MAX_CAPTURED_AUDIO_BASE64_LENGTH = 14 * 1024 * 1024;

const tabStates = new Map();
let work = Promise.resolve();

function serialize(operation) {
  work = work.then(operation, operation);
  return work;
}

function runTracking(operation) {
  serialize(operation)
    .then(() => chrome.storage.local.remove(TRACKING_ERROR_KEY))
    .catch(async (error) => {
      console.error("ConvoLab tracking failed", error);
      await chrome.storage.local.set({
        [TRACKING_ERROR_KEY]: `Tracking paused: ${error.message}`,
      });
    });
}

async function stored(keys) {
  return chrome.storage.local.get(keys);
}

async function updateBadge(active) {
  const activity = active
    ? studyActivityForTrackingType(active.trackingType)
    : null;
  await chrome.action.setBadgeBackgroundColor({ color: "#143A66" });
  await chrome.action.setBadgeText({ text: active ? "●" : "" });
  await chrome.action.setTitle({
    title: activity
      ? `ConvoLab is recording ${activity.recordingLabel}`
      : "ConvoLab Study Tracker",
  });
}

async function fetchJSON(path, { token, method = "GET", body } = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: requestHeaders(token, body),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await responsePayload(response);
  if (!response.ok) {
    const error = new Error(payload?.message || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function fetchForm(path, { token, body }) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const validationMessage = payload?.errors
      ? Object.values(payload.errors).flat().find((value) => typeof value === "string")
      : null;
    const error = new Error(validationMessage || payload?.message || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
  });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ["USER_MEDIA"],
    justification: "Keep a rolling tab-audio buffer so selected dialogue can be trimmed into a study card.",
  });
}

async function sendToOffscreen(message) {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({ ...message, target: "offscreen" });
  if (!response?.ok) throw new Error(response?.error || "The audio recorder did not respond.");
  return response.result;
}

async function capturedTabId() {
  const values = await chrome.storage.session.get(MEDIA_CAPTURE_TAB_KEY);
  return Number.isInteger(values[MEDIA_CAPTURE_TAB_KEY]) ? values[MEDIA_CAPTURE_TAB_KEY] : null;
}

async function notifyMediaMode(tabId, enabled) {
  if (!Number.isInteger(tabId)) return;
  await chrome.tabs.sendMessage(tabId, { type: "SET_MEDIA_MODE", enabled }).catch(() => {});
}

async function stopMediaMode(tabId = null) {
  const resolvedTabId = tabId ?? await capturedTabId();
  await sendToOffscreen({ type: "STOP_MEDIA_CAPTURE" }).catch(() => {});
  await chrome.storage.session.remove(MEDIA_CAPTURE_TAB_KEY);
  await notifyMediaMode(resolvedTabId, false);
}

async function startMediaMode() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isSupportedMediaURL(tab.url)) {
    throw new Error("Open a Netflix or YouTube video before enabling dialogue capture.");
  }
  const previousTabId = await capturedTabId();
  if (previousTabId && previousTabId !== tab.id) await stopMediaMode(previousTabId);
  await ensureOffscreenDocument();
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  await sendToOffscreen({ type: "START_MEDIA_CAPTURE", streamId, tabId: tab.id });
  await chrome.storage.session.set({ [MEDIA_CAPTURE_TAB_KEY]: tab.id });
  await notifyMediaMode(tab.id, true);
  return status();
}

async function createCapturedAudioCard(message) {
  const values = await stored([TOKEN_KEY]);
  const token = values[TOKEN_KEY];
  if (!token) throw new Error("Sign in to ConvoLab before creating a card.");
  if (
    typeof message.audioBase64 !== "string"
    || message.audioBase64.length < 60
    || message.audioBase64.length > MAX_CAPTURED_AUDIO_BASE64_LENGTH
  ) {
    throw new Error("The captured audio is invalid or too large.");
  }
  if (!isSupportedMediaURL(message.sourceUrl)) throw new Error("The card source is not supported.");
  const cardId = createULID();
  const cardPayload = buildAudioRecognitionCardPayload({
    id: cardId,
    japanese: message.japanese,
    english: message.english,
    sourceUrl: message.sourceUrl,
    sourceTitle: message.sourceTitle,
  });
  const card = await fetchJSON("/api/study/cards", {
    token,
    method: "POST",
    body: cardPayload,
  });
  let withAudio;
  try {
    const form = new FormData();
    form.append("audio", base64ToBlob(message.audioBase64), `convolab-${cardId.toLowerCase()}.wav`);
    withAudio = await fetchForm(`/api/study/cards/${encodeURIComponent(card.syncId || cardId)}/audio`, {
      token,
      body: form,
    });
  } catch (error) {
    await fetchJSON(`/api/study/cards/${encodeURIComponent(card.syncId || cardId)}`, {
      token,
      method: "DELETE",
    }).catch(() => {});
    throw error;
  }
  let promoted = true;
  try {
    await fetchJSON(`/api/study/new-queue/${encodeURIComponent(withAudio.syncId || card.syncId || cardId)}/promote`, {
      token,
      method: "POST",
    });
  } catch {
    promoted = false;
  }
  return { card: withAudio, promoted };
}

function requestHeaders(token, body) {
  return {
    Accept: "application/json",
    ...(body ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function responsePayload(response) {
  return response.status === 204
    ? null
    : response.json().catch(() => null);
}

async function candidateState(now) {
  const idleState = await chrome.idle.queryState(REVIEW_IDLE_MS / 1_000);
  if (idleState !== "active") {
    return { state: null };
  }

  for (const state of tabStates.values()) {
    if (!isCandidatePageState(state, now)) {
      continue;
    }
    const inspected = await inspectCandidateState(state);
    if (inspected.candidate) {
      return { state: inspected.candidate };
    }
    if (inspected.shouldForget) {
      tabStates.delete(state.tabId);
    }
  }
  return { state: null };
}

async function inspectCandidateState(state) {
  try {
    const tab = await chrome.tabs.get(state.tabId);
    const browserWindow = await chrome.windows.get(tab.windowId);
    const activity = studyActivityForURL(tab.url);
    const stateActivity = studyActivityForURL(state.url);
    const matchingActivity = hasMatchingActivity(activity, stateActivity);
    if (matchingActivity && isFocusedTab(tab, browserWindow)) {
      return {
        candidate: { ...state, trackingType: activity.trackingType },
        shouldForget: false,
      };
    }
    return {
      candidate: null,
      shouldForget: !matchingActivity,
    };
  } catch {
    return { candidate: null, shouldForget: true };
  }
}

function hasMatchingActivity(activity, stateActivity) {
  return Boolean(activity)
    && activity.trackingType === stateActivity?.trackingType;
}

function isFocusedTab(tab, browserWindow) {
  return tab.active && browserWindow.focused;
}

async function restoreTabStates() {
  const tabs = await chrome.tabs.query({
    url: [
      "https://wanikani.com/*",
      "https://*.wanikani.com/*",
      "https://satorireader.com/*",
      "https://www.satorireader.com/*",
    ],
  });
  await Promise.all(tabs.map(async (tab) => {
    try {
      let state = null;
      try {
        state = await chrome.tabs.sendMessage(tab.id, {
          type: "REQUEST_TRACKED_PAGE_STATE",
        });
      } catch {
        // An open tab may still be running the previous content-script version.
      }
      if (!state && studyActivityForURL(tab.url)?.trackingType === "wanikani") {
        state = await chrome.tabs.sendMessage(tab.id, {
          type: "REQUEST_WANIKANI_STATE",
        });
      }
      if (isValidPageState(tab, state)) {
        const activity = studyActivityForURL(state.url);
        tabStates.set(tab.id, {
          tabId: tab.id,
          url: state.url,
          trackingType: activity.trackingType,
          visible: state.visible,
          lastInteractionAt: Number.isFinite(state.lastInteractionAt)
            ? Math.min(Date.now(), state.lastInteractionAt)
            : null,
        });
      }
    } catch {
      // Tabs opened before installation have no content script until reloaded.
    }
  }));
}

async function startSession(state, now) {
  const values = await stored([TOKEN_KEY, USER_KEY]);
  if (!values[TOKEN_KEY] || !values[USER_KEY]?.id) {
    return;
  }
  const startedAt = sessionStartTime(now);
  const active = {
    clientSessionId: crypto.randomUUID(),
    userId: String(values[USER_KEY].id),
    tabId: state.tabId,
    trackingType: state.trackingType,
    startedAt,
    lastInteractionAt: Math.max(startedAt, state.lastInteractionAt || startedAt),
  };
  await chrome.storage.local.set({ [ACTIVE_KEY]: active });
  await updateBadge(active);
}

async function finishSession({ now = Date.now() } = {}) {
  const values = await stored([
    ACTIVE_KEY,
    QUEUE_KEY,
    DEAD_LETTER_KEY,
    FAILED_OVERFLOW_KEY,
  ]);
  const active = values[ACTIVE_KEY];
  if (!active) {
    await updateBadge(null);
    return;
  }

  const endedAt = sessionEndTime({
    startedAt: active.startedAt,
    now,
    lastInteractionAt: active.lastInteractionAt,
  });
  const queues = values[QUEUE_KEY] || {};
  const failedQueues = values[DEAD_LETTER_KEY] || {};
  const failedOverflow = values[FAILED_OVERFLOW_KEY] || {};
  if (endedAt - active.startedAt >= MIN_SESSION_MS) {
    queueCompletedSession({
      active,
      endedAt,
      queues,
      failedQueues,
      failedOverflow,
    });
  }
  await chrome.storage.local.set({
    [QUEUE_KEY]: queues,
    [DEAD_LETTER_KEY]: failedQueues,
    [FAILED_OVERFLOW_KEY]: failedOverflow,
  });
  await chrome.storage.local.remove(ACTIVE_KEY);
  await updateBadge(null);
}

function queueCompletedSession({
  active,
  endedAt,
  queues,
  failedQueues,
  failedOverflow,
}) {
  const userQueue = (queues[active.userId] || []).map(normalizeQueueEntry);
  const appended = appendBounded(
    userQueue,
    { session: studySessionPayload(active, endedAt), attempts: 0 },
    MAX_PENDING_SESSIONS,
  );
  queues[active.userId] = appended.items;
  const failedResult = appendFailedEntries(
    failedQueues[active.userId] || [],
    failedOverflow[active.userId] || 0,
    appended.dropped,
    "Queue capacity exceeded",
    MAX_FAILED_SESSIONS,
  );
  failedQueues[active.userId] = failedResult.items;
  failedOverflow[active.userId] = failedResult.overflowCount;
}

async function reconcile(now = Date.now()) {
  const values = await stored([ACTIVE_KEY, TOKEN_KEY, USER_KEY]);
  const active = values[ACTIVE_KEY];
  if (!hasSignedInUser(values)) {
    await finishSignedOutSession(active, now);
    return;
  }
  const candidate = await candidateState(now);
  const transition = resolvedTrackingTransition(active, candidate.state);

  switch (transition) {
    case "none":
      return;
    case "stop":
      await stopSession(active, now);
      return;
    case "start":
      await startSession(candidate.state, now);
      return;
    case "switch":
      await switchSession(candidate.state, now);
      return;
    default:
      await continueSession(active, candidate.state);
  }
}

function hasSignedInUser(values) {
  return Boolean(values[TOKEN_KEY] && values[USER_KEY]?.id);
}

async function finishSignedOutSession(active, now) {
  if (active) {
    await finishSession({ now });
  }
}

function resolvedTrackingTransition(active, candidate) {
  return trackingTransition({
    activeTabId: active?.tabId ?? null,
    candidateTabId: candidate?.tabId ?? null,
    activeTrackingType: active
      ? studyActivityForTrackingType(active.trackingType).trackingType
      : null,
    candidateTrackingType: candidate?.trackingType ?? null,
  });
}

async function stopSession(active, now) {
  if (active) {
    await finishSession({ now });
    await flushPending();
  }
}

async function switchSession(candidate, now) {
  await finishSession({ now });
  await startSession(candidate, now);
  await flushPending();
}

async function continueSession(active, candidate) {
  if (candidate.lastInteractionAt > active.lastInteractionAt) {
    active.lastInteractionAt = candidate.lastInteractionAt;
    await chrome.storage.local.set({ [ACTIVE_KEY]: active });
  }
  await updateBadge(active);
}

async function uploadEntries(entries, token) {
  try {
    const saved = await fetchJSON("/api/study/activity-sessions/batch", {
      token,
      method: "POST",
      body: { sessions: entries.map((entry) => entry.session) },
    });
    return partitionQueueAfterResponse(
      entries,
      savedSessionIDs(saved),
      {
        batchSize: entries.length,
        maxAttempts: MAX_UPLOAD_ATTEMPTS,
      },
    );
  } catch (error) {
    if (!isPermanentUploadStatus(error.status)) {
      throw error;
    }
    if (entries.length === 1) {
      return partitionQueueAfterResponse(
        entries,
        new Set(),
        { batchSize: 1, maxAttempts: MAX_UPLOAD_ATTEMPTS },
      );
    }
    const midpoint = Math.ceil(entries.length / 2);
    const left = await uploadEntries(entries.slice(0, midpoint), token);
    const right = await uploadEntries(entries.slice(midpoint), token);
    return {
      remaining: [...left.remaining, ...right.remaining],
      failed: [...left.failed, ...right.failed],
    };
  }
}

async function flushPending() {
  const values = await stored([
    TOKEN_KEY,
    USER_KEY,
    QUEUE_KEY,
    DEAD_LETTER_KEY,
    FAILED_OVERFLOW_KEY,
  ]);
  const pending = pendingUpload(values);
  if (!pending) {
    return;
  }

  try {
    const batch = nextUploadBatch(pending.queue);
    const result = await uploadEntries(batch, pending.token);
    await saveUploadResult(values, pending, batch.length, result);
  } catch (error) {
    await recordUploadError(error);
  }
}

function pendingUpload(values) {
  const token = values[TOKEN_KEY];
  const userId = values[USER_KEY]?.id;
  const userKey = userId ? String(userId) : null;
  const queues = values[QUEUE_KEY] || {};
  const queue = userKey
    ? (queues[userKey] || []).map(normalizeQueueEntry)
    : [];
  return token && queue.length > 0
    ? { token, userKey, queue, queues }
    : null;
}

async function saveUploadResult(values, pending, batchSize, result) {
  pending.queues[pending.userKey] = [
    ...result.remaining,
    ...pending.queue.slice(batchSize),
  ];
  const failedQueues = values[DEAD_LETTER_KEY] || {};
  const failedOverflow = values[FAILED_OVERFLOW_KEY] || {};
  const failedResult = appendFailedEntries(
    failedQueues[pending.userKey] || [],
    failedOverflow[pending.userKey] || 0,
    result.failed,
    "Server did not accept the session",
    MAX_FAILED_SESSIONS,
  );
  failedQueues[pending.userKey] = failedResult.items;
  failedOverflow[pending.userKey] = failedResult.overflowCount;
  await chrome.storage.local.set({
    [QUEUE_KEY]: pending.queues,
    [DEAD_LETTER_KEY]: failedQueues,
    [FAILED_OVERFLOW_KEY]: failedOverflow,
    [ERROR_KEY]: null,
  });
}

async function recordUploadError(error) {
  if (error.status === 401) {
    await chrome.storage.local.remove(TOKEN_KEY);
  }
  await chrome.storage.local.set({
    [ERROR_KEY]: error.status === 401
      ? "ConvoLab sign-in expired. Sign in again to sync."
      : error.message,
  });
}

async function signIn(email, password) {
  const response = await fetchJSON("/api/auth/tokens", {
    method: "POST",
    body: {
      email,
      password,
      device_name: "ConvoLab Study Tracker Chrome Extension",
    },
  });
  const token = response?.data?.token;
  if (!token) {
    throw new Error("ConvoLab did not return an access token.");
  }
  const user = await fetchJSON("/api/me", { token });
  await chrome.storage.local.set({
    [TOKEN_KEY]: token,
    [USER_KEY]: user.data,
    [ERROR_KEY]: null,
  });
  await reconcile();
  await flushPending();
  return user.data;
}

async function signOut() {
  await stopMediaMode();
  await finishSession();
  await flushPending();
  const values = await stored(TOKEN_KEY);
  if (values[TOKEN_KEY]) {
    await fetchJSON("/api/auth/tokens/current", {
      token: values[TOKEN_KEY],
      method: "DELETE",
    }).catch(() => {});
  }
  await chrome.storage.local.remove([TOKEN_KEY, USER_KEY, ERROR_KEY]);
}

async function status() {
  const values = await stored([
    TOKEN_KEY,
    USER_KEY,
    ACTIVE_KEY,
    QUEUE_KEY,
    DEAD_LETTER_KEY,
    FAILED_OVERFLOW_KEY,
    ERROR_KEY,
    TRACKING_ERROR_KEY,
  ]);
  const active = values[ACTIVE_KEY];
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const mediaCaptureTabId = await capturedTabId();
  const queueStatus = storedQueueStatus(values);
  return {
    signedIn: Boolean(values[TOKEN_KEY]),
    user: values[USER_KEY] || null,
    tracking: Boolean(active),
    trackingLabel: active
      ? studyActivityForTrackingType(active.trackingType).recordingLabel
      : null,
    pendingCount: queueStatus.pendingCount,
    failedCount: queueStatus.failedCount,
    error: values[TRACKING_ERROR_KEY] || values[ERROR_KEY] || null,
    mediaSupported: Boolean(activeTab?.id && isSupportedMediaURL(activeTab.url)),
    mediaCaptureActive: Boolean(activeTab?.id && mediaCaptureTabId === activeTab.id),
  };
}

function storedQueueStatus(values) {
  const userId = values[USER_KEY]?.id;
  if (!userId) {
    return { pendingCount: 0, failedCount: 0 };
  }
  const userKey = String(userId);
  const queues = storedCollection(values, QUEUE_KEY);
  const failedQueues = storedCollection(values, DEAD_LETTER_KEY);
  const failedOverflow = storedCollection(values, FAILED_OVERFLOW_KEY);
  return {
    pendingCount: storedEntries(queues, userKey).length,
    failedCount: storedEntries(failedQueues, userKey).length
      + storedCount(failedOverflow, userKey),
  };
}

function storedCollection(values, key) {
  return values[key] || {};
}

function storedEntries(collection, key) {
  return collection[key] || [];
}

function storedCount(collection, key) {
  return collection[key] || 0;
}

async function signInFromMessage(message) {
  if (typeof message.email !== "string" || typeof message.password !== "string") {
    throw new Error("Email and password are required.");
  }
  await signIn(message.email.trim(), message.password);
  return status();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message !== "object") {
    return false;
  }

  if (
    message.type === "TRACKED_PAGE_STATE"
    || message.type === "WANIKANI_PAGE_STATE"
  ) {
    if (!isValidPageState(sender.tab, message)) {
      return false;
    }
    const activity = studyActivityForURL(message.url);
    tabStates.set(sender.tab.id, {
      tabId: sender.tab.id,
      url: message.url,
      trackingType: activity.trackingType,
      visible: message.visible,
      lastInteractionAt: Number.isFinite(message.lastInteractionAt)
        ? Math.min(Date.now(), message.lastInteractionAt)
        : null,
    });
    runTracking(() => reconcile());
    return false;
  }

  const supportedMediaSender = Boolean(
    sender.tab?.id
    && isSupportedMediaURL(sender.tab.url)
  );
  if (
    supportedMediaSender
    && ["GET_MEDIA_MODE_STATE", "GET_AUDIO_WINDOW", "CREATE_MEDIA_CARD"].includes(message.type)
  ) {
    const mediaOperation = async () => {
      const activeTabId = await capturedTabId();
      if (message.type === "GET_MEDIA_MODE_STATE") {
        return { enabled: activeTabId === sender.tab.id };
      }
      if (activeTabId !== sender.tab.id) {
        throw new Error("Enable dialogue capture for this tab first.");
      }
      if (message.type === "GET_AUDIO_WINDOW") {
        if (
          !Number.isFinite(message.startTimeMs)
          || !Number.isFinite(message.endTimeMs)
          || message.endTimeMs <= message.startTimeMs
          || message.endTimeMs - message.startTimeMs > 60_000
        ) {
          throw new Error("The requested audio window is invalid.");
        }
        return sendToOffscreen({
          type: "GET_AUDIO_WINDOW",
          startTimeMs: message.startTimeMs,
          endTimeMs: message.endTimeMs,
        });
      }
      return createCapturedAudioCard(message);
    };
    serialize(mediaOperation)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (
    message.type === "MEDIA_CAPTURE_ENDED"
    && sender.url === chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)
  ) {
    const endedTabId = message.tabId;
    serialize(async () => {
      if (await capturedTabId() === endedTabId) {
        await chrome.storage.session.remove(MEDIA_CAPTURE_TAB_KEY);
        await notifyMediaMode(endedTabId, false);
      }
    }).catch(() => {});
    return false;
  }

  if (!isTrustedExtensionPageSender(sender, chrome.runtime.id)) {
    return false;
  }

  const popupOperation = async () => {
    switch (message.type) {
      case "GET_STATUS":
        return status();
      case "SIGN_IN":
        return signInFromMessage(message);
      case "SIGN_OUT":
        await signOut();
        return status();
      case "SYNC_NOW":
        await flushPending();
        return status();
      case "START_MEDIA_MODE":
        return startMediaMode();
      case "STOP_MEDIA_MODE":
        await stopMediaMode();
        return status();
      default:
        throw new Error("Unsupported extension message.");
    }
  };

  serialize(popupOperation)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (
    !["tracked-page-lifecycle", "wanikani-page-lifecycle"].includes(port.name)
    || port.sender?.id !== chrome.runtime.id
    || !port.sender.tab?.id
    || !isSupportedStudyHostURL(port.sender.tab.url)
  ) {
    port.disconnect();
    return;
  }
  const tabId = port.sender.tab.id;
  port.onDisconnect.addListener(() => {
    runTracking(async () => {
      let tab = null;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch {
        // The tab was closed.
      }
      if (!shouldForgetTabStateAfterDisconnect(tab)) {
        return;
      }
      tabStates.delete(tabId);
      await reconcile();
    });
  });
});

chrome.tabs.onActivated.addListener(() => runTracking(() => reconcile()));
chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
  capturedTabId().then((captureTabId) => {
    if (captureTabId === tabId) stopMediaMode(tabId).catch(() => {});
  });
  runTracking(() => reconcile());
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url && !isTrackedStudyURL(changeInfo.url)) {
    tabStates.delete(tabId);
  }
  runTracking(() => reconcile());
});
chrome.windows.onFocusChanged.addListener(() => runTracking(() => reconcile()));
chrome.idle.onStateChanged.addListener(() => runTracking(() => reconcile()));
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runTracking(async () => {
      await reconcile();
      await flushPending();
    });
  }
});
chrome.runtime.onInstalled.addListener(() => runTracking(() => reconcile()));

async function initialize() {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await chrome.idle.setDetectionInterval(REVIEW_IDLE_MS / 1_000);
  const browserSession = await chrome.storage.session.get(BROWSER_SESSION_KEY);
  if (!browserSession[BROWSER_SESSION_KEY]) {
    await finishSession();
    await chrome.storage.session.set({ [BROWSER_SESSION_KEY]: crypto.randomUUID() });
  }
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  await restoreTabStates();
  await reconcile();
  await flushPending();
}

runTracking(initialize);

export {
  hasMatchingActivity,
  isFocusedTab,
  pendingUpload,
  recordUploadError,
  resolvedTrackingTransition,
  saveUploadResult,
  storedQueueStatus,
};
