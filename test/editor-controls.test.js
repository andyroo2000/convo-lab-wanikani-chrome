import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

function controlsHarness() {
  const document = {activeElement:null};
  function element() {
    const listeners = new Map();
    return {
      listeners, disabled:false, hidden:false, isConnected:true,
      addEventListener:(name,fn) => listeners.set(name,fn),
      removeEventListener:name => listeners.delete(name),
      getClientRects:() => [{}],
      focus() { document.activeElement = this; },
    };
  }
  const start = element();
  const end = element();
  const create = element();
  const opener = element();
  const backdrop = element();
  backdrop.elements = [start,end,create];
  backdrop.querySelector = selector => ({"[name='trimStart']":start,"[name='trimEnd']":end,"[data-create]":create})[selector];
  backdrop.querySelectorAll = () => backdrop.elements;
  backdrop.contains = node => backdrop.elements.includes(node);
  const context = vm.createContext({document});
  vm.runInContext(readFileSync(new URL("../extension/lib/editor-controls.js",import.meta.url),"utf8"),context);
  function key(key, shiftKey = false) {
    const event = {key,shiftKey,prevented:false,stopped:false,
      preventDefault() {this.prevented=true;},stopPropagation() {this.stopped=true;}};
    backdrop.listeners.get("keydown")(event);
    return event;
  }
  return {api:context.ConvoLabEditorControls,document,start,end,create,opener,backdrop,element,key};
}

test("trim controls synchronize bounds and ignore empty or invalid numeric edits", () => {
  const h = controlsHarness();
  const changes = [];
  const sync = h.api.bindTrimInputs(h.backdrop,10,(...args) => changes.push(args));
  sync(2,8);
  assert.equal(h.start.value,"2.00");
  assert.equal(h.start.max,"7.90");
  assert.equal(h.end.min,"2.10");
  assert.equal(h.end.max,"10.00");
  h.start.valueAsNumber = NaN;
  h.start.listeners.get("change")();
  h.end.valueAsNumber = 7.5;
  h.end.listeners.get("change")();
  assert.deepEqual(changes,[["end",7.5]]);
});

test("dialog traps focus in both directions and restores the opener", () => {
  const h = controlsHarness();
  const restore = h.api.bindDialog(h.backdrop,() => {},h.opener);
  assert.equal(h.document.activeElement,h.start);
  assert.equal(h.key("Tab",true).prevented,true);
  assert.equal(h.document.activeElement,h.create);
  h.key("Tab");
  assert.equal(h.document.activeElement,h.start);
  restore();
  assert.equal(h.document.activeElement,h.opener);
  assert.equal(h.backdrop.listeners.has("keydown"),false);
});

test("focus trap uses rerendered thumbnails and skips disabled or hidden controls", () => {
  const h = controlsHarness();
  h.api.bindDialog(h.backdrop,() => {},h.opener);
  const thumbnail = h.element();
  h.backdrop.elements = [thumbnail,h.start,h.end,h.create];
  h.start.hidden = true;
  h.create.disabled = true;
  h.end.focus();
  h.key("Tab");
  assert.equal(h.document.activeElement,thumbnail);
  h.key("Tab",true);
  assert.equal(h.document.activeElement,h.end);
});

test("Escape is contained but cannot discard an in-flight save", () => {
  const h = controlsHarness();
  let closed = 0;
  h.api.bindDialog(h.backdrop,() => {closed += 1;});
  h.create.disabled = true;
  const event = h.key("Escape");
  assert.equal(event.prevented,true);
  assert.equal(event.stopped,true);
  assert.equal(closed,0);
  h.create.disabled = false;
  h.key("Escape");
  assert.equal(closed,1);
});
