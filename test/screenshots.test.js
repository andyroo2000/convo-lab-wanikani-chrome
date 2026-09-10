import test from "node:test";
import assert from "node:assert/strict";
import "../extension/lib/screenshot-buffer.js";
import { captureForm, createCapturedAudioCard } from "../extension/lib/capture-upload.js";
import { captureScreenshot } from "../extension/lib/screenshot-capture.js";

const { selectCandidates, isBlank, createBuffer } = globalThis.ConvoLabScreenshots;
const message = () => ({
  cardId: "01K4VY1PRBJM6H3ZXKMVYDQQ1T",
  japanese: "今日は行けない。",
  english: "I cannot go today.",
  sourceUrl: "https://www.youtube.com/watch?v=example",
  sourceTitle: "Example",
  audioBase64: Buffer.alloc(100).toString("base64"),
});

test("candidate images come only from the trimmed span and cover its full length", () => {
  const frames = Array.from({ length: 20 }, (_, timeMs) => ({ timeMs }));
  assert.deepEqual(selectCandidates(frames, 4, 14).map(frame => frame.timeMs), [4, 7, 9, 12, 14]);
  assert.deepEqual(selectCandidates(frames, 8, 9).map(frame => frame.timeMs), [8, 9]);
  assert.deepEqual(selectCandidates(frames, 30, 40), []);
});

test("the rolling screenshot buffer evicts old and oversized frames and clears on stop", () => {
  const buffer = createBuffer(() => {});
  buffer.append({ timeMs: 0, dataUrl: "first" });
  buffer.append({ timeMs: 180_001, dataUrl: "second" });
  assert.deepEqual(buffer.frames().map(frame => frame.dataUrl), ["second"]);
  buffer.append({ timeMs: 180_002, dataUrl: "x".repeat(17 * 1024 * 1024) });
  assert.deepEqual(buffer.frames(), []);
  buffer.append({ timeMs: 180_003, dataUrl: "last" });
  buffer.clear();
  assert.deepEqual(buffer.frames(), []);
});

test("black protected frames are rejected without rejecting visible content", () => {
  assert.equal(isBlank(new Uint8ClampedArray([0, 0, 0, 255, 4, 4, 4, 255])), true);
  assert.equal(isBlank(new Uint8ClampedArray([50, 60, 70, 255])), false);
});

test("atomic multipart capture omits unselected screenshots and accepts a selected image", async () => {
  const audioOnly = captureForm(message());
  assert.equal(audioOnly.has("image"), false);
  assert.equal(audioOnly.get("id"), message().cardId);
  const selected = captureForm({ ...message(), imageBase64: Buffer.alloc(80).toString("base64") });
  assert.equal(selected.get("image").type, "image/jpeg");
  assert.equal(selected.get("image").size, 80);
  assert.equal(selected.get("audio").type, "audio/wav");
  assert.equal(selected.get("japanese"), message().japanese);
});

test("card creation uses one atomic request and retains the same ID on retry", async () => {
  const calls = [];
  const oldChrome = globalThis.chrome;
  const oldFetch = globalThis.fetch;
  globalThis.chrome = { storage: { local: { get: async () => ({ convoLabAccessToken: "test-token" }) } } };
  globalThis.fetch = async (url, options) => { calls.push({url, options}); return new Response('{"id":"saved"}', {status:201}); };
  try {
    await createCapturedAudioCard(message());
    await createCapturedAudioCard(message());
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://convo-lab.com/api/study/cards/capture");
    assert.equal(calls[0].options.body.get("id"), calls[1].options.body.get("id"));
  } finally { globalThis.fetch = oldFetch; globalThis.chrome = oldChrome; }
});

test("screenshot capture refuses an inactive video tab before reading screen pixels", async () => {
  const oldChrome = globalThis.chrome;
  let captures = 0;
  globalThis.chrome = { tabs: {
    get: async () => ({ active: false, url: message().sourceUrl }),
    captureVisibleTab: async () => { captures += 1; },
  } };
  try {
    await assert.rejects(captureScreenshot({ id: 2, url: message().sourceUrl }, {}), /Keep the video tab visible/);
    assert.equal(captures, 0);
  } finally { globalThis.chrome = oldChrome; }
});
