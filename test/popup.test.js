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
const manifest = JSON.parse(await readFile(
  new URL("../extension/manifest.json", import.meta.url),
  "utf8",
));
const contentScript = await readFile(
  new URL("../extension/content.js", import.meta.url),
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

test("manifest and popup disclose both supported study services", () => {
  assert.equal(manifest.name, "ConvoLab Study Tracker");
  assert.equal(manifest.version, "0.2.0");
  assert.ok(manifest.host_permissions.includes("https://www.satorireader.com/*"));
  assert.ok(manifest.content_scripts[0].matches.includes("https://www.satorireader.com/*"));
  assert.match(popupHTML, /WaniKani review and Satori Reader time/);
  assert.match(popupHTML, /page content stay private/);
});

test("reader scrolling counts as trusted study interaction", () => {
  assert.match(
    contentScript,
    /addEventListener\("wheel", noteActivity,[\s\S]*?passive:\s*true/,
  );
  assert.match(contentScript, /if \(!event\.isTrusted\)/);
});
