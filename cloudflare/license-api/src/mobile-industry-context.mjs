// One read path for mobile industry facts. Page presenters consume this
// assembled context instead of joining production tables independently.
import {businessDate} from './market-display-contract.mjs';
import {mergeIndustryEvidenceRows} from './mobile-risk-portrait.mjs';

export const MOBILE_INDUSTRY_CONTEXT_TABLES = Object.freeze({
  flow: 'industry_fund_flow_cache',
  member: 'industry_member_observation_daily',
  classification: 'sector_classification_snapshots',
  risk: 'industry_risk_daily',
});

const rowDay = row => businessDate(row?.trade_date || row?.business_date || row?._data_date);
const exactDayRows = (rows, day) => (rows || []).filter(row => rowDay(row) === day);
const latestDay = rows => (rows || []).map(rowDay).filter(Boolean).sort().at(-1) || '';

/**
 * Read one authoritative mobile industry-context partition.
 *
 * `read(table, options)` is supplied by the Worker publication boundary. A
 * requested day is always exact. Without one, the selected flow partition
 * determines the day before member/risk evidence is read, so upload time can
 * never become the business date.
 */
export async function loadPublishedIndustryContext({read, requestedDay = '', limit = 240} = {}) {
  if (typeof read !== 'function') throw new TypeError('industry context read function is required');
  const requested = businessDate(requestedDay);
  const rawFlows = await read(MOBILE_INDUSTRY_CONTEXT_TABLES.flow,
    requested ? {data_date: requested, limit} : {limit, latest_partition: true});
  const day = requested || latestDay(rawFlows);
  if (!day) return {business_date: '', rows: [], source_counts: {flow: 0, member: 0, classification: 0, risk: 0}};
  const flows = exactDayRows(rawFlows, day);
  const [memberRows, classificationRows, riskRows] = await Promise.all([
    read(MOBILE_INDUSTRY_CONTEXT_TABLES.member, {data_date: day, limit}),
    read(MOBILE_INDUSTRY_CONTEXT_TABLES.classification, {data_date: day, limit}),
    read(MOBILE_INDUSTRY_CONTEXT_TABLES.risk, {data_date: day, limit}),
  ]);
  const members = exactDayRows(memberRows, day);
  const classifications = exactDayRows(classificationRows, day);
  const risks = exactDayRows(riskRows, day);
  return {
    business_date: day,
    rows: mergeIndustryEvidenceRows(flows, members, risks, day, classifications),
    source_counts: {flow: flows.length, member: members.length, classification: classifications.length, risk: risks.length},
  };
}
