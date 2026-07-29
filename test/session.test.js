import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SESSION_MS,
  REVIEW_IDLE_MS,
  REVIEW_TAIL_GRACE_MS,
  appendBounded,
  isCandidatePageState,
  isPermanentUploadStatus,
  isReviewURL,
  isTrustedExtensionPageSender,
  isWaniKaniURL,
  normalizeQueueEntry,
  nextUploadBatch,
  partitionQueueAfterResponse,
  savedSessionIDs,
  sessionEndTime,
  sessionStartTime,
  shouldForgetTabStateAfterDisconnect,
  studySessionPayload,
  trackingTransition,
} from "../extension/lib/session.js";

test("recognizes current WaniKani review routes", () => {
  assert.equal(isReviewURL("https://www.wanikani.com/subjects/review"), true);
  assert.equal(isReviewURL("https://www.wanikani.com/subjects/review/quiz"), true);
  assert.equal(isReviewURL("https://www.wanikani.com/dashboard"), false);
});

test("rejects insecure and lookalike WaniKani hosts", () => {
  assert.equal(isWaniKaniURL("http://www.wanikani.com/subjects/review"), false);
  assert.equal(
    isWaniKaniURL("https://wanikani.com.example.com/subjects/review"),
    false,
  );
  assert.equal(isWaniKaniURL("https://account.wanikani.com/login"), true);
});

test("port disconnect only forgets tabs that closed or left WaniKani", () => {
  assert.equal(
    shouldForgetTabStateAfterDisconnect({
      url: "https://www.wanikani.com/subjects/review",
    }),
    false,
  );
  assert.equal(
    shouldForgetTabStateAfterDisconnect({
      url: "https://www.wanikani.com/dashboard",
    }),
    false,
  );
  assert.equal(
    shouldForgetTabStateAfterDisconnect({
      url: "https://example.com/",
    }),
    true,
  );
  assert.equal(shouldForgetTabStateAfterDisconnect(null), true);
});

test("credential operations only accept messages from this extension page", () => {
  const runtimeId = "abcdefghijklmnop";
  assert.equal(
    isTrustedExtensionPageSender({
      id: runtimeId,
      url: `chrome-extension://${runtimeId}/popup.html`,
    }, runtimeId),
    true,
  );
  assert.equal(
    isTrustedExtensionPageSender({
      id: runtimeId,
      tab: { id: 7 },
      url: "https://www.wanikani.com/subjects/review",
    }, runtimeId),
    false,
  );
  assert.equal(
    isTrustedExtensionPageSender({
      id: runtimeId,
      url: "https://example.com/",
    }, runtimeId),
    false,
  );
  assert.equal(
    isTrustedExtensionPageSender({
      id: "different-extension",
      url: `chrome-extension://${runtimeId}/popup.html`,
    }, runtimeId),
    false,
  );
});

test("idle expiration includes only a short post-interaction grace period", () => {
  const startedAt = 1_000;
  const lastInteractionAt = startedAt + 20_000;
  assert.equal(
    sessionEndTime({
      startedAt,
      now: lastInteractionAt + REVIEW_IDLE_MS,
      lastInteractionAt,
    }),
    lastInteractionAt + REVIEW_TAIL_GRACE_MS,
  );
});

test("leaving just before idle timeout cannot add the whole idle tail", () => {
  const startedAt = 1_000;
  const lastInteractionAt = startedAt + 20_000;
  assert.equal(
    sessionEndTime({
      startedAt,
      now: lastInteractionAt + REVIEW_IDLE_MS - 10_000,
      lastInteractionAt,
    }),
    lastInteractionAt + REVIEW_TAIL_GRACE_MS,
  );
});

test("new sessions start now instead of backdating to stale interaction", () => {
  const now = 50_000;
  assert.equal(sessionStartTime(now, 10_000), now);
});

test("candidate state requires a real, recent interaction", () => {
  const now = 500_000;
  const base = {
    visible: true,
    url: "https://www.wanikani.com/subjects/review",
  };
  assert.equal(
    isCandidatePageState({ ...base, lastInteractionAt: null }, now),
    false,
  );
  assert.equal(
    isCandidatePageState({ ...base, lastInteractionAt: now - REVIEW_IDLE_MS + 1 }, now),
    true,
  );
  assert.equal(
    isCandidatePageState({ ...base, lastInteractionAt: now - REVIEW_IDLE_MS }, now),
    false,
  );
  assert.equal(
    isCandidatePageState({
      ...base,
      visible: false,
      lastInteractionAt: now,
    }, now),
    false,
  );
});

