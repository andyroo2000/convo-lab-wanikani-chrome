import test from "node:test";
import assert from "node:assert/strict";

const localValues = {};
const localWrites = [];
const localRemovals = [];

function event() {
  return { addListener() {} };
}

globalThis.chrome = {
  action: {
    async setBadgeBackgroundColor() {},
    async setBadgeText() {},
    async setTitle() {},
  },
  alarms: {
    async create() {},
    onAlarm: event(),
  },
  idle: {
    async queryState() { return "active"; },
    async setDetectionInterval() {},
    onStateChanged: event(),
  },
  runtime: {
    id: "test-extension",
    onConnect: event(),
    onInstalled: event(),
    onMessage: event(),
  },
  storage: {
    local: {
      async get(keys) {
        const requested = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(
          requested
            .filter((key) => Object.hasOwn(localValues, key))
            .map((key) => [key, localValues[key]]),
        );
      },
      async remove(keys) {
        const removed = Array.isArray(keys) ? keys : [keys];
        localRemovals.push(...removed);
        removed.forEach((key) => delete localValues[key]);
      },
      async set(values) {
        localWrites.push(values);
        Object.assign(localValues, values);
      },
      async setAccessLevel() {},
    },
    session: {
      async get() { return { convoLabBrowserSession: "test-session" }; },
      async set() {},
    },
  },
  tabs: {
    async query() { return []; },
    onActivated: event(),
    onRemoved: event(),
    onUpdated: event(),
  },
  windows: {
    onFocusChanged: event(),
  },
};

const {
  hasMatchingActivity,
  isFocusedTab,
  pendingUpload,
  recordUploadError,
  resolvedTrackingTransition,
  saveUploadResult,
  storedQueueStatus,
} = await import("../extension/background.js");

test("candidate inspection helpers require the same activity and focused active tab", () => {
  assert.equal(
    hasMatchingActivity(
      { trackingType: "wanikani" },
      { trackingType: "wanikani" },
    ),
    true,
  );
  assert.equal(
    hasMatchingActivity(
      { trackingType: "satori_reader" },
      { trackingType: "wanikani" },
    ),
    false,
  );
  assert.equal(hasMatchingActivity(null, { trackingType: "wanikani" }), false);
  assert.equal(isFocusedTab({ active: true }, { focused: true }), true);
  assert.equal(isFocusedTab({ active: false }, { focused: true }), false);
  assert.equal(isFocusedTab({ active: true }, { focused: false }), false);
});

test("background transition resolution preserves starts, stops, switches, and continuation", () => {
  const active = { tabId: 1, trackingType: "wanikani" };
  const same = { tabId: 1, trackingType: "wanikani" };
  const switched = { tabId: 2, trackingType: "satori_reader" };
  assert.equal(resolvedTrackingTransition(null, null), "none");
  assert.equal(resolvedTrackingTransition(null, same), "start");
  assert.equal(resolvedTrackingTransition(active, null), "stop");
  assert.equal(resolvedTrackingTransition(active, same), "continue");
  assert.equal(resolvedTrackingTransition(active, switched), "switch");
});

test("pending upload selection stays scoped to the signed-in account", () => {
  const values = {
    convoLabAccessToken: "token",
    convoLabUser: { id: 7 },
    pendingWaniKaniSessionsByUser: {
      7: [{ clientSessionId: "current-user" }],
      8: [{ clientSessionId: "other-user" }],
    },
  };
  const pending = pendingUpload(values);
  assert.equal(pending.userKey, "7");
  assert.deepEqual(
    pending.queue.map((entry) => entry.session.clientSessionId),
    ["current-user"],
  );
  assert.equal(pendingUpload({ ...values, convoLabAccessToken: null }), null);
});

test("stored queue status includes bounded-failure overflow for the current account", () => {
  assert.deepEqual(storedQueueStatus({}), { pendingCount: 0, failedCount: 0 });
  assert.deepEqual(storedQueueStatus({
    convoLabUser: { id: 7 },
    pendingWaniKaniSessionsByUser: { 7: [{}, {}] },
    failedWaniKaniSessionsByUser: { 7: [{}] },
    failedWaniKaniSessionOverflowByUser: { 7: 3 },
  }), { pendingCount: 2, failedCount: 4 });
});

test("successful uploads preserve the queue tail and append failed entries", async () => {
  localWrites.length = 0;
  const values = {
    failedWaniKaniSessionsByUser: { 7: [] },
    failedWaniKaniSessionOverflowByUser: { 7: 0 },
  };
  const pending = {
    userKey: "7",
    queue: [
      { session: { clientSessionId: "sent" }, attempts: 0 },
      { session: { clientSessionId: "tail" }, attempts: 0 },
    ],
    queues: { 7: [] },
  };
  await saveUploadResult(values, pending, 1, {
    remaining: [],
    failed: [{ session: { clientSessionId: "poison" }, attempts: 3 }],
  });
  const write = localWrites.at(-1);
  assert.deepEqual(
    write.pendingWaniKaniSessionsByUser[7].map((entry) => entry.session.clientSessionId),
    ["tail"],
  );
  assert.equal(write.failedWaniKaniSessionsByUser[7][0].session.clientSessionId, "poison");
  assert.equal(write.lastSyncError, null);
});

test("401 upload errors remove only the access token and show sign-in guidance", async () => {
  localWrites.length = 0;
  localRemovals.length = 0;
  localValues.convoLabAccessToken = "expired";
  const error = new Error("Unauthorized");
  error.status = 401;
  await recordUploadError(error);
  assert.deepEqual(localRemovals, ["convoLabAccessToken"]);
  assert.equal(
    localWrites.at(-1).lastSyncError,
    "ConvoLab sign-in expired. Sign in again to sync.",
  );
});
