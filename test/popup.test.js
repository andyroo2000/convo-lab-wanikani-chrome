import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const popupCSS = await readFile(
  new URL("../extension/popup.css", import.meta.url),
  "utf8",
);
const popupHTML = await readFile(
  new URL("../extension/popup.html", import.meta.url),
  "utf8",
);

test("hidden popup states cannot be overridden by component display rules", () => {
  assert.match(popupCSS, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.match(popupHTML, /<form id="sign-in-form" hidden>/);
  assert.match(popupHTML, /<section id="signed-in"[^>]*hidden>/);
});

test("signed-in status is green before active tracking begins", () => {
  assert.match(
    popupCSS,
    /\.dot\s*\{[^}]*background:\s*#2ca56c;/s,
  );
  assert.match(
    popupCSS,
    /\.dot\.tracking\s*\{[^}]*box-shadow:/s,
  );
});
