import {readPublication, wallTime} from './minute-delivery.mjs';
import {isBetaClient} from './minute-beta-direct.mjs';
import {validateMarketSession} from './market-session-contract.mjs';

const empty = (day, status = 'missing') => ({version:'market-minute-observation.v2', status,
  business_date:day, historical:true, display_only:true});

/** Project ONLY the market scope of one verified publication. Never average
 * different cohorts, use a stock's price curve as an index, or scan old heads
 * until an available result is found. Stock grants/compute quota are untouched.
 */
export async function readMarketMinuteObservation(env, request, now = new Date(), read = readPublication) {
  const {businessDate:day, editionScopes, clientVersion} = request;
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || wallTime(`${day}T15:00:00`) > now.getTime()) return empty(day);
    const table = env.MINUTE_BETA_DIRECT_ENABLED === '1' && isBetaClient(clientVersion)
      ? 'minute_beta_publications' : 'minute_delivery_publications';
    // Closed table-name choice; exact day and latest per-code head, bounded read.
    const headSql = `SELECT p.code,p.publication_id FROM ${table} p
      WHERE p.business_date=? AND p.seq=(SELECT MAX(h.seq) FROM ${table} h
        WHERE h.code=p.code AND h.business_date=p.business_date)
      ORDER BY p.published_at DESC,p.seq DESC LIMIT 1`;
    const head = await env.DB.prepare(headSql).bind(day).first();
    if (!head) return empty(day);
    const envelope = await read(env, {code:head.code,businessDate:day,editionScopes,clientVersion}, now);
    if (envelope.status !== 'published' || envelope.publication_id !== head.publication_id) return empty(day, 'unavailable');
    const current = await env.DB.prepare(headSql).bind(day).first();
    if (current?.publication_id !== head.publication_id) return empty(day, 'unavailable');
    const entries = envelope.packs.map(e => JSON.parse(e.payload_json)).filter(p => p.scope === 'market');
    if (entries.length !== 1) return empty(day);
    const pack = entries[0];
    // Quality metrics remain in the approved source pack, never business KPI tiles.
    if (!pack.market_session) return empty(day);
    const session = validateMarketSession(pack.market_session,day);
    return {version:'market-minute-observation.v2', status:pack.status, business_date:day,
      available_at:pack.available_at, expires_at:envelope.expires_at, publication_id:envelope.publication_id,
      historical:true, display_only:true, session};
  } catch { return empty(day, 'unavailable'); }
}
