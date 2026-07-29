export const REVIEW_IDLE_MS = 5 * 60 * 1000;
export const MAX_SESSION_MS = 24 * 60 * 60 * 1000;

export function isWaniKaniURL(value) {
  try {
    const url = value instanceof URL ? value : new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol.toLowerCase() === "https:"
      && (host === "wanikani.com" || host.endsWith(".wanikani.com"))
    );
  } catch {
    return false;
  }
}

export function isReviewURL(value) {
  if (!isWaniKaniURL(value)) {
    return false;
  }
  const path = new URL(value).pathname.toLowerCase();
  return path === "/subjects/review" || path.startsWith("/subjects/review/");
}

export function shouldForgetTabStateAfterDisconnect(tab) {
  return !tab || !isWaniKaniURL(tab.url);
}

export function isTrustedExtensionPageSender(sender, runtimeId) {
  if (sender?.id !== runtimeId || sender.tab || typeof sender.url !== "string") {
    return false;
  }
  try {
    const url = new URL(sender.url);
    return url.protocol === "chrome-extension:" && url.hostname === runtimeId;
  } catch {
    return false;
  }
}

export function sessionStartTime(now, _lastInteractionAt) {
  return now;
}

export function trackingTransition({ activeTabId, candidateTabId }) {
  if (activeTabId == null && candidateTabId == null) {
    return "none";
  }
  if (activeTabId == null) {
    return "start";
  }
  if (candidateTabId == null) {
    return "stop";
  }
  return activeTabId === candidateTabId ? "continue" : "switch";
}

export function isCandidatePageState(state, now) {
  return Boolean(
    state
    && state.visible
    && isReviewURL(state.url)
    && Number.isFinite(state.lastInteractionAt)
    && now - state.lastInteractionAt < REVIEW_IDLE_MS,
  );
}

export function sessionEndTime({
  startedAt,
  now,
  lastInteractionAt,
  idleExpired,
}) {
  const maximumEnd = startedAt + MAX_SESSION_MS;
  const requestedEnd = idleExpired && lastInteractionAt
    ? lastInteractionAt
    : now;
  return Math.max(startedAt, Math.min(requestedEnd, now, maximumEnd));
}

export function savedSessionIDs(response) {
  const sessions = Array.isArray(response) ? response : response?.data;
  if (!Array.isArray(sessions)) {
    throw new Error("ConvoLab returned an invalid activity-session batch.");
  }
  return new Set(sessions.map((session) => session.clientSessionId));
}

export function normalizeQueueEntry(entry) {
  return entry?.session
    ? entry
    : { session: entry, attempts: 0 };
}

export function isPermanentUploadStatus(status) {
  return (
    Number.isInteger(status)
    && status >= 400
    && status < 500
    && ![401, 408, 429].includes(status)
  );
}

export function nextUploadBatch(queue, maximum = 50) {
  return queue.slice(0, maximum).map(normalizeQueueEntry);
}

export function partitionQueueAfterResponse(
  queue,
  savedIDs,
  { batchSize = 50, maxAttempts = 3 } = {},
) {
  const batch = queue.slice(0, batchSize).map(normalizeQueueEntry);
  const untouched = queue.slice(batchSize).map(normalizeQueueEntry);
  const remaining = [];
  const failed = [];

  for (const entry of batch) {
    if (savedIDs.has(entry.session.clientSessionId)) {
      continue;
    }
    const retried = { ...entry, attempts: entry.attempts + 1 };
    (retried.attempts >= maxAttempts ? failed : remaining).push(retried);
  }
  return { remaining: [...remaining, ...untouched], failed };
}

export function appendBounded(queue, value, maximum) {
  const items = [...queue, value];
  const overflow = Math.max(0, items.length - maximum);
  return {
    items: overflow ? items.slice(overflow) : items,
    dropped: overflow ? items.slice(0, overflow) : [],
  };
}

export function studySessionPayload(active, endedAt) {
  const boundedEnd = sessionEndTime({
    startedAt: active.startedAt,
    now: endedAt,
    lastInteractionAt: active.lastInteractionAt,
    idleExpired: false,
  });
  return {
    clientSessionId: active.clientSessionId,
    category: "wanikani",
    activity: "wanikani_review",
    source: "automatic",
    name: "WaniKani Reviews",
    startedAt: new Date(active.startedAt).toISOString(),
    endedAt: new Date(boundedEnd).toISOString(),
    durationMs: boundedEnd - active.startedAt,
  };
}
