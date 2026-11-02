/** Single-step Beta display publishing. No candidate, approval or daily-SLA claim. */
import {canonical, digest, validatePacks, wallTime, shanghaiTime} from './minute-delivery.mjs';

const editions = new Set(['standard','pro','standard_pro','internal']);
function check(ok, message = 'minute_beta_invalid', status = 400) {
  if (!ok) throw Object.assign(new Error(message), {status, publicMessage: message});
}
const id = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const fields = ['version','channel','publication_id','code','business_date','generated_at','packs',
  'expected_previous_publication_id','edition_scopes','expires_at','min_client_version','display_only',
  'normal_daily_acceptance_passed'];

export function isBetaClient(version) {
  return typeof version === 'string' && /^\d+\.\d+\.\d+-beta\.\d+$/.test(version);
}

export async function prepareBetaPublication(body, actor, now = new Date()) {
  check(body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).every(k => fields.includes(k)), 'minute_beta_private_or_unknown_field');
  check(body.version === 'minute-beta-direct.v1' && body.channel === 'beta' && body.display_only === true &&
    body.normal_daily_acceptance_passed === false, 'minute_beta_display_only_required');
  check(id(body.publication_id) && (body.expected_previous_publication_id === '' || id(body.expected_previous_publication_id)));
  check(id(actor), 'minute_beta_actor_required');
  check(wallTime(body.generated_at) <= now.getTime(), 'minute_beta_future_result');
  await validatePacks(body.packs, body.code, body.business_date, body.generated_at);
  check(Array.isArray(body.edition_scopes) && body.edition_scopes.length > 0 && body.edition_scopes.length <= 4 &&
    new Set(body.edition_scopes).size === body.edition_scopes.length && body.edition_scopes.every(x => editions.has(x)));
  const expiry = wallTime(body.expires_at);
  check(expiry > now.getTime() && expiry <= now.getTime() + 7 * 86400000, 'minute_beta_expiry_invalid');
  check(typeof body.min_client_version === 'string' && /^\d+\.\d+\.\d+$/.test(body.min_client_version));
  const envelope = {version:'minute-explanation-publication.v1', status:'published', code:body.code,
    business_date:body.business_date, publication_id:body.publication_id, published_at:shanghaiTime(now),
    expires_at:body.expires_at, packs:body.packs};
  const policy = {version:'minute-beta-policy.v1', channel:'beta', edition_scopes:body.edition_scopes,
    min_client_version:body.min_client_version, display_only:true, normal_daily_acceptance_passed:false};
  const payload = canonical(envelope);
  const generatedAt = body.generated_at.replace(' ','T');
  return {body, envelope, requestHash:await digest(canonical(body)), publicationHash:await digest(canonical({envelope,policy,generated_at:generatedAt})),
    payload, policy:canonical(policy), actor};
}

export function betaInsertStatement(prepared) {
  const {body:b, envelope:e} = prepared;
  return {
    sql:`INSERT INTO minute_beta_publications(publication_id,code,business_date,generated_at,request_hash,publication_hash,envelope_json,policy_json,published_by,published_at)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM minute_beta_publications WHERE publication_id=?)
      AND COALESCE((SELECT publication_id FROM minute_beta_publications WHERE code=? AND business_date=? ORDER BY seq DESC LIMIT 1),'')=?
      AND NOT EXISTS(SELECT 1 FROM minute_beta_publications WHERE code=? AND business_date=? AND julianday(generated_at)>julianday(?))`,
    args:[b.publication_id,b.code,b.business_date,b.generated_at.replace(' ','T'),prepared.requestHash,prepared.publicationHash,
      prepared.payload,prepared.policy,prepared.actor,e.published_at,b.publication_id,b.code,b.business_date,
      b.expected_previous_publication_id,b.code,b.business_date,b.generated_at],
  };
}

export async function publishBetaDirect(env, body, actor, now = new Date()) {
  check(env.MINUTE_BETA_DIRECT_ENABLED === '1', 'minute_beta_disabled', 403);
  const p = await prepareBetaPublication(body, actor, now);
  const existing = await env.DB.prepare('SELECT request_hash FROM minute_beta_publications WHERE publication_id=?').bind(body.publication_id).first();
  if (existing) {
    check(existing.request_hash === p.requestHash, 'minute_beta_id_conflict', 409);
    return {publication_id:body.publication_id,status:'already_published',channel:'beta'};
  }
  const stmt = betaInsertStatement(p);
  await env.DB.prepare(stmt.sql).bind(...stmt.args).run();
  const saved = await env.DB.prepare('SELECT request_hash FROM minute_beta_publications WHERE publication_id=?').bind(body.publication_id).first();
  check(saved?.request_hash === p.requestHash, 'minute_beta_head_changed', 409);
  return {publication_id:body.publication_id,status:'published',channel:'beta'};
}

