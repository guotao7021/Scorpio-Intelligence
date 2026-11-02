import {isBetaClient, publishBetaDirect, revokeBetaDirect, readBetaPublication} from './minute-beta-direct.mjs';
import {validateMarketSession} from './market-session-contract.mjs';
import {minuteUploadPlan} from './minute-upload-plan.mjs';

/** Authenticated read-only delivery. No factor computation or trading authority.
 * Admin approval is an explicit human release attestation, not an MCOS formal
 * ReleaseManifest, nor proof that a historical QA run passed normal daily SLA.
 */
const scopes = new Set(['stock', 'context', 'movement', 'market', 'industry']);
const editions = new Set(['standard', 'pro', 'standard_pro', 'internal']);
const hashPattern = /^[a-f0-9]{64}$/;
function fail(status, message) { throw Object.assign(new Error(message), {status, publicMessage: message}); }
function check(condition, message = 'minute_delivery_invalid') { if (!condition) fail(400, message); }
function fields(value, keys) {
  check(value && typeof value === 'object' && !Array.isArray(value));
  check(Object.keys(value).every(k => keys.includes(k)), 'minute_delivery_private_or_unknown_field');
}
function text(value, required = true) { check(typeof value === 'string' && value.length <= 4000 && (!required || value.trim())); return value; }
function id(value) { check(typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value), 'minute_delivery_id_invalid'); return value; }
export function canonical(value) {
  if (value === null || typeof value !== 'object') {
    check(typeof value !== 'number' || Number.isFinite(value));
    return JSON.stringify(value);
  }
  return Array.isArray(value) ? `[${value.map(canonical).join(',')}]` :
    `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}
export async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('');
}
export function wallTime(value) {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?$/.test(value), 'minute_delivery_time_invalid');
  const ms = Date.parse(value.replace(' ', 'T') + '+08:00');
  check(Number.isFinite(ms) && new Date(ms + 8 * 3600000).toISOString().slice(0, 19) === value.replace(' ', 'T').slice(0, 19), 'minute_delivery_time_invalid');
  return ms;
}
export function shanghaiTime(now = new Date()) { return new Date(now.getTime() + 8 * 3600000).toISOString().replace('Z', ''); }
function identity(code, day) {
  check(typeof code === 'string' && /^\d{6}$/.test(code), 'minute_delivery_code_invalid');
  check(typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day), 'minute_delivery_date_invalid');
  wallTime(day + 'T15:00:00');
}
function list(value, max) { check(Array.isArray(value) && value.length <= max); return value; }
function number(value, lower = -Infinity, strict = false) {
  check(value === null || typeof value === 'number' && Number.isFinite(value) && (strict ? value > lower : value >= lower));
}
function clock(value) { check(typeof value === 'string' && /^\d{2}:\d{2}$/.test(value) && Number(value.slice(0,2)) <= 23 && Number(value.slice(3)) <= 59 && Number(value.slice(3)) % 5 === 0 &&
  (value >= '09:30' && value <= '11:30' || value >= '13:05' && value <= '15:00'), 'minute_delivery_clock_invalid'); }
function points(rows, day, states = false) {
  let prior = '', ordinal = -1;
  for (const p of list(rows, 49)) {
    fields(p, states ? ['clock','bar_time','segment','ordinal','state','reason'] : ['clock','bar_time','segment','ordinal','close','vwap','volume_ratio']);
    clock(p.clock);
    check(p.clock > prior && p.bar_time === `${day} ${p.clock}:00` && Number.isInteger(p.ordinal) && p.ordinal > ordinal && p.ordinal <= 48);
    check(p.segment === (p.clock === '09:30' ? 'opening_boundary' : p.clock <= '11:30' ? 'morning' : 'afternoon'));
    if (states) { check(['放量上涨','缩量上涨','放量下跌','缩量下跌','平价或等量','量比不可用'].includes(p.state)); text(p.reason, false); }
    else { number(p.close, 0, true); number(p.vwap, 0, true); number(p.volume_ratio, 0); }
    prior = p.clock; ordinal = p.ordinal;
  }
}
export async function validatePacks(entries, code, day, generatedAt) {
  identity(code, day); const cutoff = wallTime(generatedAt), seen = new Set();
  check(list(entries, 5).length > 0);
  for (const entry of entries) {
    fields(entry, ['payload_json','content_hash']);
    check(typeof entry.payload_json === 'string' && new TextEncoder().encode(entry.payload_json).length <= 250000 && hashPattern.test(entry.content_hash));
    check(await digest(entry.payload_json) === entry.content_hash, 'minute_delivery_pack_hash_mismatch');
    let p;
    try { p = JSON.parse(entry.payload_json); } catch { fail(400, 'minute_delivery_pack_json_invalid'); }
    fields(p, ['schema_version','code','business_date','scope','interval_minutes','price_basis','available_at','observed_through','historical',
      'status','reason_code','reason_text','explanation_mode','knowledge_binding','conclusion','indicator_cards','charts','tables','coverage',
      'display_only','formal_use_allowed','order_authorized','model_called','observation_binding_hash','market_session']);
    check(p.schema_version === 'stock-minute-explanation.v1' && p.code === code && p.business_date === day && scopes.has(p.scope) && !seen.has(p.scope));
    seen.add(p.scope);
    if ('market_session' in p) {
      check(p.scope === 'market', 'market_session_scope_invalid');
      validateMarketSession(p.market_session, day);
    }
    check(p.interval_minutes === 5 && p.price_basis === 'unadjusted' && p.historical === true && p.display_only === true &&
      p.formal_use_allowed === false && p.order_authorized === false && p.model_called === false && p.explanation_mode === 'local_knowledge');
    check(['available','partial'].includes(p.status) && wallTime(p.available_at) <= cutoff && wallTime(p.available_at) >= wallTime(day + 'T15:00:00'));
    check(hashPattern.test(p.observation_binding_hash), 'minute_delivery_observation_binding_required');
    text(p.reason_code, false); text(p.reason_text, false);
    fields(p.conclusion, ['headline','label','status','boundary','evidence','counter_evidence','limitations','follow_up_questions']);
    for (const k of ['headline','label','status','boundary']) text(p.conclusion[k]);
    for (const k of ['evidence','counter_evidence','limitations','follow_up_questions']) list(p.conclusion[k], 30).forEach(x => text(x));
    check(p.status === 'available' ? p.conclusion.status === 'available' : p.conclusion.status === 'unavailable');
    if (p.status === 'available') { fields(p.knowledge_binding, ['version','content_hash']); text(p.knowledge_binding.version); check(hashPattern.test(p.knowledge_binding.content_hash)); }
    else check(p.knowledge_binding === null);
    const cardIds = new Set();
    for (const c of list(p.indicator_cards, 30)) {
      fields(c, ['metric_id','label','value','status','meaning','reading','boundary']);
      for (const k of ['metric_id','label','value','status','meaning','reading','boundary']) text(c[k]);
      check(!cardIds.has(c.metric_id) && ['available','unavailable'].includes(c.status)); cardIds.add(c.metric_id);
    }
    fields(p.charts, ['price_vwap','price_volume_states','return_amplitude','breakout_events']);
    points(p.charts.price_vwap, day); points(p.charts.price_volume_states, day, true);
    const observed = [...p.charts.price_vwap, ...p.charts.price_volume_states].filter(x => x.segment !== 'opening_boundary').map(x => x.bar_time);
    check(p.observed_through === (observed.length ? observed.sort().at(-1) : null));
    let previous = '';
    for (const v of list(p.charts.return_amplitude, 48)) {
      fields(v, ['clock','log_return','amplitude']); clock(v.clock);
      check(v.clock !== '09:30' && v.clock > previous && observed.includes(`${day} ${v.clock}:00`));
      number(v.log_return); number(v.amplitude, 0); previous = v.clock;
    }
    const eventIds = new Set();
    for (const e of list(p.charts.breakout_events, 100)) {
      fields(e, ['event_number','label','direction','value','breakout_time','retest_time','confirmation_time','status']);
      check(Number.isInteger(e.event_number) && e.event_number > 0 && !eventIds.has(e.event_number)); eventIds.add(e.event_number);
      for (const k of ['label','direction','status']) text(e[k]); number(e.value, 0, true); check(e.value !== null);
      const times = [e.breakout_time,e.retest_time,e.confirmation_time].filter(t => t !== null);
      check(times.length && times.every(t => observed.includes(t)) && times.every((t,i) => i === 0 || times[i-1] < t));
    }
    const tableIds = new Set();
    for (const t of list(p.tables, 10)) {
      fields(t, ['key','title','columns','rows']); text(t.key); text(t.title); check(!tableIds.has(t.key)); tableIds.add(t.key);
      check(list(t.columns, 10).length > 0); t.columns.forEach(x => text(x));
      for (const r of list(t.rows, 100)) { check(list(r, 10).length === t.columns.length); r.forEach(x => text(x, false)); }
    }
    fields(p.coverage, ['classification_label','membership_missing','observed_count','member_count','synchrony']);
    text(p.coverage.classification_label, false); check(typeof p.coverage.membership_missing === 'boolean');
    if ('observed_count' in p.coverage || 'member_count' in p.coverage) check(Number.isInteger(p.coverage.observed_count) &&
      Number.isInteger(p.coverage.member_count) && p.coverage.observed_count >= 0 && p.coverage.member_count >= p.coverage.observed_count);
    if ('synchrony' in p.coverage) { number(p.coverage.synchrony); check(p.coverage.synchrony === null || Math.abs(p.coverage.synchrony) <= 1); }
  }
  return [...seen].sort();
}
export async function registerCandidate(env, body, actor, now = new Date()) {
  fields(body, ['candidate_id','version','code','business_date','generated_at','purpose','publication_status','publishable','normal_daily_acceptance_passed','packs']);
  id(body.candidate_id);
  check(body.version === 'minute-explanation-candidate.v1' && body.publication_status === 'candidate' && body.publishable === false &&
    body.normal_daily_acceptance_passed === false && ['historical_frozen_result_qa','current_result_candidate'].includes(body.purpose));
  check(wallTime(body.generated_at) <= now.getTime()); await validatePacks(body.packs, body.code, body.business_date, body.generated_at);
  const payload = canonical(body), hash = await digest(payload);
  await env.DB.prepare('INSERT INTO minute_delivery_candidates VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(candidate_id) DO NOTHING')
    .bind(body.candidate_id, body.code, body.business_date, body.generated_at, hash, payload, actor, shanghaiTime(now)).run();
  const saved = await env.DB.prepare('SELECT candidate_hash FROM minute_delivery_candidates WHERE candidate_id=?').bind(body.candidate_id).first();
  if (saved?.candidate_hash !== hash) fail(409, 'minute_delivery_candidate_conflict');
  return {candidate_id: body.candidate_id, candidate_hash: hash, status: 'candidate', publishable: false};
}
async function readCandidate(env, candidateId) {
  const row = await env.DB.prepare('SELECT * FROM minute_delivery_candidates WHERE candidate_id=?').bind(id(candidateId)).first();
  if (!row) fail(404, 'minute_delivery_candidate_missing');
  check(await digest(row.payload_json) === row.candidate_hash, 'minute_delivery_candidate_corrupt');
  const candidate = JSON.parse(row.payload_json);
  check(candidate.code === row.code && candidate.business_date === row.business_date && candidate.generated_at === row.generated_at);
  await validatePacks(candidate.packs, row.code, row.business_date, candidate.generated_at);
  return {row, candidate};
}
export async function approveCandidate(env, manifest, actor, now = new Date()) {
  fields(manifest, ['version','approval_id','publication_id','candidate_id','candidate_hash','expected_previous_publication_id','decision',
    'acceptance','allowed_scopes','edition_scopes','knowledge_hashes','expires_at','min_client_version','display_only']);
  for (const k of ['approval_id','publication_id','candidate_id']) id(manifest[k]);
  check(manifest.expected_previous_publication_id === '' || id(manifest.expected_previous_publication_id));
  check(manifest.version === 'minute-delivery-approval.v1' && manifest.decision === 'approved' && manifest.display_only === true);
  const {row, candidate} = await readCandidate(env, manifest.candidate_id);
  check(manifest.candidate_hash === row.candidate_hash, 'minute_delivery_approval_binding_mismatch');
  fields(manifest.acceptance, ['receipt_id','content_hash','kind','status']); id(manifest.acceptance.receipt_id);
  check(hashPattern.test(manifest.acceptance.content_hash) && manifest.acceptance.status === 'passed' &&
    ['historical_verified','normal_daily'].includes(manifest.acceptance.kind), 'minute_delivery_acceptance_required');
  // A historical preview can never be promoted by labelling it a daily receipt.
  check(candidate.purpose !== 'historical_frozen_result_qa' || manifest.acceptance.kind === 'historical_verified');
  const resultScopes = await validatePacks(candidate.packs, row.code, row.business_date, candidate.generated_at);
  check(canonical(list(manifest.allowed_scopes, 5).slice().sort()) === canonical(resultScopes));
  check(list(manifest.edition_scopes, 4).length && new Set(manifest.edition_scopes).size === manifest.edition_scopes.length && manifest.edition_scopes.every(x => editions.has(x)));
  const knowledge = [...new Set(candidate.packs.map(e => JSON.parse(e.payload_json).knowledge_binding?.content_hash).filter(Boolean))].sort();
  check(canonical(list(manifest.knowledge_hashes, 5).slice().sort()) === canonical(knowledge), 'minute_delivery_knowledge_mismatch');
  const expiry = wallTime(manifest.expires_at);
  check(expiry > now.getTime() && expiry <= now.getTime() + 7 * 86400000, 'minute_delivery_expiry_invalid');
  check(typeof manifest.min_client_version === 'string' && /^\d+\.\d+\.\d+$/.test(manifest.min_client_version));
  const payload = canonical(manifest), hash = await digest(payload);
  await env.DB.prepare('INSERT INTO minute_delivery_approvals VALUES(?,?,?,?,?,?,?) ON CONFLICT(approval_id) DO NOTHING')
    .bind(manifest.approval_id, manifest.publication_id, row.candidate_id, hash, payload, actor, shanghaiTime(now)).run();
  const saved = await env.DB.prepare('SELECT approval_hash FROM minute_delivery_approvals WHERE approval_id=?').bind(manifest.approval_id).first();
  if (saved?.approval_hash !== hash) fail(409, 'minute_delivery_approval_conflict');
  return {approval_id: manifest.approval_id, approval_hash: hash, status: 'approved'};
}
async function readApproval(env, approvalId) {
  const row = await env.DB.prepare('SELECT * FROM minute_delivery_approvals WHERE approval_id=?').bind(id(approvalId)).first();
  if (!row) fail(404, 'minute_delivery_approval_missing');
  check(await digest(row.manifest_json) === row.approval_hash, 'minute_delivery_approval_corrupt');
  return {row, manifest: JSON.parse(row.manifest_json)};
}
export async function publishApproved(env, body, actor, now = new Date()) {
  fields(body, ['approval_id','approval_hash']); const {row: approval, manifest} = await readApproval(env, body.approval_id);
  check(body.approval_hash === approval.approval_hash, 'minute_delivery_approval_binding_mismatch');
  const existing = await env.DB.prepare('SELECT publication_id FROM minute_delivery_publications WHERE approval_id=?').bind(approval.approval_id).first();
  if (existing) return {publication_id: existing.publication_id, status: 'already_published'}; // never resurrect a withdrawn head
  check(wallTime(manifest.expires_at) > now.getTime(), 'minute_delivery_approval_expired');
  const {row, candidate} = await readCandidate(env, approval.candidate_id);
  check(manifest.candidate_hash === row.candidate_hash);
  const previous = await env.DB.prepare('SELECT p.*, c.generated_at FROM minute_delivery_publications p JOIN minute_delivery_approvals a ON a.approval_id=p.approval_id JOIN minute_delivery_candidates c ON c.candidate_id=a.candidate_id WHERE p.code=? AND p.business_date=? ORDER BY p.seq DESC LIMIT 1').bind(row.code, row.business_date).first();
  if ((previous?.publication_id || '') !== manifest.expected_previous_publication_id || previous && wallTime(previous.generated_at) > wallTime(candidate.generated_at)) fail(409, 'minute_delivery_head_changed');
  const envelope = {version: 'minute-explanation-publication.v1', status: 'published', code: row.code, business_date: row.business_date,
    publication_id: manifest.publication_id, published_at: shanghaiTime(now), expires_at: manifest.expires_at, packs: candidate.packs};
  const payload = canonical(envelope), hash = await digest(payload);
  // Conditional insert is a compare-and-set on the full code/day stream. Lost
  // responses retry by approval_id; concurrent writers cannot silently win.
  await env.DB.prepare(`INSERT INTO minute_delivery_publications(publication_id,code,business_date,approval_id,publication_hash,envelope_json,published_by,published_at)
    SELECT ?,?,?,?,?,?,?,? WHERE COALESCE((SELECT publication_id FROM minute_delivery_publications WHERE code=? AND business_date=? ORDER BY seq DESC LIMIT 1),'')=?`)
    .bind(manifest.publication_id, row.code, row.business_date, approval.approval_id, hash, payload, actor, envelope.published_at,
      row.code, row.business_date, manifest.expected_previous_publication_id).run();
  const saved = await env.DB.prepare('SELECT publication_id FROM minute_delivery_publications WHERE approval_id=?').bind(approval.approval_id).first();
  if (!saved) fail(409, 'minute_delivery_head_changed');
  return {publication_id: saved.publication_id, status: 'published'};
}
export async function revokePublication(env, body, actor, now = new Date()) {
  fields(body, ['publication_id','reason']); id(body.publication_id); text(body.reason);
  const exists = await env.DB.prepare('SELECT publication_id FROM minute_delivery_publications WHERE publication_id=?').bind(body.publication_id).first();
  if (!exists) fail(404, 'minute_delivery_publication_missing');
  await env.DB.prepare('INSERT INTO minute_delivery_revocations VALUES(?,?,?,?) ON CONFLICT(publication_id) DO NOTHING')
    .bind(body.publication_id, actor, shanghaiTime(now), body.reason).run();
  return {publication_id: body.publication_id, status: 'withdrawn'};
}
function unavailable(code, day, status) { return {version: 'minute-explanation-publication.v1', status, code, business_date: day, packs: []}; }
function versionAtLeast(actual, minimum) {
  // Existing Android beta versions carry a suffix; the minimum records the
  // capability's numeric base, not whether the APK is a stable-channel release.
  if (typeof actual !== 'string' || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(actual)) return false;
  const a = actual.split('-')[0].split('.').map(Number), b = minimum.split('.').map(Number);
  for (let i=0;i<3;i++) { if (a[i] !== b[i]) return a[i] > b[i]; } return true;
}
export async function readPublication(env, {code, businessDate, editionScopes, clientVersion}, now = new Date()) {
  identity(code, businessDate);
  // Beta is a separate single-step display channel. Never fall back to formal
  // results when its newest result is missing, withdrawn, expired or corrupt.
  if (env.MINUTE_BETA_DIRECT_ENABLED === '1' && isBetaClient(clientVersion))
    return readBetaPublication(env, {code,businessDate,editionScopes,clientVersion}, now);
  // No status/expiry/JSON/edition filters before selecting the head. Otherwise
  // a revoked, corrupt or newly restricted head could uncover an old result.
  try {
    const row = await env.DB.prepare(`SELECT p.*, r.publication_id AS revoked_id FROM minute_delivery_publications p
      LEFT JOIN minute_delivery_revocations r ON r.publication_id=p.publication_id
      WHERE p.code=? AND p.business_date=? ORDER BY p.seq DESC LIMIT 1`).bind(code, businessDate).first();
    if (!row) return unavailable(code, businessDate, 'missing');
    if (row.revoked_id) return unavailable(code, businessDate, 'withdrawn');
    check(await digest(row.envelope_json) === row.publication_hash);
    const envelope = JSON.parse(row.envelope_json), {row: approval, manifest} = await readApproval(env, row.approval_id);
    const {row: candidateRow, candidate} = await readCandidate(env, approval.candidate_id);
    check(envelope.publication_id === row.publication_id && envelope.code === code && envelope.business_date === businessDate &&
      envelope.version === 'minute-explanation-publication.v1' && envelope.status === 'published' &&
      manifest.publication_id === row.publication_id && manifest.candidate_hash === candidateRow.candidate_hash &&
      envelope.published_at === row.published_at && envelope.expires_at === manifest.expires_at &&
      canonical(envelope.packs) === canonical(candidate.packs) && wallTime(envelope.published_at) <= now.getTime());
    if (wallTime(envelope.expires_at) <= now.getTime()) return unavailable(code, businessDate, 'expired');
    if (!manifest.edition_scopes.some(x => editionScopes.includes(x))) return unavailable(code, businessDate, 'not_entitled');
    if (!versionAtLeast(clientVersion, manifest.min_client_version)) return unavailable(code, businessDate, 'client_update_required');
    await validatePacks(envelope.packs, code, businessDate, envelope.published_at);
    const head = await env.DB.prepare(`SELECT p.publication_id, r.publication_id AS revoked_id FROM minute_delivery_publications p
      LEFT JOIN minute_delivery_revocations r ON r.publication_id=p.publication_id
      WHERE p.code=? AND p.business_date=? ORDER BY p.seq DESC LIMIT 1`).bind(code, businessDate).first();
    if (head?.publication_id !== row.publication_id) return unavailable(code, businessDate, 'unavailable');
    if (head.revoked_id) return unavailable(code, businessDate, 'withdrawn');
    return envelope;
  } catch { return unavailable(code, businessDate, 'unavailable'); }
}
export function registerMinuteDeliveryRoutes({route, requireAdmin, requireUser, verifyMobileLicense, applyAnalysisSecurity, authorizeMobileStockRead, editionScopes, readJson, json}) {
  const respond = payload => json({ok: true, ...payload}, 200, {'cache-control': 'no-store, private'});
  for (const [path, action] of [['candidates',registerCandidate],['approvals',approveCandidate],['publish',publishApproved],['revoke',revokePublication],
    ['beta-publish',publishBetaDirect],['beta-revoke',revokeBetaDirect],['beta-upload-plan',minuteUploadPlan]]) {
    route('POST', `/v1/scorpio_v1_admin/minute-results/${path}`, async ctx => {
      requireAdmin(ctx); const body = await readJson(ctx.request, 1500000);
      return respond(await action(ctx.env, body, ctx.adminActor));
    });
  }
  route('POST', '/v1/mobile/minute-explanations', async ctx => {
    const user = await requireUser(ctx), body = await readJson(ctx.request, 16384);
    const license = await verifyMobileLicense(ctx.env, user, body.license_id, body.machine_fingerprint);
    await applyAnalysisSecurity(ctx, {user, license, requestBody: body, endpoint: '/v1/mobile/minute-explanations'});
    identity(body.code, body.data_date);
    await authorizeMobileStockRead(ctx.env, user, license, {code:body.code, data_date:body.data_date}, false);
    return respond({minute_explanations: await readPublication(ctx.env, {code: body.code, businessDate: body.data_date,
      editionScopes: editionScopes(license.edition), clientVersion: body.client_version})});
  });
}
