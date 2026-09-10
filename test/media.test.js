import test from "node:test";
import assert from "node:assert/strict";

await import("../extension/lib/audio.js");
await import("../extension/lib/subtitles.js");

const audio = globalThis.ConvoLabAudio;
const subtitles = globalThis.ConvoLabSubtitles;

test("parses WebVTT and resolves the active cue", () => {
  const cues = subtitles.parseWebVtt(`WEBVTT

00:00:01.250 --> 00:00:03.500 align:center
<c.ja>おはよう。</c>

00:00:04.000 --> 00:00:05.000
またね。`);
  assert.deepEqual(cues, [
    { start: 1.25, end: 3.5, text: "おはよう。" },
    { start: 4, end: 5, text: "またね。" },
  ]);
  assert.equal(subtitles.activeCue(cues, 2)?.text, "おはよう。");
  assert.equal(subtitles.activeCue(cues, 3.75), null);
});

test("parses YouTube json3 caption events", () => {
  assert.deepEqual(subtitles.parseYouTubeJson3({
    events: [{
      tStartMs: 500,
      dDurationMs: 1200,
      segs: [{ utf8: "行き" }, { utf8: "ます。" }],
    }],
  }), [{ start: 0.5, end: 1.7, text: "行きます。" }]);
});

test("trims mono samples and applies optional edge fades", () => {
  const samples = new Float32Array(100).fill(1);
  const trimmed = audio.trimAndFade(samples, 100, { start: 0.1, end: 0.9 }, {
    fadeIn: true,
    fadeOut: true,
    fadeSeconds: 0.1,
  });
  assert.equal(trimmed.length, 80);
  assert.equal(trimmed[0], 0);
  assert.equal(trimmed[10], 1);
  assert.equal(trimmed.at(-1), 0);
  assert.equal(new DataView(audio.encodeMonoWav(trimmed, 100)).getUint32(24, true), 100);
});
