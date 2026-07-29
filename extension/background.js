import {
  REVIEW_IDLE_MS,
  isCandidatePageState,
  isWaniKaniURL,
  savedSessionIDs,
  sessionEndTime,
  sessionStartTime,
  studySessionPayload,
  trackingTransition,
} from "./lib/session.js";

const API_BASE_URL = "https://convo-lab.com";
const TOKEN_KEY = "convoLabAccessToken";
const USER_KEY = "convoLabUser";
const ACTIVE_KEY = "activeWaniKaniSession";
const QUEUE_KEY = "pendingWaniKaniSessionsByUser";
const ERROR_KEY = "lastSyncError";
const TRACKING_ERROR_KEY = "lastTrackingError";
const BROWSER_SESSION_KEY = "convoLabBrowserSession";
const ALARM_NAME = "convoLabWaniKaniReconcile";
const MIN_SESSION_MS = 1_000;

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

async function updateBadge(tracking) {
  await chrome.action.setBadgeBackgroundColor({ color: "#143A66" });
  await chrome.action.setBadgeText({ text: tracking ? "●" : "" });
  await chrome.action.setTitle({
    title: tracking
      ? "ConvoLab is recording WaniKani review time"
      : "ConvoLab WaniKani Tracker",
  });
}

async function fetchJSON(path, { token, method = "GET", body } = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = response.status === 204
    ? null
    : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.message || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function candidateState(now) {
  const idleState = await chrome.idle.queryState(REVIEW_IDLE_MS / 1_000);
  if (idleState !== "active") {
    return { state: null, idleExpired: true };
  }

  for (const state of tabStates.values()) {
    if (
      !isCandidatePageState(state, now)
    ) {
      continue;
    }
    try {
      const tab = await chrome.tabs.get(state.tabId);
      const window = await chrome.windows.get(tab.windowId);
      if (isWaniKaniURL(tab.url) && tab.active && window.focused) {
        return { state, idleExpired: false };
      }
      if (!isWaniKaniURL(tab.url)) {
        tabStates.delete(state.tabId);
      }
    } catch {
      tabStates.delete(state.tabId);
    }
  }
  return { state: null, idleExpired: false };
}

function validPageState(tab, state) {
  return (
    tab?.id
    && isWaniKaniURL(tab.url)
    && isWaniKaniURL(state?.url)
    && typeof state.visible === "boolean"
    && (state.lastInteractionAt === null || Number.isFinite(state.lastInteractionAt))
  );
}

async function restoreTabStates() {
  const tabs = await chrome.tabs.query({
    url: [
      "https://wanikani.com/*",
      "https://*.wanikani.com/*",
    ],
  });
  await Promise.all(tabs.map(async (tab) => {
    try {
      const state = await chrome.tabs.sendMessage(tab.id, {
        type: "REQUEST_WANIKANI_STATE",
      });
      if (validPageState(tab, state)) {
        tabStates.set(tab.id, {
          tabId: tab.id,
          url: state.url,
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
    startedAt,
    lastInteractionAt: Math.max(startedAt, state.lastInteractionAt || startedAt),
  };
  await chrome.storage.local.set({ [ACTIVE_KEY]: active });
  await updateBadge(true);
}

async function finishSession({ now = Date.now(), idleExpired = false } = {}) {
  const values = await stored([ACTIVE_KEY, QUEUE_KEY]);
  const active = values[ACTIVE_KEY];
  if (!active) {
    await updateBadge(false);
    return;
  }

  const endedAt = sessionEndTime({
    startedAt: active.startedAt,
    now,
    lastInteractionAt: active.lastInteractionAt,
    idleExpired,
  });
  const queues = values[QUEUE_KEY] || {};
  if (endedAt - active.startedAt >= MIN_SESSION_MS) {
    const userQueue = queues[active.userId] || [];
    userQueue.push(studySessionPayload(active, endedAt));
    queues[active.userId] = userQueue;
  }
  await chrome.storage.local.set({ [QUEUE_KEY]: queues });
  await chrome.storage.local.remove(ACTIVE_KEY);
  await updateBadge(false);
}

async function reconcile(now = Date.now()) {
  const values = await stored([ACTIVE_KEY, TOKEN_KEY, USER_KEY]);
  const active = values[ACTIVE_KEY];
  if (!values[TOKEN_KEY] || !values[USER_KEY]?.id) {
    if (active) {
      await finishSession({ now });
    }
    return;
  }
  const candidate = await candidateState(now);
  const transition = trackingTransition({
    activeTabId: active?.tabId ?? null,
    candidateTabId: candidate.state?.tabId ?? null,
  });

  if (transition === "none") {
    return;
  }
  if (transition === "stop") {
    if (active) {
      const idleExpired = candidate.idleExpired
        || now - active.lastInteractionAt >= REVIEW_IDLE_MS;
      await finishSession({ now, idleExpired });
      await flushPending();
    }
    return;
  }

  if (transition === "start") {
    await startSession(candidate.state, now);
    return;
  }

  if (transition === "switch") {
    await finishSession({ now });
    await startSession(candidate.state, now);
    await flushPending();
    return;
  }

  if (candidate.state.lastInteractionAt > active.lastInteractionAt) {
    active.lastInteractionAt = candidate.state.lastInteractionAt;
    await chrome.storage.local.set({ [ACTIVE_KEY]: active });
  }
  await updateBadge(true);
}

async function flushPending() {
  const values = await stored([TOKEN_KEY, USER_KEY, QUEUE_KEY]);
  const token = values[TOKEN_KEY];
  const userId = values[USER_KEY]?.id;
  const queues = values[QUEUE_KEY] || {};
  const queue = userId ? (queues[String(userId)] || []) : [];
  if (!token || queue.length === 0) {
    return;
  }

  try {
    const batch = queue.slice(0, 50);
    const saved = await fetchJSON("/api/study/activity-sessions/batch", {
      token,
      method: "POST",
      body: { sessions: batch },
    });
    const savedIDs = savedSessionIDs(saved);
    const remaining = queue.filter(
      (session) => !savedIDs.has(session.clientSessionId),
    );
    queues[String(userId)] = remaining;
    await chrome.storage.local.set({
      [QUEUE_KEY]: queues,
      [ERROR_KEY]: null,
    });
  } catch (error) {
    if (error.status === 401) {
      await chrome.storage.local.remove(TOKEN_KEY);
    }
    await chrome.storage.local.set({
      [ERROR_KEY]: error.status === 401
        ? "ConvoLab sign-in expired. Sign in again to sync."
        : error.message,
    });
  }
}

async function signIn(email, password) {
  const response = await fetchJSON("/api/auth/tokens", {
    method: "POST",
    body: {
      email,
      password,
      device_name: "ConvoLab WaniKani Chrome Extension",
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
  await flushPending();
  return user.data;
}

async function signOut() {
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
    ERROR_KEY,
    TRACKING_ERROR_KEY,
  ]);
  const userId = values[USER_KEY]?.id;
  const queues = values[QUEUE_KEY] || {};
  return {
    signedIn: Boolean(values[TOKEN_KEY]),
    user: values[USER_KEY] || null,
    tracking: Boolean(values[ACTIVE_KEY]),
    pendingCount: userId ? (queues[String(userId)] || []).length : 0,
    error: values[TRACKING_ERROR_KEY] || values[ERROR_KEY] || null,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message !== "object") {
    return false;
  }

  if (message.type === "WANIKANI_PAGE_STATE") {
    if (!validPageState(sender.tab, message)) {
      return false;
    }
    tabStates.set(sender.tab.id, {
      tabId: sender.tab.id,
      url: message.url,
      visible: message.visible,
      lastInteractionAt: Number.isFinite(message.lastInteractionAt)
        ? Math.min(Date.now(), message.lastInteractionAt)
        : null,
    });
    runTracking(() => reconcile());
    return false;
  }

  const popupOperation = async () => {
    switch (message.type) {
      case "GET_STATUS":
        return status();
      case "SIGN_IN":
        if (typeof message.email !== "string" || typeof message.password !== "string") {
          throw new Error("Email and password are required.");
        }
        await signIn(message.email.trim(), message.password);
        return status();
      case "SIGN_OUT":
        await signOut();
        return status();
      case "SYNC_NOW":
        await flushPending();
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
    port.name !== "wanikani-page-lifecycle"
    || port.sender?.id !== chrome.runtime.id
    || !port.sender.tab?.id
    || !isWaniKaniURL(port.sender.tab.url)
  ) {
    port.disconnect();
    return;
  }
  const tabId = port.sender.tab.id;
  port.onDisconnect.addListener(() => {
    tabStates.delete(tabId);
    runTracking(() => reconcile());
  });
});

chrome.tabs.onActivated.addListener(() => runTracking(() => reconcile()));
chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
  runTracking(() => reconcile());
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url && !isWaniKaniURL(changeInfo.url)) {
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
    await finishSession({ idleExpired: true });
    await chrome.storage.session.set({ [BROWSER_SESSION_KEY]: crypto.randomUUID() });
  }
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  await restoreTabStates();
  await reconcile();
  await flushPending();
}

runTracking(initialize);
