import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RiskLevel,
  isKnownRiskLevel,
  mobileRiskLevelFromScore,
  normalizeRiskLevel,
  riskLevelColorRole,
  riskLevelIsAtLeast,
  riskLevelLabel,
} from '../src/risk-level-enum.mjs';

test('normalizes English and Chinese aliases through one enum table', () => {
  assert.equal(normalizeRiskLevel('较高'), RiskLevel.HIGH);
  assert.equal(normalizeRiskLevel('高风险'), RiskLevel.HIGH);
  assert.equal(normalizeRiskLevel('severe'), RiskLevel.CRITICAL);
  assert.equal(normalizeRiskLevel('medium-high'), RiskLevel.MEDIUM_HIGH);
  assert.equal(normalizeRiskLevel('待评估'), RiskLevel.UNKNOWN);
});

test('renders labels and severity without substring matching', () => {
  assert.equal(riskLevelLabel('critical', {style:'short'}), '极高');
  assert.equal(riskLevelLabel('medium', {style:'standard'}), '中等');
  assert.equal(riskLevelColorRole('中高'), 'warning');
  assert.equal(riskLevelIsAtLeast('较高', RiskLevel.HIGH), true);
  assert.equal(riskLevelIsAtLeast('高质量', RiskLevel.HIGH), false);
  assert.equal(isKnownRiskLevel('高质量'), false);
  assert.equal(mobileRiskLevelFromScore(82), RiskLevel.CRITICAL);
});
