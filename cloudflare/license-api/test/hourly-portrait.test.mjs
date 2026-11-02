import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { hourlyPortrait } from "../src/hourly-portrait.js";

const fixture = JSON.parse(readFileSync(new URL("../../../tests/fixtures/hourly_display_v1.json", import.meta.url)));
test("public hourly metrics match the Python golden fixture", () => {
  const portrait = hourlyPortrait([...fixture.bars].reverse(), { availableAt: fixture.available_at });
  for (const [key, expected] of Object.entries(fixture.expected_metrics)) {
    assert.ok(Math.abs(portrait.metrics[key] - expected) < 1e-10, key);
  }
  assert.equal(portrait.session_count, 2);
  assert.equal(portrait.interval_count, 8);
  assert.equal(portrait.bar_count, 10);
  assert.equal(portrait.start_at, "2026-09-29 10:30:00");
  assert.equal(portrait.schema_version, "hourly-display.v1");
});
test("hourly portrait unavailable and zero volume are not guessed", () => {
  assert.equal(hourlyPortrait([]).status, "unavailable");
  const portrait = hourlyPortrait(fixture.bars.map((b) => ({ ...b, volume: 0 })), { incomplete: true });
  assert.equal(portrait.status, "partial");
  assert.equal(portrait.metrics.latest_volume_ratio, null);
  assert.equal(portrait.items.at(-1).value, "--");
});
test("intraday rising ratio does not count overnight gaps", () => {
  const bars = fixture.bars.map((bar) => bar.bar_time.startsWith("2026-09-30")
    ? { ...bar, open: bar.open * 100, high: bar.high * 100, low: bar.low * 100, close: bar.close * 100 } : bar);
  const portrait = hourlyPortrait(bars);
  assert.ok(Math.abs(portrait.metrics.rising_interval_pct - 100 / 3) < 1e-10);
  assert.notEqual(portrait.metrics.window_change_pct, 20);
  assert.match(portrait.items[3].note, /不含隔夜/);
  const noPairs = hourlyPortrait(fixture.bars.filter((b) => b.bar_time.endsWith("15:00:00")));
  assert.equal(noPairs.metrics.rising_interval_pct, null);
  assert.equal(noPairs.items[3].value, "--");
});
