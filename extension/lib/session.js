export const REVIEW_IDLE_MS = 5 * 60 * 1000;
export const REVIEW_TAIL_GRACE_MS = 30 * 1000;
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

export function isValidPageState(tab, state) {
  return Boolean(
    tab?.id
    && isWaniKaniURL(tab.url)
    && isWaniKaniURL(state?.url)
    && typeof state.visible === "boolean"
    && (state.lastInteractionAt === null || Number.isFinite(state.lastInteractionAt)),
  );
}

export function sessionStartTime(now) {
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
}) {
  const maximumEnd = startedAt + MAX_SESSION_MS;
  const requestedEnd = lastInteractionAt
    ? Math.min(now, lastInteractionAt + REVIEW_TAIL_GRACE_MS)
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

export function appendFailedEntries(
  failed,
  overflowCount,
  entries,
  reason,
  maximum = 20,
) {
  let items = failed;
  let overflow = overflowCount;
  for (const entry of entries) {
    const appended = appendBounded(
      items,
      { ...normalizeQueueEntry(entry), reason },
      maximum,
    );
    items = appended.items;
    overflow += appended.dropped.length;
  }
  return { items, overflowCount: overflow };
}

export function studySessionPayload(active, endedAt) {
  const boundedEnd = Math.max(
    active.startedAt,
    Math.min(endedAt, active.startedAt + MAX_SESSION_MS),
  );
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
