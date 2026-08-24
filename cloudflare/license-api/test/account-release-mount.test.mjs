import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const accountSource = readFileSync(new URL("../../../docs/public/account.js", import.meta.url), "utf8");
const publishSource = readFileSync(new URL("../scripts/publish-dual-release.mjs", import.meta.url), "utf8");

test("account release lookup sends an explicit platform and uses the Android beta channel", () => {
  assert.match(accountSource, /desktop:\s*"stable"/);
  assert.match(accountSource, /android:\s*"beta"/);
  assert.match(accountSource, /platform=\$\{encodeURIComponent\(platform\)\}/);
});

test("dual release publisher registers the platform-aware release identity", () => {
  assert.match(publishSource, /buildRelease\("all",\s*"android"/);
  assert.match(publishSource, /platform === "android" \? "application\/vnd\.android\.package-archive"/);
  assert.match(publishSource, /ON CONFLICT\(version, channel, edition, platform\)/);
  assert.match(publishSource, /release\.platform/);
});
