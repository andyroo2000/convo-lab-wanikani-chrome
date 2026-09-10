import test from "node:test";
import assert from "node:assert/strict";

let harnessId = 0;
const captureKey = "convoLabMediaCaptureTabId";
const tick = () => new Promise(resolve => setImmediate(resolve));

async function harness() {
  const values = {};
  const events = {};
  const sent = [];
  let tab = {id: 1, url: "https://www.youtube.com/watch?v=example"};
  const listener = name => ({addListener(fn) { events[name] = fn; }});
  globalThis.chrome = {
    runtime: {
      id: "extension", getURL: path => `chrome-extension://extension/${path}`,
      getContexts: async () => [{}], onMessage: listener("message"),
      sendMessage: async message => { sent.push(message); return {ok:true, result:{audioBase64:"audio"}}; },
    },
    storage: {session: {
      get: async () => ({...values}),
      set: async update => Object.assign(values, update),
      remove: async key => { delete values[key]; },
    }},
    tabs: {
      query: async () => [tab], sendMessage: async (id, message) => sent.push({id,...message}),
      onRemoved: listener("removed"), onUpdated: listener("updated"),
    },
    tabCapture: {getMediaStreamId: async () => "stream"},
  };
  const api = await import(`../extension/lib/media-background.js?test=${++harnessId}`);
  api.installMediaMessages();
  const sender = () => ({id:"extension",frameId:0,tab,url:tab.url});
  return {api, values, events, sent, sender, select: id => {tab = {...tab,id};}};
}

test("capture transitions stop the previous tab, ignore stale endings, and clear on navigation", async () => {
  const h = await harness();
  await h.api.startMediaMode();
  h.select(2);
  await h.api.startMediaMode();
  assert.ok(h.sent.some(message => message.id === 1 && message.enabled === false));
  assert.equal(h.values[captureKey],2);
  h.events.message({type:"MEDIA_CAPTURE_ENDED",tabId:1},{url:chrome.runtime.getURL("offscreen.html")},()=>{});
  await tick();
  assert.equal(h.values[captureKey],2);
  h.events.updated(2,{url:"https://example.com"});
  await tick();
  assert.equal(h.values[captureKey],undefined);
  assert.ok(h.sent.some(message => message.id === 2 && message.enabled === false));
});

test("media messages reject foreign senders, subframes, and uncaptured tabs", async () => {
  const h = await harness();
  await h.api.startMediaMode();
  for (const override of [{id:"foreign"},{frameId:1},{url:"https://example.com"}]) {
    assert.equal(h.events.message({type:"GET_AUDIO_WINDOW"},{...h.sender(),...override},()=>{}),false);
  }
  h.select(2);
  const result = await new Promise(resolve => h.events.message({type:"GET_AUDIO_WINDOW"},h.sender(),resolve));
  assert.equal(result.ok,false);
  assert.match(result.error,/Enable dialogue capture/);
});

test("capture can stop immediately while an audio-window operation is still pending", async () => {
  const h = await harness();
  await h.api.startMediaMode();
  let release;
  chrome.runtime.sendMessage = message => message.type === "GET_AUDIO_WINDOW"
    ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ok:true});
  const audio = new Promise(resolve => h.events.message({type:"GET_AUDIO_WINDOW",startTimeMs:0,endTimeMs:1000},h.sender(),resolve));
  await tick();
  await h.api.stopMediaMode();
  assert.equal(h.values[captureKey],undefined);
  release({ok:true,result:{audioBase64:"audio"}});
  assert.equal((await audio).ok,true);
});
