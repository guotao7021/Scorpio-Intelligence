import assert from "node:assert/strict";
import test from "node:test";

import { __releaseTest as release } from "../src/worker.js";

test("release platform normalization isolates Android from desktop", () => {
  assert.equal(release.normalizeReleasePlatform("android"), "android");
  assert.equal(release.normalizeReleasePlatform("desktop"), "desktop");
  assert.throws(() => release.normalizeReleasePlatform("ios"));
});

test("public beta versions compare in numeric order without downgrade prompts", () => {
  assert.equal(release.versionGreater("0.3.0-beta.5", "0.3.0-beta.4"), true);
  assert.equal(release.versionGreater("0.3.0-beta.4", "0.3.0-beta.5"), false);
  assert.equal(release.versionGreater("0.3.0-beta.5", "0.3.0-beta.5"), false);
  assert.equal(release.versionGreater("0.3.1", "0.3.0-beta.9"), true);
});
