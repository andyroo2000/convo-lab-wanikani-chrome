import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SESSION_MS,
  REVIEW_IDLE_MS,
  isReviewURL,
  isWaniKaniURL,
  sessionEndTime,
  studySessionPayload,
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

test("idle expiration ends at the last interaction", () => {
  const startedAt = 1_000;
  const lastInteractionAt = startedAt + 20_000;
  assert.equal(
    sessionEndTime({
      startedAt,
      now: lastInteractionAt + REVIEW_IDLE_MS,
      lastInteractionAt,
      idleExpired: true,
    }),
    lastInteractionAt,
  );
});

test("focused session ends now and is capped at one day", () => {
  assert.equal(
    sessionEndTime({
      startedAt: 1_000,
      now: 31_000,
      lastInteractionAt: 20_000,
      idleExpired: false,
    }),
    31_000,
  );
  assert.equal(
    sessionEndTime({
      startedAt: 1_000,
      now: 1_000 + MAX_SESSION_MS + 60_000,
      lastInteractionAt: 2_000,
      idleExpired: false,
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
