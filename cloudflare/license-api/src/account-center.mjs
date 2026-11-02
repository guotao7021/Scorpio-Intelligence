const EDITIONS = new Set(["personal_standard", "personal_pro"]);
const MAX_DAYS = 3660;
const list = (result) => result.results || [];
const text = (value, length = 500) => String(value || "").trim().slice(0, length);
const parse = (value, fallback = {}) => {
  try { return JSON.parse(value || "{}"); } catch { return fallback; }
};
const stable = (value) => JSON.stringify(value, Object.keys(value).sort());
const trialGrant = (row) => /^(auto_registration_trial|account_center_trial(?:;|$))/.test(row.grant_notes || row.notes || "");

export function effectiveLicenseStatus(row, day = new Date().toISOString().slice(0, 10)) {
  if (Number(row.revoked)) return "revoked";
  if (row.expires_at && row.expires_at.slice(0, 10) < day) return "expired";
  if (!Number(row.is_active) || ["pending", "rejected"].includes(row.approval_status)) return "pending";
  return "active";
}

export function registerAccountCenterRoutes(deps) {
  const {route, requireUser, requireAdmin, readJson, json, throwHttp, todayIso, addDays,
    issueLicensePayload, uniqueActivationCode, normalizeEdition, allowRateLimit, sha256Hex, audit} = deps;
  const respond = (data, status = 200) => json(data, status, {"cache-control": "private, no-store"});
  const fail = (status, code) => throwHttp(status, code);
  const integer = (value, min, max, code) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < min || number > max) fail(400, code);
    return number;
  };
  const days = (value) => integer(value, 1, MAX_DAYS, "account_days_invalid");
  const ownerId = (value) => integer(value, 1, Number.MAX_SAFE_INTEGER, "account_user_invalid");
  const reason = (value) => {
    const result = text(value, 1000);
    if (!result) fail(400, "account_reason_required");
    return result;
  };
  async function findUser(env, id, allowArchived = false) {
    const user = await env.DB.prepare("SELECT id, email, username, email_verified, created_at, archived_at, record_operation_id FROM users WHERE id = ?")
      .bind(ownerId(id)).first();
    if (!user) fail(404, "user_not_found");
    if (user.archived_at && !allowArchived) fail(409, "account_record_archived");
    return user;
  }
  async function rateLimit(env, userId, scope) {
    if (!(await allowRateLimit(env, scope, String(userId), 8, 60 * 60 * 1000))) fail(429, "account_action_rate_limited");
  }
  function publicLicense(row) {
    const status = effectiveLicenseStatus(row, todayIso());
    return {
      license_id: row.license_id, edition: row.edition, status,
      kind: trialGrant(row) ? "trial" : "commercial",
      issued_at: row.issued_at, expires_at: row.expires_at,
      days_left: Math.max(0, Math.round((Date.parse(row.expires_at?.slice(0, 10)) - Date.parse(todayIso())) / 86400000)) || 0,
      machine_fingerprint: row.machine_fingerprint || "", last_online_check: row.last_online_check || "",
      max_devices: Number(row.max_devices) || 1, activation_code: row.code || "", code_id: row.activation_code_id,
      approval_status: row.approval_status || "auto", revoke_reason: row.revoke_reason || "", archived_at: row.archived_at || null,
    };
  }
  async function accountOverview(env, user, includeArchived = false) {
    const rows = list(await env.DB.prepare(
      `SELECT l.*, ac.code, ac.notes AS grant_notes, ac.max_devices
       FROM licenses l LEFT JOIN activation_codes ac ON ac.id = l.activation_code_id
       WHERE l.user_id = ? ${includeArchived ? "" : "AND l.archived_at IS NULL"} ORDER BY l.created_at DESC, l.id DESC`
    ).bind(user.id).all());
    const codes = list(await env.DB.prepare(
      `SELECT ac.id, ac.code, ac.edition, ac.status, ac.license_days, ac.max_devices, ac.notes, ac.created_at, ac.archived_at,
        (SELECT COUNT(*) FROM licenses used WHERE used.activation_code_id = ac.id) AS activation_count
       FROM activation_codes ac WHERE (ac.assigned_to_user_id = ? OR ac.used_by_user_id = ?
         OR EXISTS (SELECT 1 FROM licenses l WHERE l.activation_code_id = ac.id AND l.user_id = ?))
         ${includeArchived ? "" : "AND ac.archived_at IS NULL"}
       ORDER BY ac.id DESC`
    ).bind(user.id, user.id, user.id).all());
    const licenses = rows.map(publicLicense);
    const mobile = list(await env.DB.prepare(
      `SELECT b.id, b.license_id, b.machine_fingerprint, b.device_label, b.platform,
              b.client_version, b.revoked, b.created_at, b.last_seen_at,
              l.is_active, l.expires_at, l.approval_status, l.revoked AS license_revoked, l.edition
       FROM mobile_device_bindings b JOIN licenses l ON l.license_id = b.license_id AND l.user_id = b.user_id
       WHERE b.user_id = ? ${includeArchived ? "" : "AND l.archived_at IS NULL"} ORDER BY b.id DESC`
    ).bind(user.id).all());
    const devices = [
      ...licenses.filter((item) => item.machine_fingerprint).map((item) => ({
        id: `desktop:${item.license_id}`, platform: "desktop", label: "Windows",
        license_id: item.license_id, edition: item.edition, status: item.status,
        machine_fingerprint: item.machine_fingerprint, last_seen_at: item.last_online_check,
        created_at: item.issued_at,
      })),
      ...mobile.map((item) => ({
        id: `mobile:${item.id}`, platform: item.platform || "android", label: item.device_label || "Android",
        license_id: item.license_id, edition: item.edition,
        status: Number(item.revoked) ? "released" : effectiveLicenseStatus({...item, revoked: item.license_revoked}, todayIso()),
        machine_fingerprint: item.machine_fingerprint, client_version: item.client_version,
        created_at: item.created_at, last_seen_at: item.last_seen_at,
      })),
    ];
    const events = list(await env.DB.prepare(
      `SELECT id, operation_id, license_id, action, reason, before_json, after_json, created_at
       FROM account_license_events WHERE user_id = ? ORDER BY id DESC LIMIT 100`
    ).bind(user.id).all()).map((item) => ({...item, before: parse(item.before_json), after: parse(item.after_json), before_json: undefined, after_json: undefined}));
    const requests = list(await env.DB.prepare(
      `SELECT public_id, license_id, requested_days, note, status, resolution_note, created_at, updated_at
       FROM account_service_requests WHERE user_id = ? ORDER BY id DESC LIMIT 50`
    ).bind(user.id).all());
    const active = licenses.filter((item) => item.status === "active");
    const primary = active.find((item) => item.kind === "commercial") || active[0] || licenses[0];
    const pendingCodes = codes.filter((item) => !item.activation_count && ["active", "assigned"].includes(item.status));
    const awaitingActivation = !active.length && pendingCodes.length > 0;
    const inactiveGrant = !primary ? codes.find((item) => !item.activation_count) : null;
    return {
      user: {id: user.id, email: user.email, username: user.username, created_at: user.created_at, archived_at: user.archived_at || null, email_verified: Boolean(Number(user.email_verified))},
      summary: {
        status: active.length ? (primary.kind === "trial" ? "trial" : "active") : pendingCodes.length ? "unactivated" : primary?.status || inactiveGrant?.status || "unlicensed",
        edition: awaitingActivation ? pendingCodes[0].edition : primary?.edition || inactiveGrant?.edition || "",
        expires_at: awaitingActivation ? "" : primary?.expires_at || "", days_left: awaitingActivation ? 0 : primary?.days_left || 0,
        active_licenses: active.length, active_devices: devices.filter((item) => item.status === "active").length,
        pending_requests: requests.filter((item) => item.status === "pending").length,
      },
      licenses, devices, events, requests,
      activation_codes: codes.map((item) => ({...item, notes: undefined, kind: trialGrant(item) ? "trial" : "commercial"})),
      server_time: new Date().toISOString(),
    };
  }

  // A mutation owns a token inside the D1 transaction. Retries cannot apply its effects twice.
  async function operation(ctx, body, userId, action, payload) {
    const requestId = text(body.request_id, 100);
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) fail(400, "account_request_id_required");
    const id = `${action}:${userId}:${requestId}`;
    const hash = await sha256Hex(stable(payload));
    const previous = await ctx.env.DB.prepare("SELECT request_hash, result_json FROM account_operations WHERE operation_id = ?").bind(id).first();
    if (previous && previous.request_hash !== hash) fail(409, "account_operation_conflict");
    return {id, hash, userId, action, token: crypto.randomUUID(), cached: previous ? parse(previous.result_json) : null};
  }
  function owned(op) {
    return {sql: "EXISTS (SELECT 1 FROM account_operations WHERE operation_id = ? AND mutation_token = ?)", args: [op.id, op.token]};
  }
  async function commit(ctx, op, result, mutations, checks, events = []) {
    if (!["archive_user", "restore_user"].includes(op.action)) checks = {sql: `(${checks.sql}) AND EXISTS(SELECT 1 FROM users WHERE id=? AND archived_at IS NULL)`, args: [...checks.args, op.userId]};
    const now = new Date().toISOString();
    const guard = owned(op);
    const statements = [ctx.env.DB.prepare(
      `INSERT INTO account_operations(operation_id, user_id, action, request_hash, mutation_token, result_json, created_at)
       VALUES (?, ?, ?, ?, ?, '{}', ?) ON CONFLICT(operation_id) DO NOTHING`
    ).bind(op.id, op.userId, op.action, op.hash, op.token, now), ...mutations];
    for (const event of events) statements.push(ctx.env.DB.prepare(
      `INSERT INTO account_license_events(operation_id, user_id, license_id, action, actor, reason, before_json, after_json, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}`
    ).bind(op.id, op.userId, event.license_id || "", event.action || op.action, ctx.adminActor || "account_owner", event.reason,
      JSON.stringify(event.before || {}), JSON.stringify(event.after || {}), now, ...guard.args));
    statements.push(ctx.env.DB.prepare(
      `UPDATE account_operations SET result_json = CASE WHEN ${checks.sql} THEN ? ELSE NULL END
       WHERE operation_id = ? AND mutation_token = ?`
    ).bind(...checks.args, JSON.stringify(result), op.id, op.token));
    try { await ctx.env.DB.batch(statements); }
    catch (error) {
      if (/NOT NULL|UNIQUE constraint/.test(error.message || "")) fail(409, "account_state_changed_refresh_required");
      throw error;
    }
    const stored = await ctx.env.DB.prepare("SELECT request_hash, result_json FROM account_operations WHERE operation_id = ?").bind(op.id).first();
    if (!stored || stored.request_hash !== op.hash) fail(409, "account_operation_conflict");
    return parse(stored.result_json);
  }

  route("GET", "/v1/account/overview", async (ctx) => respond(await accountOverview(ctx.env, await requireUser(ctx))));

  route("POST", "/v1/account/redeem", async (ctx) => {
    const user = await requireUser(ctx), body = await readJson(ctx.request, 8192);
    const codeText = text(body.activation_code, 128).toUpperCase();
    const op = await operation(ctx, body, user.id, "redeem", {activation_code: codeText});
    if (op.cached) return respond(op.cached);
    await rateLimit(ctx.env, user.id, "account_redeem");
    const code = await ctx.env.DB.prepare("SELECT * FROM activation_codes WHERE code = ?").bind(codeText).first();
    if (!code || code.archived_at || !["active", "assigned"].includes(code.status)
      || (code.assigned_to_user_id && Number(code.assigned_to_user_id) !== Number(user.id))
      || (code.used_by_user_id && Number(code.used_by_user_id) !== Number(user.id))
      || (code.customer_email && code.customer_email.toLowerCase() !== user.email.toLowerCase())) fail(409, "activation_code_unavailable");
    const guard = owned(op);
    return respond(await commit(ctx, op, {ok: true, code: codeText, edition: code.edition, status: "assigned"}, [
      ctx.env.DB.prepare(`UPDATE activation_codes SET assigned_to_user_id = ?, customer_email = ?, status = 'assigned'
        WHERE id = ? AND status IN ('active','assigned')
          AND (assigned_to_user_id IS NULL OR assigned_to_user_id = ?)
          AND (used_by_user_id IS NULL OR used_by_user_id = ?)
          AND ${guard.sql}`).bind(user.id, user.email, code.id, user.id, user.id, ...guard.args),
    ], {sql: "EXISTS(SELECT 1 FROM activation_codes WHERE id = ? AND assigned_to_user_id = ? AND status = 'assigned')", args: [code.id, user.id]},
    [{reason: "activation_code_claimed", after: {code: codeText, edition: code.edition, days: code.license_days}}]));
  });

  route("POST", "/v1/account/requests", async (ctx) => {
    const user = await requireUser(ctx), body = await readJson(ctx.request, 8192);
    const payload = {license_id: text(body.license_id, 128), requested_days: days(body.requested_days), note: text(body.note, 1000)};
    const op = await operation(ctx, body, user.id, "renewal_request", payload);
    if (op.cached) return respond(op.cached);
    await rateLimit(ctx.env, user.id, "account_request");
    const license = await ctx.env.DB.prepare("SELECT license_id, revoked, activation_code_id FROM licenses WHERE user_id = ? AND license_id = ? AND archived_at IS NULL").bind(user.id, payload.license_id).first();
    if (!license) fail(404, "license_not_found");
    if (Number(license.revoked)) fail(409, "account_license_restore_required");
    if (license.activation_code_id) {
      const canonical = await ctx.env.DB.prepare("SELECT license_id FROM licenses WHERE user_id = ? AND activation_code_id = ? AND revoked = 0 ORDER BY id LIMIT 1")
        .bind(user.id, license.activation_code_id).first();
      payload.license_id = canonical.license_id;
    }
    const pending = await ctx.env.DB.prepare(`SELECT r.public_id FROM account_service_requests r
      JOIN licenses l ON l.license_id = r.license_id AND l.user_id = r.user_id
      WHERE r.user_id = ? AND r.status = 'pending' AND (r.license_id = ? OR (? IS NOT NULL AND l.activation_code_id = ?))`)
      .bind(user.id, payload.license_id, license.activation_code_id, license.activation_code_id).first();
    if (pending) fail(409, "account_request_already_pending");
    const id = `REQ-${crypto.randomUUID()}`, now = new Date().toISOString(), guard = owned(op);
    return respond(await commit(ctx, op, {ok: true, public_id: id, status: "pending"}, [
      ctx.env.DB.prepare(`INSERT INTO account_service_requests(public_id, user_id, license_id, requested_days, note, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}`)
        .bind(id, user.id, payload.license_id, payload.requested_days, payload.note, now, now, ...guard.args),
    ], {sql: "EXISTS(SELECT 1 FROM account_service_requests WHERE public_id = ?) AND EXISTS(SELECT 1 FROM licenses WHERE license_id=? AND user_id=? AND archived_at IS NULL)", args: [id, payload.license_id, user.id]},
    [{license_id: payload.license_id, reason: payload.note || "renewal_requested", after: {requested_days: payload.requested_days, request: id}}]), 201);
  });

  route("GET", "/v1/scorpio_v1_admin/users", async (ctx) => {
    requireAdmin(ctx);
    const limit = Math.min(100, Math.max(1, Number.parseInt(ctx.url.searchParams.get("limit"), 10) || 25));
    const offset = Math.max(0, Number.parseInt(ctx.url.searchParams.get("offset"), 10) || 0);
    const q = text(ctx.url.searchParams.get("q"), 128).toLowerCase();
    const status = text(ctx.url.searchParams.get("status"), 32);
    const includeTest = ctx.url.searchParams.get("include_test") === "1";
    const base = `WITH accounts AS (
      SELECT u.id, u.email, u.username, u.created_at, u.email_verified, u.archived_at,
        CASE WHEN pending.id IS NOT NULL AND (l.id IS NULL OR pending.status IN ('active','assigned') AND (l.revoked = 1 OR l.is_active = 0 OR substr(l.expires_at,1,10) < ?))
          THEN pending.edition ELSE COALESCE(l.edition, '') END AS edition, l.license_id, l.expires_at,
        CASE WHEN l.license_id IS NULL THEN CASE WHEN pending.id IS NULL THEN 'unlicensed' WHEN pending.status IN ('suspended','revoked') THEN pending.status ELSE 'unactivated' END
          WHEN pending.id IS NOT NULL AND pending.status IN ('active','assigned') AND (l.revoked = 1 OR l.is_active = 0 OR substr(l.expires_at,1,10) < ?) THEN 'unactivated'
          WHEN l.revoked = 1 THEN 'revoked' WHEN substr(l.expires_at,1,10) < ? THEN 'expired'
          WHEN l.is_active = 0 OR l.approval_status IN ('pending','rejected') THEN 'pending'
          WHEN ac.notes LIKE 'auto_registration_trial%' OR ac.notes LIKE 'account_center_trial;%' THEN 'trial'
          ELSE 'active' END AS status
      FROM users u
      LEFT JOIN licenses l ON l.id = (SELECT chosen.id FROM licenses chosen
        LEFT JOIN activation_codes ca ON ca.id = chosen.activation_code_id WHERE chosen.user_id = u.id
        ORDER BY CASE WHEN chosen.is_active = 1 AND chosen.revoked = 0 AND substr(chosen.expires_at,1,10) >= ?
          AND COALESCE(chosen.approval_status,'auto') NOT IN ('pending','rejected')
          THEN CASE WHEN ca.notes LIKE 'auto_registration_trial%' OR ca.notes LIKE 'account_center_trial;%' THEN 1 ELSE 0 END
          ELSE 2 END, chosen.created_at DESC, chosen.id DESC LIMIT 1)
      LEFT JOIN activation_codes ac ON ac.id = l.activation_code_id
      LEFT JOIN activation_codes pending ON pending.id = (SELECT pc.id FROM activation_codes pc
        WHERE pc.assigned_to_user_id = u.id AND pc.status IN ('active','assigned','suspended','revoked')
          AND NOT EXISTS(SELECT 1 FROM licenses activated WHERE activated.activation_code_id = pc.id)
        ORDER BY CASE WHEN pc.status IN ('active','assigned') THEN 0 ELSE 1 END, pc.id DESC LIMIT 1)
    )`;
    const where = [ctx.url.searchParams.get("archived") === "1" ? "archived_at IS NOT NULL" : "archived_at IS NULL"], args = [todayIso(), todayIso(), todayIso(), todayIso()];
    if (!includeTest) where.push("lower(email) NOT LIKE '%@example.com' AND lower(email) NOT LIKE '%cf-test%' AND lower(username) NOT LIKE '%cf-test%'");
    if (q) { where.push("(lower(email) LIKE ? ESCAPE '\\' OR lower(username) LIKE ? ESCAPE '\\')"); const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`; args.push(pattern, pattern); }
    if (status) { where.push("status = ?"); args.push(status); }
    const filter = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const total = await ctx.env.DB.prepare(`${base} SELECT COUNT(*) AS total FROM accounts${filter}`).bind(...args).first();
    const items = list(await ctx.env.DB.prepare(`${base} SELECT * FROM accounts${filter} ORDER BY id DESC LIMIT ? OFFSET ?`).bind(...args, limit, offset).all())
      .map((item) => item.status === "unactivated" ? {...item, expires_at: ""} : item);
    return respond({items, page: {total: Number(total?.total || 0), limit, offset, has_more: offset + items.length < Number(total?.total || 0)}});
  });

  route("GET", "/v1/scorpio_v1_admin/users/detail", async (ctx) => {
    requireAdmin(ctx);
    return respond(await accountOverview(ctx.env, await findUser(ctx.env, ctx.url.searchParams.get("user_id"), true), true));
  });

  route("GET", "/v1/scorpio_v1_admin/authorizations", async (ctx) => {
    requireAdmin(ctx);
    const limit = Math.min(100, Math.max(1, Number.parseInt(ctx.url.searchParams.get("limit"), 10) || 25));
    const offset = Math.max(0, Number.parseInt(ctx.url.searchParams.get("offset"), 10) || 0);
    const q = text(ctx.url.searchParams.get("q"), 128).toLowerCase();
    const status = text(ctx.url.searchParams.get("status"), 32);
    // One row per account entitlement, not one row per machine credential.
    const base = `WITH linked AS (
      SELECT DISTINCT u.id AS user_id, ac.id AS code_id FROM users u JOIN activation_codes ac
        ON ac.assigned_to_user_id = u.id OR ac.used_by_user_id = u.id
        OR EXISTS(SELECT 1 FROM licenses ul WHERE ul.user_id = u.id AND ul.activation_code_id = ac.id)
    ), grants AS (
      SELECT u.id AS user_id, u.username, u.email, ac.id AS code_id, ac.code, ac.edition,
        ac.license_days, ac.max_devices, ac.notes AS grant_notes, ac.created_at,
        l.license_id, l.expires_at, l.revoked, l.is_active, l.approval_status, ac.status AS code_status,
        ac.archived_at, u.archived_at AS user_archived_at
      FROM linked x JOIN users u ON u.id = x.user_id JOIN activation_codes ac ON ac.id = x.code_id
      LEFT JOIN licenses l ON l.id = (SELECT chosen.id FROM licenses chosen
        WHERE chosen.user_id = u.id AND chosen.activation_code_id = ac.id
        ORDER BY CASE WHEN chosen.revoked = 1 THEN 3
          WHEN chosen.is_active = 1 AND COALESCE(chosen.approval_status,'auto') NOT IN ('pending','rejected') AND substr(chosen.expires_at,1,10) >= ? THEN 0
          WHEN substr(chosen.expires_at,1,10) < ? THEN 2 ELSE 1 END, chosen.expires_at DESC, chosen.id DESC LIMIT 1)
      UNION ALL
      SELECT u.id, u.username, u.email, NULL, '', l.edition, 0, 1, '', l.created_at,
        l.license_id, l.expires_at, l.revoked, l.is_active, l.approval_status, '', l.archived_at, u.archived_at
      FROM users u JOIN licenses l ON l.user_id = u.id
      WHERE l.activation_code_id IS NULL OR NOT EXISTS(SELECT 1 FROM activation_codes ac WHERE ac.id = l.activation_code_id)
    ), authorizations AS (
      SELECT *, CASE WHEN license_id IS NULL THEN CASE code_status
          WHEN 'revoked' THEN 'revoked' WHEN 'suspended' THEN 'suspended' ELSE 'unactivated' END
        WHEN revoked = 1 THEN 'revoked' WHEN substr(expires_at,1,10) < ? THEN 'expired'
        WHEN is_active = 0 OR approval_status IN ('pending','rejected') THEN 'pending'
        WHEN grant_notes LIKE 'auto_registration_trial%' OR grant_notes LIKE 'account_center_trial;%' THEN 'trial'
        ELSE 'active' END AS status
      FROM grants
    )`;
    const where = ["user_archived_at IS NULL", ctx.url.searchParams.get("archived") === "1" ? "archived_at IS NOT NULL" : "archived_at IS NULL"], args = [todayIso(), todayIso(), todayIso()];
    if (ctx.url.searchParams.get("include_test") !== "1") where.push("lower(email) NOT LIKE '%@example.com' AND lower(email) NOT LIKE '%cf-test%' AND lower(username) NOT LIKE '%cf-test%'");
    if (q) {
      const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
      where.push("(lower(email) LIKE ? ESCAPE '\\' OR lower(username) LIKE ? ESCAPE '\\' OR lower(code) LIKE ? ESCAPE '\\' OR lower(COALESCE(license_id,'')) LIKE ? ESCAPE '\\')");
      args.push(pattern, pattern, pattern, pattern);
    }
    const filter = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const counts = list(await ctx.env.DB.prepare(`${base} SELECT status, COUNT(*) AS total FROM authorizations${filter} GROUP BY status`).bind(...args).all());
    const selected = status ? `${filter}${filter ? " AND" : " WHERE"} status = ?` : filter;
    const selectedArgs = status ? [...args, status] : args;
    const total = counts.filter((item) => !status || item.status === status).reduce((sum, item) => sum + Number(item.total), 0);
    const items = list(await ctx.env.DB.prepare(`${base} SELECT * FROM authorizations${selected} ORDER BY created_at DESC, user_id DESC, code_id DESC LIMIT ? OFFSET ?`)
      .bind(...selectedArgs, limit, offset).all()).map(({grant_notes, revoked, is_active, approval_status, ...item}) => ({...item, kind: trialGrant({notes: grant_notes}) ? "trial" : "commercial"}));
    return respond({items, counts: Object.fromEntries(counts.map((item) => [item.status, Number(item.total)])),
      page: {total, offset, limit, has_more: offset + items.length < total}, server_time: new Date().toISOString()});
  });

  route("POST", "/v1/scorpio_v1_admin/users/code-action", async (ctx) => {
    requireAdmin(ctx);
    const body = await readJson(ctx.request, 8192), userId = ownerId(body.user_id);
    const payload = {code_id: integer(body.code_id, 1, Number.MAX_SAFE_INTEGER, "activation_code_not_found"), action: text(body.action, 20), reason: reason(body.reason)};
    if (!["edit", "suspend", "resume", "revoke", "restore"].includes(payload.action)) fail(400, "account_action_invalid");
    if (payload.action === "edit") {
      Object.assign(payload, {edition: normalizeEdition(body.edition), days: days(body.days), max_devices: integer(body.max_devices, 1, 20, "account_device_limit_invalid")});
      if (!EDITIONS.has(payload.edition)) fail(400, "account_edition_invalid");
    }
    const op = await operation(ctx, body, userId, `code_${payload.action}`, payload);
    if (op.cached) return respond(op.cached);
    const code = await ctx.env.DB.prepare("SELECT * FROM activation_codes WHERE id = ? AND (assigned_to_user_id = ? OR used_by_user_id = ?)").bind(payload.code_id, userId, userId).first();
    if (!code) fail(404, "activation_code_not_found");
    if (code.archived_at) fail(409, "account_record_archived");
    const activated = await ctx.env.DB.prepare("SELECT COUNT(*) AS total FROM licenses WHERE activation_code_id = ?").bind(code.id).first();
    if (Number(activated.total) || code.used_at || code.status === "used") fail(409, "account_code_already_activated");
    const allowed = {edit: ["active", "assigned", "suspended"], suspend: ["active", "assigned"], resume: ["suspended"], revoke: ["active", "assigned", "suspended"], restore: ["revoked"]};
    if (!allowed[payload.action].includes(code.status)) fail(409, "account_state_changed_refresh_required");
    const next = {edition: payload.edition || code.edition, days: payload.days || code.license_days, max_devices: payload.max_devices || code.max_devices,
      status: {suspend: "suspended", resume: "assigned", revoke: "revoked", restore: "assigned"}[payload.action] || code.status};
    const guard = owned(op);
    return respond(await commit(ctx, op, {ok: true, code_id: code.id, ...next}, [
      ctx.env.DB.prepare(`UPDATE activation_codes SET edition = ?, license_days = ?, max_devices = ?, status = ?
        WHERE id = ? AND status = ? AND edition = ? AND license_days = ? AND max_devices = ?
          AND NOT EXISTS(SELECT 1 FROM licenses WHERE activation_code_id = ?) AND ${guard.sql}`)
        .bind(next.edition, next.days, next.max_devices, next.status, code.id, code.status, code.edition, code.license_days, code.max_devices, code.id, ...guard.args),
    ], {sql: "EXISTS(SELECT 1 FROM activation_codes WHERE id = ? AND archived_at IS NULL AND edition = ? AND license_days = ? AND max_devices = ? AND status = ?) AND NOT EXISTS(SELECT 1 FROM licenses WHERE activation_code_id = ?)",
      args: [code.id, next.edition, next.days, next.max_devices, next.status, code.id]},
    [{reason: payload.reason, before: {code: code.code, edition: code.edition, days: code.license_days, max_devices: code.max_devices, status: code.status}, after: {code: code.code, ...next}}]));
  });

  route("POST", "/v1/scorpio_v1_admin/users/grant", async (ctx) => {
    requireAdmin(ctx);
    const body = await readJson(ctx.request, 8192), userId = ownerId(body.user_id);
    const payload = {edition: normalizeEdition(body.edition), days: days(body.days), max_devices: integer(body.max_devices, 1, 20, "account_device_limit_invalid"), reason: reason(body.reason)};
    if (!EDITIONS.has(payload.edition)) fail(400, "account_edition_invalid");
    const op = await operation(ctx, body, userId, "grant", payload);
    if (op.cached) return respond(op.cached);
    const user = await findUser(ctx.env, userId), code = await uniqueActivationCode(ctx.env), guard = owned(op);
    return respond(await commit(ctx, op, {ok: true, user_id: userId, code, edition: payload.edition, days: payload.days}, [
      ctx.env.DB.prepare(`INSERT INTO activation_codes(code, edition, license_days, max_devices, status, assigned_to_user_id, customer_name, customer_email, notes, created_at)
        SELECT ?, ?, ?, ?, 'assigned', ?, ?, ?, ?, ? WHERE ${guard.sql}`)
        .bind(code, payload.edition, payload.days, payload.max_devices, user.id, user.username, user.email,
          `account_center_commercial; ${payload.reason}`, new Date().toISOString(), ...guard.args),
    ], {sql: "EXISTS(SELECT 1 FROM activation_codes WHERE code = ? AND assigned_to_user_id = ?)", args: [code, user.id]},
    [{reason: payload.reason, after: {code, edition: payload.edition, days: payload.days, max_devices: payload.max_devices}}]), 201);
  });

  route("GET", "/v1/scorpio_v1_admin/users/license-file", async (ctx) => {
    requireAdmin(ctx);
    const userId = ownerId(ctx.url.searchParams.get("user_id"));
    const license = await ctx.env.DB.prepare("SELECT * FROM licenses WHERE user_id = ? AND license_id = ?")
      .bind(userId, text(ctx.url.searchParams.get("license_id"), 128)).first();
    if (!license) fail(404, "license_not_found");
    if (effectiveLicenseStatus(license, todayIso()) !== "active") fail(409, "license_inactive");
    return respond({license_file: parse(license.signed_payload)});
  });

  async function licenseAction(ctx, body, serviceRequest = null) {
    const user = await findUser(ctx.env, body.user_id);
    const payload = {license_id: text(body.license_id, 128), action: text(body.action, 20),
      days: body.action === "extend" ? days(body.days) : 0, reason: reason(body.reason), service_request: serviceRequest?.public_id || ""};
    if (!["extend", "revoke", "restore", "approve"].includes(payload.action)) fail(400, "account_action_invalid");
    const op = await operation(ctx, body, user.id, "license_action", payload);
    if (op.cached) return op.cached;
    if (serviceRequest && serviceRequest.status !== "pending") fail(409, "account_request_already_resolved");
    const target = await ctx.env.DB.prepare("SELECT * FROM licenses WHERE user_id = ? AND license_id = ?").bind(user.id, payload.license_id).first();
    if (!target) fail(404, "license_not_found");
    if (target.archived_at) fail(409, "account_record_archived");
    if (payload.action === "extend" && Number(target.revoked)) fail(409, "account_license_restore_required");
    if (payload.action === "restore" && !Number(target.revoked)) fail(409, "account_license_not_revoked");
    if (payload.action === "approve" && (Number(target.revoked) || effectiveLicenseStatus(target, todayIso()) !== "pending")) fail(409, "account_license_not_pending");
    let rows = target.activation_code_id ? list(await ctx.env.DB.prepare(
      `SELECT * FROM licenses WHERE user_id = ? AND activation_code_id = ? AND revoked = ? ORDER BY id`
    ).bind(user.id, target.activation_code_id, payload.action === "restore" ? 1 : 0).all()) : [target];
    if (payload.action === "approve") rows = rows.filter((row) => effectiveLicenseStatus(row, todayIso()) === "pending");
    if (!rows.length) fail(409, "account_state_changed_refresh_required");
    const base = rows.reduce((value, row) => row.expires_at > value ? row.expires_at : value, todayIso());
    const expires = payload.action === "extend" ? addDays(base.slice(0, 10), payload.days) : "";
    const guard = owned(op), mutations = [], checks = [], checkArgs = [], events = [];
    for (const row of rows) {
      let expectedSignature = row.signature;
      if (payload.action === "extend") {
        const previous = parse(row.signed_payload);
        const issued = await issueLicensePayload(ctx.env, {edition: row.edition, customerName: user.username,
          customerEmail: user.email, machineFingerprint: row.machine_fingerprint || "", licenseId: row.license_id,
          expiresAt: expires, features: previous.features || {}});
        expectedSignature = issued.signature;
        mutations.push(ctx.env.DB.prepare(`UPDATE licenses SET expires_at = ?, signed_payload = ?, signature = ?, nonce = ?
          WHERE id = ? AND user_id = ? AND revoked = 0 AND expires_at = ? AND ${guard.sql}`)
          .bind(expires, JSON.stringify(issued.payload), issued.signature, issued.payload.nonce, row.id, user.id, row.expires_at, ...guard.args));
        checks.push("EXISTS(SELECT 1 FROM licenses WHERE id = ? AND expires_at = ? AND signature = ?)");
        checkArgs.push(row.id, expires, expectedSignature);
      } else if (payload.action === "approve") {
        mutations.push(ctx.env.DB.prepare(`UPDATE licenses SET is_active = 1, approval_status = 'approved'
          WHERE id = ? AND user_id = ? AND revoked = 0 AND is_active = ? AND approval_status = ? AND ${guard.sql}`)
          .bind(row.id, user.id, row.is_active, row.approval_status, ...guard.args));
        checks.push("EXISTS(SELECT 1 FROM licenses WHERE id = ? AND is_active = 1 AND approval_status = 'approved' AND revoked = 0)"); checkArgs.push(row.id);
      } else {
        const revoked = payload.action === "revoke" ? 1 : 0;
        mutations.push(ctx.env.DB.prepare(`UPDATE licenses SET revoked = ?, is_active = ?, revoke_reason = ?
          WHERE id = ? AND user_id = ? AND revoked = ? AND ${guard.sql}`)
          .bind(revoked, revoked ? 0 : 1, revoked ? payload.reason : "", row.id, user.id, Number(row.revoked), ...guard.args));
        checks.push("EXISTS(SELECT 1 FROM licenses WHERE id = ? AND revoked = ?)"); checkArgs.push(row.id, revoked);
      }
      checks.push("EXISTS(SELECT 1 FROM licenses WHERE id=? AND archived_at IS NULL)"); checkArgs.push(row.id);
      events.push({license_id: row.license_id, action: payload.action, reason: payload.reason,
        before: {expires_at: row.expires_at, revoked: Boolean(row.revoked), approval_status: row.approval_status, machine_fingerprint: row.machine_fingerprint || ""},
        after: {expires_at: expires || row.expires_at, revoked: payload.action === "revoke", approval_status: payload.action === "approve" ? "approved" : row.approval_status, sync_status: "client_refresh_required"}});
    }
    if (target.activation_code_id && ["extend", "revoke"].includes(payload.action)) {
      checks.push("NOT EXISTS(SELECT 1 FROM licenses WHERE user_id = ? AND activation_code_id = ? AND revoked = 0" + (payload.action === "extend" ? " AND expires_at <> ?" : "") + ")");
      checkArgs.push(user.id, target.activation_code_id);
      if (payload.action === "extend") checkArgs.push(expires);
    }
    if (target.activation_code_id && ["revoke", "restore"].includes(payload.action)) {
      const code = await ctx.env.DB.prepare("SELECT * FROM activation_codes WHERE id = ?").bind(target.activation_code_id).first();
      if (code) {
        const nextStatus = payload.action === "revoke" ? "revoked" : "assigned";
        mutations.push(ctx.env.DB.prepare(`UPDATE activation_codes SET status = CASE WHEN ? = 'revoked' THEN 'revoked'
            WHEN (SELECT COUNT(*) FROM licenses WHERE activation_code_id = ? AND revoked = 0) >= max_devices THEN 'used' ELSE 'assigned' END
          WHERE id = ? AND status = ? AND ${guard.sql}`)
          .bind(nextStatus, code.id, code.id, code.status, ...guard.args));
        checks.push("EXISTS(SELECT 1 FROM activation_codes WHERE id = ? AND status " + (payload.action === "revoke" ? "= 'revoked'" : "IN ('assigned','used')") + ")"); checkArgs.push(code.id);
      }
    }
    if (serviceRequest) {
      mutations.push(ctx.env.DB.prepare(`UPDATE account_service_requests SET status = 'approved', resolution_note = ?, updated_at = ?
        WHERE public_id = ? AND user_id = ? AND status = 'pending' AND ${guard.sql}`)
        .bind(payload.reason, new Date().toISOString(), serviceRequest.public_id, user.id, ...guard.args));
      checks.push("EXISTS(SELECT 1 FROM account_service_requests WHERE public_id = ? AND status = 'approved')"); checkArgs.push(serviceRequest.public_id);
    }
    return commit(ctx, op, {ok: true, action: payload.action, affected_licenses: rows.length,
      expires_at: expires || target.expires_at, sync_status: "client_refresh_required"}, mutations, {sql: checks.join(" AND "), args: checkArgs}, events);
  }

  route("POST", "/v1/scorpio_v1_admin/users/license-action", async (ctx) => {
    requireAdmin(ctx);
    return respond(await licenseAction(ctx, await readJson(ctx.request, 8192)));
  });

  route("GET", "/v1/scorpio_v1_admin/account-requests", async (ctx) => {
    requireAdmin(ctx);
    const status = text(ctx.url.searchParams.get("status"), 20) || "pending";
    const items = list(await ctx.env.DB.prepare(
      `SELECT r.*, u.email, u.username, l.edition, l.expires_at FROM account_service_requests r
       JOIN users u ON u.id = r.user_id LEFT JOIN licenses l ON l.license_id = r.license_id AND l.user_id = r.user_id
       WHERE r.status = ? ORDER BY r.id DESC LIMIT 100`
    ).bind(status).all());
    return respond({items});
  });

  route("POST", "/v1/scorpio_v1_admin/account-requests/resolve", async (ctx) => {
    requireAdmin(ctx);
    const body = await readJson(ctx.request, 8192);
    const item = await ctx.env.DB.prepare("SELECT * FROM account_service_requests WHERE public_id = ?").bind(text(body.public_id, 128)).first();
    if (!item) fail(404, "account_request_not_found");
    const note = reason(body.reason);
    if (body.decision === "approved") {
      const result = await licenseAction(ctx, {...body, user_id: item.user_id, license_id: item.license_id,
        action: "extend", days: item.requested_days, reason: note}, item);
      return respond(result);
    }
    if (body.decision !== "rejected") fail(400, "account_action_invalid");
    const op = await operation(ctx, body, item.user_id, "reject_request", {public_id: item.public_id, reason: note});
    if (op.cached) return respond(op.cached);
    if (item.status !== "pending") fail(409, "account_request_already_resolved");
    const guard = owned(op);
    return respond(await commit(ctx, op, {ok: true, status: "rejected"}, [
      ctx.env.DB.prepare(`UPDATE account_service_requests SET status = 'rejected', resolution_note = ?, updated_at = ?
        WHERE public_id = ? AND status = 'pending' AND ${guard.sql}`).bind(note, new Date().toISOString(), item.public_id, ...guard.args),
    ], {sql: "EXISTS(SELECT 1 FROM account_service_requests WHERE public_id = ? AND status = 'rejected' AND resolution_note = ?)", args: [item.public_id, note]},
    [{license_id: item.license_id, reason: note, after: {request: item.public_id, status: "rejected"}}]));
  });

  route("POST", "/v1/scorpio_v1_admin/users/record-action", async (ctx) => {
    requireAdmin(ctx);
    const body = await readJson(ctx.request, 8192), user = await findUser(ctx.env, body.user_id, true);
    const payload = {kind: text(body.kind, 16), action: text(body.action, 16), code_id: body.code_id ? ownerId(body.code_id) : null, license_id: text(body.license_id, 128), reason: reason(body.reason)};
    if (!["user", "grant"].includes(payload.kind) || !["archive", "restore"].includes(payload.action)) fail(400, "account_action_invalid");
    const op = await operation(ctx, body, user.id, `${payload.action}_${payload.kind}`, payload);
    if (op.cached) return respond(op.cached);
    const archive = payload.action === "archive", now = new Date().toISOString(), archivedAt = archive ? now : null, guard = owned(op);
    const live = "revoked = 0 AND (expires_at IS NULL OR expires_at = '' OR substr(expires_at,1,10) >= ? OR approval_status = 'pending')";
    let table, row, eligible = "1=1", eligibleArgs = [], rows = [];
    if (payload.kind === "user") {
      table = "users"; row = user;
      eligible = `NOT EXISTS(SELECT 1 FROM licenses WHERE user_id=users.id AND ${live})
        AND NOT EXISTS(SELECT 1 FROM account_service_requests WHERE user_id=users.id AND status='pending')
        AND NOT EXISTS(SELECT 1 FROM activation_codes c WHERE (c.assigned_to_user_id=users.id OR c.used_by_user_id=users.id)
          AND c.status IN ('active','assigned','suspended') AND NOT EXISTS(SELECT 1 FROM licenses l WHERE l.activation_code_id=c.id))`;
      eligibleArgs = [todayIso()];
    } else if (payload.code_id) {
      if (user.archived_at) fail(409, "account_record_archived");
      table = "activation_codes";
      row = await ctx.env.DB.prepare(`SELECT * FROM activation_codes WHERE id=? AND (assigned_to_user_id=? OR used_by_user_id=? OR EXISTS(SELECT 1 FROM licenses WHERE activation_code_id=activation_codes.id AND user_id=?))`)
        .bind(payload.code_id, user.id, user.id, user.id).first();
      if (!row) fail(404, "activation_code_not_found");
      eligible = `NOT EXISTS(SELECT 1 FROM licenses WHERE activation_code_id=activation_codes.id AND (${live} OR user_id<>?))
        AND NOT EXISTS(SELECT 1 FROM account_service_requests r JOIN licenses l ON l.license_id=r.license_id WHERE l.activation_code_id=activation_codes.id AND r.status='pending')
        AND (status='revoked' OR EXISTS(SELECT 1 FROM licenses WHERE activation_code_id=activation_codes.id))`;
      eligibleArgs = [todayIso(), user.id];
      rows = list(await ctx.env.DB.prepare("SELECT * FROM licenses WHERE activation_code_id=? ORDER BY id").bind(row.id).all());
    } else {
      if (user.archived_at) fail(409, "account_record_archived");
      table = "licenses";
      row = await ctx.env.DB.prepare("SELECT * FROM licenses WHERE user_id=? AND license_id=? AND activation_code_id IS NULL").bind(user.id, payload.license_id).first();
      if (!row) fail(404, "license_not_found");
      eligible = `NOT (${live}) AND NOT EXISTS(SELECT 1 FROM account_service_requests WHERE license_id=licenses.license_id AND status='pending')`;
      eligibleArgs = [todayIso()];
    }
    if (Boolean(row.archived_at) === archive) fail(409, "account_state_changed_refresh_required");
    if (archive && !await ctx.env.DB.prepare(`SELECT id FROM ${table} WHERE id=? AND ${eligible}`).bind(row.id, ...eligibleArgs).first()) fail(409, "account_record_in_use");
    const mutations = [ctx.env.DB.prepare(`UPDATE ${table} SET archived_at=?,record_operation_id=? WHERE id=? AND record_operation_id=? AND ${archive ? eligible : "1=1"} AND ${guard.sql}`)
      .bind(archivedAt, op.id, row.id, row.record_operation_id || "", ...(archive ? eligibleArgs : []), ...guard.args)];
    const checks = [`EXISTS(SELECT 1 FROM ${table} WHERE id=? AND record_operation_id=?)`], checkArgs = [row.id, op.id];
    for (const item of rows) {
      mutations.push(ctx.env.DB.prepare(`UPDATE licenses SET archived_at=?,record_operation_id=? WHERE id=? AND record_operation_id=? AND ${guard.sql}`)
        .bind(archivedAt, op.id, item.id, item.record_operation_id || "", ...guard.args));
      checks.push("EXISTS(SELECT 1 FROM licenses WHERE id=? AND record_operation_id=?)"); checkArgs.push(item.id, op.id);
    }
    if (table === "activation_codes") {
      checks.push("NOT EXISTS(SELECT 1 FROM licenses WHERE activation_code_id=? AND record_operation_id<>?)"); checkArgs.push(row.id, op.id);
    }
    if (archive) { checks.push(`EXISTS(SELECT 1 FROM ${table} WHERE id=? AND ${eligible})`); checkArgs.push(row.id, ...eligibleArgs); }
    return respond(await commit(ctx, op, {ok: true, kind: payload.kind, archived: archive, user_id: user.id}, mutations,
      {sql: checks.join(" AND "), args: checkArgs}, [{license_id: row.license_id || "", reason: payload.reason,
        before: {archived: Boolean(row.archived_at)}, after: {archived: archive, kind: payload.kind, code_id: payload.code_id, license_id: payload.license_id}}]));
  });

  route("POST", "/v1/scorpio_v1_admin/users/device-action", async (ctx) => {
    requireAdmin(ctx);
    const body = await readJson(ctx.request, 8192), userId = ownerId(body.user_id);
    const payload = {device_id: integer(body.device_id, 1, Number.MAX_SAFE_INTEGER, "account_device_invalid"), reason: reason(body.reason)};
    const op = await operation(ctx, body, userId, "release_mobile_device", payload);
    if (op.cached) return respond(op.cached);
    const device = await ctx.env.DB.prepare("SELECT * FROM mobile_device_bindings WHERE id = ? AND user_id = ?").bind(payload.device_id, userId).first();
    if (!device) fail(404, "account_device_not_found");
    const guard = owned(op);
    return respond(await commit(ctx, op, {ok: true, status: "released"}, [
      ctx.env.DB.prepare(`UPDATE mobile_device_bindings SET revoked = 1 WHERE id = ? AND user_id = ? AND ${guard.sql}`)
        .bind(device.id, userId, ...guard.args),
    ], {sql: "EXISTS(SELECT 1 FROM mobile_device_bindings WHERE id = ? AND user_id = ? AND revoked = 1)", args: [device.id, userId]},
    [{license_id: device.license_id, reason: payload.reason, after: {device_id: device.id, status: "released"}}]));
  });
}
