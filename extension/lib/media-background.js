import { isSupportedMediaURL } from "./card.js";
import { createCapturedAudioCard } from "./capture-upload.js";
import { captureScreenshot } from "./screenshot-capture.js";
import { accountChanged, captureAccount, capturedTabAccount, forgetCapturedTab, grantCapturedTab } from "./capture-grants.js";

const MEDIA_CAPTURE_TAB_KEY = "convoLabMediaCaptureTabId";
const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
let mediaWork = Promise.resolve();
let captureWork = Promise.resolve();

function serializeMedia(operation) {
  const result = mediaWork.then(operation);
  mediaWork = result.catch(() => {});
  return result;
}

function serializeCapture(operation) {
  const result = captureWork.then(operation);
  captureWork = result.catch(() => {});
  return result;
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
  const response = await chrome.runtime.sendMessage({ ...message, target: "offscreen" });
  if (!response?.ok) throw new Error(response?.error || "The audio recorder did not respond.");
  return response.result;
}

async function capturedTabId() {
  const values = await chrome.storage.session.get(MEDIA_CAPTURE_TAB_KEY);
  return Number.isInteger(values[MEDIA_CAPTURE_TAB_KEY]) ? values[MEDIA_CAPTURE_TAB_KEY] : null;
}

async function notifyMediaMode(tabId, enabled, discardEditor = false) {
  if (!Number.isInteger(tabId)) return;
  await chrome.tabs.sendMessage(tabId, { type: "SET_MEDIA_MODE", enabled, discardEditor }).catch(() => {});
}

async function stopCapture(tabId = null, discardEditor = false) {
  const resolvedTabId = tabId ?? await capturedTabId();
  await sendToOffscreen({ type: "STOP_MEDIA_CAPTURE" }).catch(() => {});
  await chrome.offscreen.closeDocument().catch(() => {});
  await chrome.storage.session.remove(MEDIA_CAPTURE_TAB_KEY);
  await notifyMediaMode(resolvedTabId, false, discardEditor);
}

async function startCapture() {
  const accountId = await captureAccount();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isSupportedMediaURL(tab.url)) {
    throw new Error("Open a Netflix or YouTube video before enabling dialogue capture.");
  }
  const previousTabId = await capturedTabId();
  if (previousTabId && previousTabId !== tab.id) await stopCapture(previousTabId);
  await ensureOffscreenDocument();
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  await sendToOffscreen({ type: "START_MEDIA_CAPTURE", streamId, tabId: tab.id });
  await chrome.storage.session.set({ [MEDIA_CAPTURE_TAB_KEY]: tab.id });
  await grantCapturedTab(tab.id, accountId);
  await notifyMediaMode(tab.id, true);
}


export async function mediaStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { mediaSupported: false, mediaCaptureActive: false };
  return { mediaSupported: isSupportedMediaURL(tab.url), mediaCaptureActive: await capturedTabId() === tab.id };
}

function validateAudioWindow(message) {
  if (![message.startTimeMs, message.endTimeMs].every(Number.isFinite)) throw new Error("Invalid audio window.");
  const length = message.endTimeMs - message.startTimeMs;
  if (length <= 0 || length > 60000) throw new Error("Select up to 60 seconds of audio.");
}

async function mediaOperation(message, sender) {
  const id = await capturedTabId();
  if (message.type === "GET_MEDIA_MODE_STATE") return { enabled: id === sender.tab.id };
  if (id !== sender.tab.id) throw new Error("Enable dialogue capture for this tab first.");
  if (message.type === "CAPTURE_SCREENSHOT") return captureScreenshot(sender.tab, message);
  validateAudioWindow(message);
  return sendToOffscreen({type: "GET_AUDIO_WINDOW", startTimeMs: message.startTimeMs, endTimeMs: message.endTimeMs});
}

function isMediaSender(sender) {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0) return false;
  if (!sender.tab?.id) return false;
  return isSupportedMediaURL(sender.url);
}

async function captureEnded(tabId) {
  if (await capturedTabId() !== tabId) return;
  await chrome.storage.session.remove(MEDIA_CAPTURE_TAB_KEY);
  await chrome.offscreen.closeDocument().catch(() => {});
  await notifyMediaMode(tabId, false);
}

function handleMediaMessage(message, sender, respond, serialize) {
  if (message?.type === "MEDIA_CAPTURE_ENDED") {
    return handleCaptureEnded(message, sender, serializeCapture);
  }
  if (!isMediaSender(sender)) return false;
  if (!["GET_MEDIA_MODE_STATE", "GET_AUDIO_WINDOW", "CREATE_MEDIA_CARD", "CAPTURE_SCREENSHOT"].includes(message?.type)) return false;
  // Saving a copied clip is independent of the live recorder and its work queue.
  const operation = message.type === "CREATE_MEDIA_CARD"
    ? saveCapturedCard(message, sender.tab.id) : serialize(() => mediaOperation(message, sender));
  operation
    .then(result => respond({ok: true, result}))
    .catch(error => respond({ok: false, error: error.message}));
  return true;
}

async function saveCapturedCard(message, tabId) {
  const accountId = await capturedTabAccount(tabId);
  return createCapturedAudioCard(message, accountId);
}

function handleCaptureEnded(message, sender, serialize) {
  if (sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)) {
    serialize(() => captureEnded(message.tabId)).catch(() => {});
  }
  return false;
}

function installCaptureLifecycle(serialize) {
  const stopTab = tabId => serialize(async () => {
    await forgetCapturedTab(tabId);
    if (await capturedTabId() === tabId) await stopCapture(tabId);
  }).catch(() => {});
  chrome.tabs.onRemoved.addListener(stopTab);
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.url && !isSupportedMediaURL(change.url)) stopTab(tabId);
  });
  chrome.storage.onChanged.addListener((changes, area) => handleAccountStorageChange(changes, area, serialize));
}

function handleAccountStorageChange(changes, area, serialize) {
  if (area !== "local") return;
  if (accountChanged(changes)) serialize(discardAccountMedia).catch(() => {});
  else if (changes.convoLabAccessToken && !changes.convoLabAccessToken.newValue) {
    serialize(expireCaptureSession).catch(() => {});
  }
}

async function expireCaptureSession() {
  await stopCapture();
  const tabs = await supportedMediaTabs();
  await Promise.all(tabs.map(tab => chrome.tabs.sendMessage(tab.id, {type:"MEDIA_AUTH_EXPIRED"}).catch(() => {})));
}

async function supportedMediaTabs() {
  return (await chrome.tabs.query({})).filter(tab => isSupportedMediaURL(tab.url));
}

async function discardAccountMedia() {
  await stopCapture(null, true);
  // A manually stopped tab may still hold an editor. Never carry that draft across accounts.
  const tabs = await supportedMediaTabs();
  await Promise.all(tabs.map(async tab => {
    await forgetCapturedTab(tab.id);
    await notifyMediaMode(tab.id, false, true);
  }));
}

export function installMediaMessages() {
  chrome.runtime.onMessage.addListener((message, sender, respond) => handleMediaMessage(message, sender, respond, serializeMedia));
  installCaptureLifecycle(serializeCapture);
}

export function startMediaMode() {
  return serializeCapture(startCapture);
}

export function stopMediaMode({ discardEditor = false } = {}) {
  return serializeCapture(discardEditor ? discardAccountMedia : () => stopCapture());
}
