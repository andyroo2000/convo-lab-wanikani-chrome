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