export async function revokeBetaDirect(env, body, actor, now = new Date()) {
  check(env.MINUTE_BETA_DIRECT_ENABLED === '1', 'minute_beta_disabled', 403);
  check(id(actor), 'minute_beta_actor_required');
  check(body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).every(k => ['publication_id','reason'].includes(k)) && id(body.publication_id) &&
    typeof body.reason === 'string' && body.reason.trim() && body.reason.length <= 4000);
  check(await env.DB.prepare('SELECT publication_id FROM minute_beta_publications WHERE publication_id=?').bind(body.publication_id).first(), 'minute_beta_missing',404);
  await env.DB.prepare('INSERT INTO minute_beta_revocations VALUES(?,?,?,?) ON CONFLICT(publication_id) DO NOTHING')
    .bind(body.publication_id,actor,shanghaiTime(now),body.reason).run();
  return {publication_id:body.publication_id,status:'withdrawn',channel:'beta'};
}

const empty = (r,status) => ({version:'minute-explanation-publication.v1',status,code:r.code,business_date:r.businessDate,packs:[]});
const headSql = `SELECT p.*,r.publication_id AS revoked_id FROM minute_beta_publications p
  LEFT JOIN minute_beta_revocations r ON r.publication_id=p.publication_id
  WHERE p.code=? AND p.business_date=? ORDER BY p.seq DESC LIMIT 1`;

export async function readBetaPublication(env, request, now = new Date()) {
  try {
    check(env.MINUTE_BETA_DIRECT_ENABLED === '1' && isBetaClient(request.clientVersion));
    const row = await env.DB.prepare(headSql).bind(request.code,request.businessDate).first();
    if (!row) return empty(request,'missing');
    if (row.revoked_id) return empty(request,'withdrawn');
    const envelope = JSON.parse(row.envelope_json), policy = JSON.parse(row.policy_json);
    check(canonical(envelope) === row.envelope_json && canonical(policy) === row.policy_json &&
      await digest(canonical({envelope,policy,generated_at:row.generated_at})) === row.publication_hash);
    check(policy.version === 'minute-beta-policy.v1' && policy.channel === 'beta' && policy.display_only === true &&
      policy.normal_daily_acceptance_passed === false && Array.isArray(policy.edition_scopes) &&
      policy.edition_scopes.length > 0 && policy.edition_scopes.every(x => editions.has(x)));
    check(envelope.version === 'minute-explanation-publication.v1' && envelope.status === 'published' &&
      envelope.code === row.code && envelope.business_date === row.business_date &&
      envelope.code === request.code && envelope.business_date === request.businessDate &&
      envelope.publication_id === row.publication_id && envelope.published_at === row.published_at &&
      wallTime(row.published_at) <= now.getTime());
    if (wallTime(envelope.expires_at) <= now.getTime()) return empty(request,'expired');
    if (!policy.edition_scopes.some(x => request.editionScopes.includes(x))) return empty(request,'not_entitled');
    const actual = request.clientVersion.split('-')[0].split('.').map(Number);
    check(typeof policy.min_client_version === 'string' && /^\d+\.\d+\.\d+$/.test(policy.min_client_version));
    const minimum = policy.min_client_version.split('.').map(Number);
    const firstDiff = actual.findIndex((x,i) => x !== minimum[i]);
    if (firstDiff >= 0 && actual[firstDiff] < minimum[firstDiff]) return empty(request,'client_update_required');
    await validatePacks(envelope.packs,row.code,row.business_date,row.generated_at);
    check(wallTime(row.generated_at) <= wallTime(row.published_at));
    const current = await env.DB.prepare(headSql).bind(request.code,request.businessDate).first();
    if (current?.publication_id !== row.publication_id) return empty(request,'unavailable');
    if (current.revoked_id) return empty(request,'withdrawn');
    return envelope;
  } catch { return empty(request,'unavailable'); }
}
