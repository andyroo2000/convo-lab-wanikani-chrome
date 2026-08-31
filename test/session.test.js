import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SESSION_MS,
  REVIEW_IDLE_MS,
  REVIEW_TAIL_GRACE_MS,
  appendBounded,
  appendFailedEntries,
  isCandidatePageState,
  isPermanentUploadStatus,
  isReviewURL,
  isSatoriReaderArticleURL,
  isSatoriReaderURL,
  isTrackedStudyURL,
  isTrustedExtensionPageSender,
  isValidPageState,
  isWaniKaniURL,
  normalizeQueueEntry,
  nextUploadBatch,
  partitionQueueAfterResponse,
  savedSessionIDs,
  sessionEndTime,
  sessionStartTime,
  shouldForgetTabStateAfterDisconnect,
  studyActivityForURL,
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

test("recognizes Satori Reader articles without tracking its catalog", () => {
  assert.equal(
    isSatoriReaderArticleURL(
      "https://www.satorireader.com/articles/jam-maker-episode-1-edition-m",
    ),
    true,
  );
  assert.equal(isSatoriReaderArticleURL("https://www.satorireader.com/articles"), false);
  assert.equal(isSatoriReaderArticleURL("https://www.satorireader.com/stories"), false);
  assert.equal(isTrackedStudyURL("https://www.satorireader.com/dashboard"), false);
  assert.deepEqual(
    studyActivityForURL(
      "https://www.satorireader.com/articles/jam-maker-episode-1-edition-m",
    ),
    {
      trackingType: "satori_reader",
      category: "immerse",
      activity: "reading",
      name: "Satori Reader",
      recordingLabel: "Satori Reader time",
    },
  );
});

test("rejects insecure and lookalike Satori Reader hosts", () => {
  assert.equal(
    isSatoriReaderURL("http://www.satorireader.com/articles/story"),
    false,
  );
  assert.equal(
    isSatoriReaderURL("https://satorireader.com.example.com/articles/story"),
    false,
  );
  assert.equal(
    isSatoriReaderURL("https://web.cdn.satorireader.com/articles/story"),
    false,
  );
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
      url: "https://www.satorireader.com/stories",
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

test("page-state claims require matching trusted WaniKani contexts", () => {
  const tab = {
    id: 7,
    url: "https://www.wanikani.com/subjects/review",
  };
  const state = {
    url: "https://www.wanikani.com/subjects/review",
    visible: true,
    lastInteractionAt: 1_000,
  };
  assert.equal(isValidPageState(tab, state), true);
  assert.equal(
    isValidPageState(
      { ...tab, url: "https://example.com/" },
      state,
    ),
    false,
  );
  assert.equal(
    isValidPageState(tab, { ...state, url: "https://example.com/" }),
    false,
  );
  assert.equal(
    isValidPageState(tab, { ...state, lastInteractionAt: "now" }),
    false,
  );
});

test("page-state claims accept matching Satori Reader article contexts", () => {
  const url = "https://www.satorireader.com/articles/story-episode-1";
  assert.equal(
    isValidPageState(
      { id: 9, url },
      { url, visible: true, lastInteractionAt: 1_000 },
    ),
    true,
  );
  assert.equal(
    isValidPageState(
      { id: 9, url },
      {
        url: "https://www.wanikani.com/subjects/review",
        visible: true,
        lastInteractionAt: 1_000,
      },
    ),
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

test("Satori Reader articles use the same focus-safe interaction window", () => {
  const now = 500_000;
  assert.equal(
    isCandidatePageState({
      visible: true,
      url: "https://www.satorireader.com/articles/story-episode-1",
      lastInteractionAt: now - REVIEW_IDLE_MS + 1,
    }, now),
    true,
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
  assert.equal(
    trackingTransition({
      activeTabId: 4,
      candidateTabId: 4,
      activeTrackingType: "wanikani",
      candidateTrackingType: "satori_reader",
    }),
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

test("bounded failed queues retain a persistent overflow count", () => {
  const result = appendFailedEntries(
    [{ session: { clientSessionId: "one" }, attempts: 3 }],
    4,
    [
      { session: { clientSessionId: "two" }, attempts: 3 },
      { session: { clientSessionId: "three" }, attempts: 3 },
    ],
    "Server rejected session",
    2,
  );
  assert.deepEqual(
    result.items.map((entry) => entry.session.clientSessionId),
    ["two", "three"],
  );
  assert.equal(result.overflowCount, 5);
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

test("builds a separate Satori Reader immersion payload", () => {
  const payload = studySessionPayload(
    {
      clientSessionId: "22ce3522-e31d-4c64-98b3-793a1ac83484",
      trackingType: "satori_reader",
      startedAt: Date.parse("2026-08-31T12:00:00.000Z"),
      lastInteractionAt: Date.parse("2026-08-31T12:05:00.000Z"),
    },
    Date.parse("2026-08-31T12:10:00.000Z"),
  );
  assert.deepEqual(payload, {
    clientSessionId: "22ce3522-e31d-4c64-98b3-793a1ac83484",
    category: "immerse",
    activity: "reading",
    source: "automatic",
    name: "Satori Reader",
    startedAt: "2026-08-31T12:00:00.000Z",
    endedAt: "2026-08-31T12:10:00.000Z",
    durationMs: 600_000,
  });
});
