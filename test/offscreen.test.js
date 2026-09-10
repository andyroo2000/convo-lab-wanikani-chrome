import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

async function recorderHarness() {
  let listener;
  let processor;
  const resources = {stopped:0,closed:0};
  const track = {stop:() => {resources.stopped += 1;},addEventListener() {}};
  const stream = {getTracks:() => [track],getAudioTracks:() => [track]};
  const context = vm.createContext({
    Float32Array,ArrayBuffer,DataView,Uint8Array,btoa,atob,
    Date:{now:() => 100000},
    navigator:{mediaDevices:{getUserMedia:async () => stream}},
    AudioContext:class {
      sampleRate = 10;
      currentTime = 0;
      resume = async () => {};
      close = async () => {resources.closed += 1;};
      createMediaStreamSource() {return {connect() {},disconnect() {}};}
      createScriptProcessor() {processor = {connect() {},disconnect() {}}; return processor;}
    },
    chrome:{runtime:{onMessage:{addListener:fn => {listener=fn;}}}},
  });
  for (const file of ["lib/audio.js","offscreen.js"]) {
    vm.runInContext(readFileSync(new URL(`../extension/${file}`,import.meta.url),"utf8"),context);
  }
  const send = message => new Promise(resolve => listener({target:"offscreen",...message},{},resolve));
  function chunk(playbackTime, left, right = left) {
    const channels = [Float32Array.from(left),Float32Array.from(right)];
    processor.onaudioprocess({playbackTime,
      inputBuffer:{length:left.length,numberOfChannels:2,getChannelData:i => channels[i]},
      outputBuffer:{numberOfChannels:2,copyToChannel() {}},
    });
  }
  async function window(startTimeMs,endTimeMs) {
    const response = await send({type:"GET_AUDIO_WINDOW",startTimeMs,endTimeMs});
    if (!response.ok) return response;
    const buffer = Buffer.from(response.result.audioBase64,"base64");
    const samples = [];
    for (let i=44; i<buffer.length; i+=2) samples.push(buffer.readInt16LE(i));
    return {...response.result,samples};
  }
  await send({type:"START_MEDIA_CAPTURE",streamId:"stream",tabId:1});
  return {send,chunk,window,resources};
}

test("audio windows cross chunk boundaries, downmix stereo, and clamp to available samples", async () => {
  const h = await recorderHarness();
  h.chunk(0,Array(10).fill(1),Array(10).fill(0));
  h.chunk(1,Array(10).fill(-1),Array(10).fill(0));
  const middle = await h.window(100500,101500);
  assert.deepEqual(middle.samples,[...Array(5).fill(16383),...Array(5).fill(-16384)]);
  const all = await h.window(99000,103000);
  assert.equal(all.startTimeMs,100000);
  assert.equal(all.endTimeMs,102000);
  assert.equal(all.samples.length,20);
  assert.match((await h.window(102001,103000)).error,/outside/);
});

test("rolling audio evicts old chunks and stop clears samples and resources", async () => {
  const h = await recorderHarness();
  h.chunk(0,Array(10).fill(1));
  h.chunk(182,Array(10).fill(0.25));
  assert.match((await h.window(100000,101000)).error,/outside/);
  assert.equal((await h.window(282000,283000)).samples.length,10);
  await h.send({type:"STOP_MEDIA_CAPTURE"});
  assert.match((await h.window(282000,283000)).error,/No captured audio/);
  assert.deepEqual(h.resources,{stopped:1,closed:1});
});

test("gaps remain silent and sample-aligned partial chunks preserve length", async () => {
  const h = await recorderHarness();
  h.chunk(0,Array(10).fill(1));
  h.chunk(2,Array(10).fill(1));
  const window = await h.window(100900,102100);
  assert.deepEqual(window.samples,[32767,...Array(10).fill(0),32767]);
});
