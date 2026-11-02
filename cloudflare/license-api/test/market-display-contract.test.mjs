import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {resolveMarketScore, dateScope} from '../src/market-display-contract.mjs';
const cases = JSON.parse(readFileSync(new URL('../../../tests/fixtures/market_display_contract.json',import.meta.url),'utf8'));
for (const c of cases) test(c.name, () => {
  const r = resolveMarketScore(c.input);
  assert.deepEqual([r.value,r.business_date,r.status,r.summary_conflict],[c.value,c.date,c.status,c.conflict]);
});
test('block dates preserve mixed dates and unknown rows', () => {
  assert.deepEqual(dateScope([{date:'20260910'},{date:'2026-09-11'},{}]), {start:'2026-09-10',end:'2026-09-11',row_count:3,missing_count:1});
});
