import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync, existsSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
const root = new URL("../../../docs/public/", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");

test("the root page remains an explicit language gateway with relative links on both deployment platforms", () => {
  const html = read("index.html");
  assert.doesNotMatch(html, /http-equiv=["']refresh|home-entry\.js|builder-tower|hub-builder/);
  for (const base of ["https://www.scorpio-intelligence.tech/", "https://guotao7021.github.io/Scorpio-Intelligence/"]) {
    const dom = new JSDOM(html, {url: base}); const d = dom.window.document;
    assert.match(d.querySelector("h1").textContent, /Scorpio Intelligence/);
    assert.equal(d.querySelector('[data-locale="cn"]').href, new URL("index-cn.html", base).href);
    assert.equal(d.querySelector('[data-locale="en"]').href, new URL("index-en.html", base).href);
    assert.ok(d.querySelector(".gateway-motion[aria-label][aria-pressed]"));
    for (const node of d.querySelectorAll("script[src],link[href],img[src]")) {
      const value = node.getAttribute("src") || node.getAttribute("href"); if (/^(?:https?:|\/)/.test(value)) continue;
      assert.ok(existsSync(new URL(value.split(/[?#]/)[0], root)), `Missing ${value}`);
    }
    dom.window.close();
  }
});

test("the gateway animation is a local Three.js module with motion controls and no automatic navigation", () => {
  const js = read("gateway.js");
  assert.equal(spawnSync(process.execPath, ["--check", fileURLToPath(new URL("gateway.js", root))]).status, 0);
  assert.match(js, /vendor\/three\.module\.min\.js/); assert.match(js, /prefers-reduced-motion/);
  assert.match(js, /visibilitychange/); assert.doesNotMatch(js, /location\.(?:replace|assign)|window\.open/);
});
