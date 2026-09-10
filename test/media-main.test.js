import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function playerHarness(hostname, responses, playerResponse = null) {
  const updates = [];
  const listeners = new Map();
  const context = vm.createContext({
    URL, Response,
    location: { hostname, href: `https://${hostname}/watch?v=example` },
    document: {
      title: "Example",
      querySelectorAll: () => [{ duration: 100, currentTime: 2, playbackRate: 1 }],
      querySelector: () => ({ getPlayerResponse: () => playerResponse }),
      createElement: () => ({ set innerHTML(value) { this.value = value; } }),
      addEventListener() {},
    },
    setInterval(fn) { context.tick = fn; },
    fetch: async url => new Response(responses.get(String(url)) || "", { status: responses.has(String(url)) ? 200 : 404 }),
    XMLHttpRequest: function () {},
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    window: {
      addEventListener: (name, listener) => listeners.set(name, listener),
      dispatchEvent: event => updates.push(event.detail),
    },
  });
  context.XMLHttpRequest.prototype.open = () => {};
  for (const file of ["lib/subtitles.js", "media-main.js"]) {
    vm.runInContext(readFileSync(new URL(`../extension/${file}`, import.meta.url), "utf8"), context);
  }
  return { context, updates, enable: (enabled = true) => listeners.get("convolab-media-command")({detail:{enabled}}) };
}

const captions = text => JSON.stringify({events:[{tStartMs:1000,dDurationMs:3000,segs:[{utf8:text}]}]});
const settle = () => new Promise(resolve => setTimeout(resolve, 30));

test("YouTube publishes both tracks and still publishes Japanese if English fails", async () => {
  const source = {videoDetails:{videoId:"example"},captions:{playerCaptionsTracklistRenderer:{captionTracks:[
    {languageCode:"ja",baseUrl:"https://captions.test/ja"},
    {languageCode:"en",baseUrl:"https://captions.test/en"},
  ]}}};
  const responses = new Map([
    ["https://captions.test/ja?fmt=json3", captions("今日は行けない。")],
    ["https://captions.test/en?fmt=json3", captions("I cannot go today.")],
  ]);
  for (const englishAvailable of [true,false]) {
    if (!englishAvailable) responses.delete("https://captions.test/en?fmt=json3");
    const harness = playerHarness("www.youtube.com",responses,source);
    harness.enable(); await settle(); harness.context.tick();
    const cue = harness.updates.find(update => update.kind === "cue");
    assert.equal(cue.japanese.text,"今日は行けない。");
    assert.equal(cue.english?.text || null,englishAvailable ? "I cannot go today." : null);
  }
});

test("Netflix extracts nested tracks and publishes matching subtitle cues", async () => {
  const manifest = {result:{video:{timedtexttracks:[
    {bcp47:"ja",ttDownloadables:{vtt:{downloadUrls:{"1":"https://captions.test/ja.vtt"}}}},
    {bcp47:"en",ttDownloadables:{vtt:{downloadUrls:{"1":"https://captions.test/en.vtt"}}}},
  ]}}};
  const responses = new Map([
    ["https://www.netflix.com/manifest",JSON.stringify(manifest)],
    ["https://captions.test/ja.vtt","WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n今日は行けない。"],
    ["https://captions.test/en.vtt","WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nI cannot go today."],
  ]);
  const harness = playerHarness("www.netflix.com",responses);
  await harness.context.fetch("https://www.netflix.com/manifest");
  await settle(); harness.enable(); await settle(); harness.context.tick();
  assert.equal(harness.updates.find(update => update.kind === "cue")?.japanese, null);
  harness.updates.length = 0;
  await harness.context.fetch("https://www.netflix.com/manifest");
  await settle(); harness.context.tick();
  const cue = harness.updates.find(update => update.kind === "cue");
  assert.equal(cue.japanese.text,"今日は行けない。");
  assert.equal(cue.english.text,"I cannot go today.");
  harness.enable(false); harness.enable(); await settle(); harness.context.tick();
  assert.equal(harness.updates.at(-1).japanese, null);
});
