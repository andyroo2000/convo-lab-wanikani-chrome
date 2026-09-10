import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAudioRecognitionCardPayload,
  createULID,
  isSupportedMediaURL,
} from "../extension/lib/card.js";

test("media capture is restricted to exact Netflix and YouTube HTTPS hosts", () => {
  assert.equal(isSupportedMediaURL("https://www.youtube.com/watch?v=abc"), true);
  assert.equal(isSupportedMediaURL("https://youtube.com/watch?v=abc"), true);
  assert.equal(isSupportedMediaURL("https://www.netflix.com/watch/123"), true);
  assert.equal(isSupportedMediaURL("https://netflix.com/watch/123"), false);
  assert.equal(isSupportedMediaURL("https://www.youtube.com.evil.test/watch?v=abc"), false);
  assert.equal(isSupportedMediaURL("http://www.youtube.com/watch?v=abc"), false);
});

test("creates a canonical 26-character ULID", () => {
  const id = createULID(1_700_000_000_000, new Uint8Array(10).fill(0xab));
  assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(id, createULID(1_700_000_000_000, new Uint8Array(10).fill(0xab)));
});

test("builds a hint-free audio recognition card payload", () => {
  const payload = buildAudioRecognitionCardPayload({
    id: "01HF7YAT000000000000000000",
    japanese: " 今日は行けない。 ",
    english: " I can't go today. ",
    sourceTitle: "Episode 1",
    sourceUrl: "https://www.netflix.com/watch/1",
  });
  assert.deepEqual(payload.prompt, { cueText: "今日は行けない。" });
  assert.equal(payload.creationKind, "audio-recognition");
  assert.equal(payload.answer.expression, "今日は行けない。");
  assert.equal(payload.answer.meaning, "I can't go today.");
  assert.match(payload.answer.notes, /Episode 1/);
});
