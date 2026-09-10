import test from "node:test";
import assert from "node:assert/strict";

let harnessId = 0;
const captureKey = "convoLabMediaCaptureTabId";
const tick = () => new Promise(resolve => setImmediate(resolve));

async function harness() {
  const values = {};
  const events = {};
  const sent = [];
  const account = {convoLabAccessToken:"test-token",convoLabUser:{id:7}};
  let tab = {id: 1, url: "https://www.youtube.com/watch?v=example"};
  const listener = name => ({addListener(fn) { events[name] = fn; }});
  globalThis.chrome = {
    runtime: {
      id: "extension", getURL: path => `chrome-extension://extension/${path}`,
      getContexts: async () => [{}], onMessage: listener("message"),
      sendMessage: async message => { sent.push(message); return {ok:true, result:{audioBase64:"audio"}}; },
    },
    offscreen: {closeDocument: async () => sent.push({closed:true})},
    storage: {local:{get:async () => ({...account})}, onChanged:listener("storage"), session: {
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
  return {api, values, account, events, sent, sender, select: id => {tab = {...tab,id};}};
}

test("capture transitions stop the previous tab, ignore stale endings, and clear on navigation", async () => {
  const h = await harness();
  await h.api.startMediaMode();
  h.select(2);
  await h.api.startMediaMode();
  assert.ok(h.sent.some(message => message.id === 1 && message.enabled === false));
  assert.equal(h.values[captureKey],2);
  h.events.message({type:"MEDIA_CAPTURE_ENDED",tabId:1},{id:"extension",url:chrome.runtime.getURL("offscreen.html")},()=>{});
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

test("stopping closes the offscreen document but preserves the editor", async () => {
  const h = await harness();
  await h.api.startMediaMode();
  await h.api.stopMediaMode();
  assert.ok(h.sent.some(message => message.closed));
  assert.ok(h.sent.some(message => message.enabled === false && message.discardEditor === false));
});

test("capture requires authentication and account changes discard stopped-tab drafts", async () => {
  const h = await harness();
  delete h.account.convoLabAccessToken;
  await assert.rejects(h.api.startMediaMode(), /Sign in/);
  h.events.storage({convoLabUser:{oldValue:{id:7},newValue:{id:8}}}, "local");
  await tick();
  assert.ok(h.sent.some(message => message.id === 1 && message.discardEditor));
});

test("an expired token stops capture without discarding drafts; same-account refresh retains the grant", async () => {
  const h = await harness();
  await h.api.startMediaMode();
  const grantKey = "convoLabCaptureGrant:1";
  h.events.storage({convoLabAccessToken:{oldValue:"test-token"}}, "local");
  await tick();
  assert.equal(h.values[captureKey],undefined);
  assert.equal(h.values[grantKey].accountId,"7");
  assert.equal(h.sent.some(message => message.discardEditor),false);
  assert.ok(h.sent.some(message => message.type === "MEDIA_AUTH_EXPIRED"));
  h.events.storage({convoLabUser:{oldValue:{id:7},newValue:{id:"7"}},convoLabAccessToken:{newValue:"renewed"}}, "local");
  await tick();
  assert.equal(h.values[grantKey].accountId,"7");
});

test("capture grants are cleared for closed tabs and explicit sign-out, including stopped tabs", async () => {
  const h = await harness();
  await h.api.startMediaMode();
  await h.api.stopMediaMode();
  h.events.removed(1);
  await tick();
  assert.equal(h.values["convoLabCaptureGrant:1"],undefined);
  await h.api.startMediaMode();
  await h.api.stopMediaMode();
  await h.api.stopMediaMode({discardEditor:true});
  assert.equal(h.values["convoLabCaptureGrant:1"],undefined);
  assert.ok(h.sent.some(message => message.id === 1 && message.discardEditor));
});

test("card saves reject tabs with no capture grant and grants from another account", async () => {
  const h = await harness();
  const save = () => new Promise(resolve => h.events.message({type:"CREATE_MEDIA_CARD"},h.sender(),resolve));
  assert.match((await save()).error,/Enable dialogue capture/);
  await h.api.startMediaMode();
  h.account.convoLabUser = {id:8};
  assert.match((await save()).error,/different ConvoLab account/);
});

test("saving a copied clip survives Stop and bypasses a pending recorder operation", async () => {
  const h = await harness();
  await h.api.startMediaMode();
  let release;
  chrome.runtime.sendMessage = message => message.type === "GET_AUDIO_WINDOW"
    ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ok:true});
  const audio = new Promise(resolve => h.events.message({type:"GET_AUDIO_WINDOW",startTimeMs:0,endTimeMs:1000},h.sender(),resolve));
  await tick();
  await h.api.stopMediaMode();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({id:"saved"}));
  try {
    const result = await new Promise(resolve => h.events.message({
      type:"CREATE_MEDIA_CARD", cardId:"01ARZ3NDEKTSV4RRFFQ69G5FAV", japanese:"はい。",english:"Yes.",
      audioBase64:Buffer.alloc(64).toString("base64"), sourceUrl:h.sender().url,
    },h.sender(),resolve));
    assert.equal(result.ok,true);
    assert.equal(result.result.card.id,"saved");
  } finally {
    globalThis.fetch = originalFetch;
    release({ok:true});
    await audio;
  }
});