test("tracking transitions distinguish start, stop, continue, and tab switch", () => {
  assert.equal(
    trackingTransition({ activeTabId: null, candidateTabId: null }),
    "none",
  );
  assert.equal(
    trackingTransition({ activeTabId: null, candidateTabId: 4 }),
    "start",
  );
  assert.equal(
    trackingTransition({ activeTabId: 4, candidateTabId: null }),
    "stop",
  );
  assert.equal(
    trackingTransition({ activeTabId: 4, candidateTabId: 4 }),
    "continue",
  );
  assert.equal(
    trackingTransition({ activeTabId: 4, candidateTabId: 8 }),
    "switch",
  );
});

test("accepts raw and enveloped batch responses", () => {
  const sessions = [{ clientSessionId: "session-1" }];
  assert.deepEqual([...savedSessionIDs(sessions)], ["session-1"]);
  assert.deepEqual([...savedSessionIDs({ data: sessions })], ["session-1"]);
  assert.throws(() => savedSessionIDs({ sessions }), /invalid activity-session batch/);
});

test("retry queue removes saved entries and dead-letters poison entries", () => {
  const good = normalizeQueueEntry({
    clientSessionId: "good",
    durationMs: 1_000,
  });
  const poison = {
    session: { clientSessionId: "poison", durationMs: -1 },
    attempts: 2,
  };
  const result = partitionQueueAfterResponse(
    [good, poison],
    new Set(["good"]),
  );
  assert.deepEqual(result.remaining, []);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].session.clientSessionId, "poison");
  assert.equal(result.failed[0].attempts, 3);
});

test("failed batches can be isolated without discarding valid neighbors", () => {
  const queue = [
    normalizeQueueEntry({ clientSessionId: "good" }),
    normalizeQueueEntry({ clientSessionId: "poison" }),
  ];
  const isolated = partitionQueueAfterResponse(queue, new Set(), {
    batchSize: 2,
    maxAttempts: Number.POSITIVE_INFINITY,
  });
  assert.equal(isolated.failed.length, 0);
  assert.deepEqual(
    isolated.remaining.map((entry) => entry.attempts),
    [1, 1],
  );

  const goodSaved = partitionQueueAfterResponse(
    isolated.remaining,
    new Set(["good"]),
    { batchSize: 1 },
  );
  assert.deepEqual(
    goodSaved.remaining.map((entry) => entry.session.clientSessionId),
    ["poison"],
  );
});

test("upload classification retries transient statuses and isolates permanent ones", () => {
  assert.equal(isPermanentUploadStatus(422), true);
  assert.equal(isPermanentUploadStatus(400), true);
  assert.equal(isPermanentUploadStatus(401), false);
  assert.equal(isPermanentUploadStatus(408), false);
  assert.equal(isPermanentUploadStatus(429), false);
  assert.equal(isPermanentUploadStatus(500), false);
});

test("next upload batch does not collapse because an entry was retried", () => {
  const queue = Array.from({ length: 60 }, (_, index) => ({
    session: { clientSessionId: `session-${index}` },
    attempts: index === 20 ? 1 : 0,
  }));
  assert.equal(nextUploadBatch(queue).length, 50);
  assert.equal(nextUploadBatch(queue)[20].attempts, 1);
});

test("bounded queues discard only the oldest overflow", () => {
  const result = appendBounded(["one", "two"], "three", 2);
  assert.deepEqual(result.items, ["two", "three"]);
  assert.deepEqual(result.dropped, ["one"]);
});

test("focused session ends now and is capped at one day", () => {
  assert.equal(
    sessionEndTime({
      startedAt: 1_000,
      now: 31_000,
      lastInteractionAt: 20_000,
    }),
    31_000,
  );
  assert.equal(
    sessionEndTime({
      startedAt: 1_000,
      now: 1_000 + MAX_SESSION_MS + 60_000,
      lastInteractionAt: 1_000 + MAX_SESSION_MS + 60_000,
    }),
    1_000 + MAX_SESSION_MS,
  );
});

test("builds retry-safe ConvoLab activity payload", () => {
  const payload = studySessionPayload(
    {
      clientSessionId: "52f2ea90-622e-4753-a70f-89ada1edd9a8",
      startedAt: Date.parse("2026-07-29T12:00:00.000Z"),
      lastInteractionAt: Date.parse("2026-07-29T12:05:00.000Z"),
    },
    Date.parse("2026-07-29T12:10:00.000Z"),
  );
  assert.deepEqual(payload, {
    clientSessionId: "52f2ea90-622e-4753-a70f-89ada1edd9a8",
    category: "wanikani",
    activity: "wanikani_review",
    source: "automatic",
    name: "WaniKani Reviews",
    startedAt: "2026-07-29T12:00:00.000Z",
    endedAt: "2026-07-29T12:10:00.000Z",
    durationMs: 600_000,
  });
});
