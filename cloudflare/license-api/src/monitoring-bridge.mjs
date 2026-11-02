// All access is bound to the JWT owner, licensed device, installation and explicit account scope.
const scopes = new Set(['paper', 'live']);
const transitions = new Set(['triggered', 'retriggered', 'resolved', 'retired', 'escalated']);
const idPattern = /^[a-zA-Z0-9._:-]{1,128}$/;
const cursor = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const rows = result => result.results || [];

export function registerMonitoringRoutes(deps) {
  const {route, requireUser, readJson, json, throwHttp, verifyMobileLicense, verifyAnalysisLicense,
    applyAnalysisSecurity, sha256Hex} = deps;
  const fail = (code, message) => throwHttp(code, message);
  const identifier = value => {
    if (!idPattern.test(String(value || ''))) fail(400, 'monitoring_identifier_invalid');
    return String(value);
  };
  const now = () => new Date().toISOString();
  async function auth(ctx, mobile) {
    const user = await requireUser(ctx);
    const body = await readJson(ctx.request);
    if (JSON.stringify(body).length > 150000) fail(413, 'monitoring_payload_too_large');
    const license = await (mobile ? verifyMobileLicense : verifyAnalysisLicense)(ctx.env, user, body.license_id, body.machine_fingerprint);
    if (!license) fail(403, 'monitoring_license_required');
    await applyAnalysisSecurity({...ctx, env: {...ctx.env, ANALYSIS_REQUIRE_REQUEST_SIGNATURE: 'true'}},
      {user, license, requestBody: body, endpoint: new URL(ctx.request.url).pathname});
    return {user, body};
  }
  async function authorizedLink(ctx, user, body, mobile, allowRevoked = false) {
    const link = await ctx.env.DB.prepare('SELECT * FROM monitoring_links WHERE link_id=? AND user_id=?' + (allowRevoked ? '' : ' AND active=1'))
      .bind(identifier(body.link_id), user.id).first();
    if (!link) fail(403, 'monitoring_binding_unavailable');
    if (mobile) {
      if (link.mobile_fingerprint !== body.machine_fingerprint || link.mobile_license !== body.license_id) fail(403, 'monitoring_device_mismatch');
      // Revoked/expired/rebound desktop licenses also invalidate mobile access immediately.
      await verifyAnalysisLicense(ctx.env, user, link.desktop_license, link.desktop_fingerprint);
    } else if (link.desktop_fingerprint !== body.machine_fingerprint || link.desktop_license !== body.license_id || link.instance_id !== body.instance_id) {
      fail(403, 'monitoring_instance_mismatch');
    }
    return link;
  }
  const respond = data => json({ok: true, ...data}, 200, {'cache-control': 'no-store'});

  route('POST', '/v1/monitoring/desktop/pair', async ctx => {
    const {user, body} = await auth(ctx, false);
    const instance = identifier(body.instance_id);
    if (!scopes.has(body.account_scope) || body.consent !== true) fail(400, 'monitoring_explicit_scope_consent_required');
    const linkId = crypto.randomUUID(), code = crypto.randomUUID().replaceAll('-', '');
    const created = now(), expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await ctx.env.DB.batch([
      ctx.env.DB.prepare('UPDATE monitoring_links SET active=0 WHERE user_id=? AND desktop_fingerprint=? AND instance_id=? AND account_scope=?')
        .bind(user.id, body.machine_fingerprint, instance, body.account_scope),
      ctx.env.DB.prepare('INSERT INTO monitoring_links(link_id,user_id,desktop_license,desktop_fingerprint,instance_id,account_scope,code_hash,code_expires,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .bind(linkId, user.id, body.license_id, body.machine_fingerprint, instance, body.account_scope, await sha256Hex(code), expires, created)
    ]);
    return respond({link_id: linkId, owner_id: user.id, pair_code: code, code_expires: expires, created_at: created, account_scope: body.account_scope});
  });

  route('POST', '/v1/mobile/monitoring/claim', async ctx => {
    const {user, body} = await auth(ctx, true);
    if (!/^[a-f0-9]{32}$/.test(String(body.pair_code || ''))) fail(400, 'monitoring_pair_code_invalid');
    const hash = await sha256Hex(body.pair_code);
    const link = await ctx.env.DB.prepare('SELECT * FROM monitoring_links WHERE user_id=? AND code_hash=? AND active=1 AND code_expires>=?')
      .bind(user.id, hash, now()).first();
    if (!link) fail(403, 'monitoring_pair_code_expired_or_unavailable');
    await verifyAnalysisLicense(ctx.env, user, link.desktop_license, link.desktop_fingerprint);
    // One device only; the same device may retry a lost response idempotently.
    const result = await ctx.env.DB.prepare('UPDATE monitoring_links SET mobile_fingerprint=?,mobile_license=? WHERE link_id=? AND active=1 AND code_expires>=? AND (mobile_fingerprint IS NULL OR (mobile_fingerprint=? AND mobile_license=?))')
      .bind(body.machine_fingerprint, body.license_id, link.link_id, now(), body.machine_fingerprint, body.license_id).run();
    if (!result.meta?.changes) fail(409, 'monitoring_pair_code_already_claimed');
    return respond({link_id: link.link_id, account_scope: link.account_scope});
  });

  route('POST', '/v1/mobile/monitoring/links', async ctx => {
    const {user, body} = await auth(ctx, true);
    const candidates = rows(await ctx.env.DB.prepare('SELECT * FROM monitoring_links WHERE user_id=? AND mobile_fingerprint=? AND mobile_license=? AND active=1 ORDER BY created_at DESC LIMIT 100')
      .bind(user.id, body.machine_fingerprint, body.license_id).all());
    const links = [];
    for (const link of candidates) {
      try { await verifyAnalysisLicense(ctx.env, user, link.desktop_license, link.desktop_fingerprint); }
      catch (error) { if (error.status === 403) continue; throw error; }
      links.push({link_id: link.link_id, instance_id: link.instance_id, account_scope: link.account_scope,
        created_at: link.created_at, last_sync_at: link.last_sync_at});
    }
    return respond({links});
  });

  route('POST', '/v1/monitoring/desktop/sync', async ctx => {
    const {user, body} = await auth(ctx, false);
    const link = await authorizedLink(ctx, user, body, false);
    if (!link.mobile_fingerprint) return respond({state: 'awaiting_claim', accepted_event_ids: [], accepted_read_ids: [], receipts: []});
    // A removed mobile entitlement stops uploads, not just reads.
    await verifyMobileLicense(ctx.env, user, link.mobile_license, link.mobile_fingerprint);
    const events = body.events || [], reads = body.reads || [];
    if (!Array.isArray(events) || !Array.isArray(reads) || events.length > 100 || reads.length > 100) fail(400, 'monitoring_batch_limit');
    const normalized = [];
    for (const input of events) {
      if (input.account_scope !== link.account_scope || !transitions.has(input.transition)) fail(400, 'monitoring_event_scope_or_transition_invalid');
      const stamp = Date.parse(input.occurred_at);
      if (!Number.isFinite(stamp) || stamp < Date.parse(link.created_at) || stamp > Date.now() + 5000) fail(400, 'monitoring_event_time_invalid');
      const event = {event_id: identifier(input.event_id), account_scope: link.account_scope, transition: input.transition,
        occurred_at: new Date(stamp).toISOString(), message: String(input.message || '').slice(0, 1000),
        code: String(input.code || '').slice(0, 32), name: String(input.name || '').slice(0, 80),
        level: ['info','warning','high','critical'].includes(input.level) ? input.level : 'warning'};
      const payload = JSON.stringify(event), hash = await sha256Hex(payload);
      normalized.push({event, payload, hash});
    }
    if (normalized.length) await ctx.env.DB.batch(normalized.map(({event, payload, hash}) =>
      ctx.env.DB.prepare('INSERT INTO monitoring_cloud_events(link_id,event_id,payload,content_hash,received_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM monitoring_links WHERE link_id=? AND active=1) ON CONFLICT(link_id,event_id) DO NOTHING')
        .bind(link.link_id, event.event_id, payload, hash, now(), link.link_id)));
    for (const item of normalized) {
      const stored = await ctx.env.DB.prepare('SELECT content_hash FROM monitoring_cloud_events WHERE link_id=? AND event_id=?').bind(link.link_id, item.event.event_id).first();
      if (!stored || stored.content_hash !== item.hash) fail(409, 'monitoring_immutable_event_conflict');
    }
    const acceptedReads = [];
    for (const read of reads) {
      identifier(read.event_id);
      const result = await ctx.env.DB.prepare("INSERT INTO monitoring_cloud_reads(link_id,event_id,origin,read_at) SELECT ?,?,'desktop',? WHERE EXISTS(SELECT 1 FROM monitoring_cloud_events WHERE link_id=? AND event_id=?) AND EXISTS(SELECT 1 FROM monitoring_links WHERE link_id=? AND active=1) ON CONFLICT(link_id,event_id,origin) DO NOTHING")
        .bind(link.link_id, read.event_id, now(), link.link_id, read.event_id, link.link_id).run();
      const exists = await ctx.env.DB.prepare("SELECT seq FROM monitoring_cloud_reads WHERE link_id=? AND event_id=? AND origin='desktop'").bind(link.link_id, read.event_id).first();
      if (exists) acceptedReads.push(read.change_id);
    }
    await ctx.env.DB.prepare('UPDATE monitoring_links SET last_sync_at=? WHERE link_id=? AND active=1').bind(now(), link.link_id).run();
    const receipts = rows(await ctx.env.DB.prepare("SELECT seq,event_id,origin,read_at FROM monitoring_cloud_reads WHERE link_id=? AND seq>? AND origin='mobile' ORDER BY seq LIMIT 100")
      .bind(link.link_id, cursor(body.receipt_cursor)).all());
    return respond({state: 'synced', accepted_event_ids: normalized.map(e => e.event.event_id), accepted_read_ids: acceptedReads, receipts,
      receipt_cursor: receipts.at(-1)?.seq || cursor(body.receipt_cursor)});
  });

  route('POST', '/v1/mobile/monitoring/events', async ctx => {
    const {user, body} = await auth(ctx, true);
    const link = await authorizedLink(ctx, user, body, true);
    const before = cursor(body.cursor);
    const query = ctx.env.DB.prepare('SELECT seq,payload,received_at FROM monitoring_cloud_events WHERE link_id=?' + (before ? ' AND seq<?' : '') + ' ORDER BY seq DESC LIMIT 50');
    const events = rows(await (before ? query.bind(link.link_id, before) : query.bind(link.link_id)).all());
    const items = [];
    for (const event of events) {
      const payload = JSON.parse(event.payload);
      const receipts = rows(await ctx.env.DB.prepare('SELECT origin,read_at FROM monitoring_cloud_reads WHERE link_id=? AND event_id=?').bind(link.link_id, payload.event_id).all());
      items.push({...payload, seq: event.seq, cloud_received_at: event.received_at, receipts});
    }
    return respond({link_id: link.link_id, account_scope: link.account_scope, last_sync_at: link.last_sync_at,
      events: items, next_cursor: events.at(-1)?.seq || cursor(body.cursor), has_more: events.length === 50});
  });

  route('POST', '/v1/mobile/monitoring/read', async ctx => {
    const {user, body} = await auth(ctx, true);
    const link = await authorizedLink(ctx, user, body, true);
    const event = identifier(body.event_id);
    const exists = await ctx.env.DB.prepare('SELECT seq FROM monitoring_cloud_events WHERE link_id=? AND event_id=?').bind(link.link_id, event).first();
    if (!exists) fail(404, 'monitoring_event_not_found');
    await ctx.env.DB.prepare("INSERT INTO monitoring_cloud_reads(link_id,event_id,origin,read_at) SELECT ?,?,'mobile',? WHERE EXISTS(SELECT 1 FROM monitoring_links WHERE link_id=? AND active=1) ON CONFLICT(link_id,event_id,origin) DO NOTHING")
      .bind(link.link_id, event, now(), link.link_id).run();
    const receipt = await ctx.env.DB.prepare("SELECT origin,read_at FROM monitoring_cloud_reads WHERE link_id=? AND event_id=? AND origin='mobile'").bind(link.link_id, event).first();
    if (!receipt) fail(403, 'monitoring_binding_unavailable');
    return respond({event_id: event, receipt});
  });

  for (const mobile of [false, true]) route('POST', mobile ? '/v1/mobile/monitoring/revoke' : '/v1/monitoring/desktop/revoke', async ctx => {
    const {user, body} = await auth(ctx, mobile);
    const link = await authorizedLink(ctx, user, body, mobile, true);
    await ctx.env.DB.prepare('UPDATE monitoring_links SET active=0 WHERE link_id=? AND user_id=?').bind(link.link_id, user.id).run();
    return respond({link_id: link.link_id, state: 'revoked'});
  });
}
