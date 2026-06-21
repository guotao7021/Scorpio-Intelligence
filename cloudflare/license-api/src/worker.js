import { ed25519 } from "@noble/curves/ed25519";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
};

const TEXT_HEADERS = {
  "content-type": "text/plain; charset=utf-8",
};

const DEFAULT_ANALYSIS_COMPUTE_TIMEOUT_MS = 4500;
const DEFAULT_ANALYSIS_SHARED_CACHE_SECONDS = 300;

const ROUTES = new Map();

export default {
  async fetch(request, env, executionCtx) {
    const corsHeaders = cors(request, env);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = normalizePath(url.pathname);
    const key = `${request.method.toUpperCase()} ${path}`;
    const handler = ROUTES.get(key);

    try {
      if (!handler) {
        if (request.method === "GET" && path.startsWith("/v1/license/download/")) {
          const licenseId = decodeURIComponent(path.slice("/v1/license/download/".length)).trim();
          return withCors(await downloadLicenseFile({ request, env, licenseId }), corsHeaders);
        }
        if ((request.method === "PUT" || request.method === "DELETE") && path.startsWith("/v1/scorpio_v1_admin/customers/")) {
          const customerId = Number(decodeURIComponent(path.slice("/v1/scorpio_v1_admin/customers/".length)).trim());
          if (request.method === "PUT") {
            return withCors(await updateAdminCustomer({ request, env, customerId }), corsHeaders);
          }
          return withCors(await deleteAdminCustomer({ request, env, customerId }), corsHeaders);
        }
        if ((request.method === "PUT" || request.method === "DELETE") && path.startsWith("/v1/scorpio_v1_admin/activation-codes/")) {
          const code = decodeURIComponent(path.slice("/v1/scorpio_v1_admin/activation-codes/".length)).trim().toUpperCase();
          if (request.method === "PUT") {
            return withCors(await updateAdminActivationCode({ request, env, code }), corsHeaders);
          }
          return withCors(await revokeAdminActivationCode({ request, env, code }), corsHeaders);
        }
        if ((request.method === "PUT" || request.method === "DELETE") && path.startsWith("/v1/scorpio_v1_admin/licenses/")) {
          const licenseId = decodeURIComponent(path.slice("/v1/scorpio_v1_admin/licenses/".length)).trim();
          if (request.method === "PUT") {
            return withCors(await updateAdminLicense({ request, env, licenseId }), corsHeaders);
          }
          return withCors(await revokeAdminLicense({ request, env, licenseId }), corsHeaders);
        }
        if (request.method === "PUT" && path.startsWith("/v1/scorpio_v1_admin/feedback/")) {
          const feedbackId = Number(decodeURIComponent(path.slice("/v1/scorpio_v1_admin/feedback/".length)).trim());
          return withCors(await updateAdminFeedback({ request, env, feedbackId }), corsHeaders);
        }
        if (request.method === "GET" && path === "/health") {
          return json({ ok: true, service: "scorpio-license-api" }, 200, corsHeaders);
        }
        return json({ error: "not_found" }, 404, corsHeaders);
      }
      const result = await handler({ request, env, url, corsHeaders, executionCtx });
      return withCors(result, corsHeaders);
    } catch (error) {
      const message = error && error.publicMessage ? error.publicMessage : "internal_server_error";
      const status = error && error.status ? error.status : 500;
      return json({ error: message }, status, corsHeaders);
    }
  },
};

route("POST", "/v1/auth/register", async (ctx) => {
  const body = await readJson(ctx.request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const username = safeUsername(body.username || email.split("@")[0]);
  const verificationCode = String(body.verification_code || body.code || "").trim();

  if (!isEmail(email)) {
    return json({ error: "email_invalid" }, 400);
  }
  if (password.length < 8) {
    return json({ error: "password_too_short" }, 400);
  }
  if (!verificationCode) {
    return json({ error: "verification_code_required" }, 400);
  }

  const existing = await ctx.env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(email)
    .first();
  if (existing) {
    return json({ error: "email_exists" }, 409);
  }

  await consumeVerificationCode(ctx.env, email, "register", verificationCode);

  const now = nowIso();
  const passwordHash = await hashPassword(password);
  const insert = await ctx.env.DB.prepare(
    "INSERT INTO users (email, username, password_hash, email_verified, registered_ip, created_at) VALUES (?, ?, ?, 1, ?, ?)"
  )
    .bind(email, username, passwordHash, clientIp(ctx.request), now)
    .run();

  const userId = insert.meta.last_row_id;
  const trial = await createTrialActivationCode(ctx.env, {
    userId,
    username,
    email,
  });

  return json(
    {
      user_id: userId,
      email,
      ...trial,
      message: "registered",
      email_verified: true,
    },
    201
  );
});

route("POST", "/v1/auth/login", async (ctx) => {
  const body = await readJson(ctx.request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const user = await ctx.env.DB.prepare("SELECT * FROM users WHERE email = ?")
    .bind(email)
    .first();

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return json({ error: "invalid_credentials" }, 401);
  }
  if (!Number(user.email_verified)) {
    return json({ error: "email_not_verified" }, 403);
  }

  return json(await tokenResponse(ctx.env, user));
});

route("POST", "/v1/auth/refresh", async (ctx) => {
  const body = await readJson(ctx.request);
  const payload = await verifyJwt(String(body.refresh_token || ""), ctx.env);
  if (payload.type !== "refresh") {
    return json({ error: "refresh_token_required" }, 400);
  }
  const user = await ctx.env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(payload.user_id)
    .first();
  if (!user) {
    return json({ error: "invalid_token" }, 401);
  }
  return json(await tokenResponse(ctx.env, user));
});

route("POST", "/v1/auth/verify-email", async (ctx) => {
  const body = await readJson(ctx.request);
  const email = normalizeEmail(body.email);
  const code = String(body.verification_code || body.code || "").trim();
  if (!isEmail(email)) {
    return json({ error: "email_invalid" }, 400);
  }
  if (!code) {
    return json({ error: "verification_code_required" }, 400);
  }
  await consumeVerificationCode(ctx.env, email, "register", code);
  await ctx.env.DB.prepare("UPDATE users SET email_verified = 1 WHERE email = ?").bind(email).run();
  return json({ verified: true });
});

route("POST", "/v1/auth/send-code", async (ctx) => {
  const body = await readJson(ctx.request);
  const email = normalizeEmail(body.email);
  const purpose = normalizeVerificationPurpose(body.purpose || "register");

  if (!isEmail(email)) {
    return json({ error: "email_invalid" }, 400);
  }

  const existing = await ctx.env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(email)
    .first();
  if (purpose === "register" && existing) {
    return json({ error: "email_exists" }, 409);
  }

  const code = sixDigitCode();
  const now = nowIso();
  const expiresAt = new Date(Date.now() + intEnv(ctx.env.AUTH_CODE_TTL_SECONDS, 600) * 1000).toISOString();
  const codeHash = await verificationCodeHash(ctx.env, email, purpose, code);

  await ctx.env.DB.prepare(
    `INSERT INTO auth_verification_codes
     (email, purpose, code_hash, expires_at, client_ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(email, purpose, codeHash, expiresAt, clientIp(ctx.request), now)
    .run();

  await sendVerificationEmail(ctx.env, { email, purpose, code, expiresAt });
  const payload = { message: "verification_code_sent", expires_at: expiresAt };
  if (String(ctx.env.AUTH_DEBUG_CODE || "") === "1") {
    payload.debug_code = code;
  }
  return json(payload);
});

route("POST", "/v1/auth/forgot-password", async (ctx) => {
  const body = await readJson(ctx.request);
  const email = normalizeEmail(body.email);
  if (!isEmail(email)) {
    return json({ error: "email_invalid" }, 400);
  }
  await issueVerificationCode(ctx, email, "reset_password");
  return json({ message: "password_reset_code_sent_if_account_exists" });
});

route("POST", "/v1/auth/reset-password", async (ctx) => {
  const body = await readJson(ctx.request);
  const email = normalizeEmail(body.email);
  const code = String(body.verification_code || body.code || "").trim();
  const password = String(body.new_password || body.password || "");

  if (!isEmail(email)) {
    return json({ error: "email_invalid" }, 400);
  }
  if (!code) {
    return json({ error: "verification_code_required" }, 400);
  }
  if (password.length < 8) {
    return json({ error: "password_too_short" }, 400);
  }

  const user = await ctx.env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(email)
    .first();
  if (!user) {
    return json({ message: "password_reset_accepted" });
  }

  await consumeVerificationCode(ctx.env, email, "reset_password", code);
  await ctx.env.DB.prepare("UPDATE users SET password_hash = ?, email_verified = 1 WHERE email = ?")
    .bind(await hashPassword(password), email)
    .run();
  return json({ message: "password_reset" });
});

route("POST", "/v1/license/activate", async (ctx) => {
  const user = await requireUser(ctx);
  const body = await readJson(ctx.request);
  const activationCode = String(body.activation_code || "").trim().toUpperCase();
  const machineFingerprint = String(body.machine_fingerprint || "").trim();
  const clientVersion = String(body.client_version || "").trim();

  if (!activationCode || !machineFingerprint) {
    return json({ error: "activation_code_and_machine_fingerprint_required" }, 400);
  }

  const code = await ctx.env.DB.prepare("SELECT * FROM activation_codes WHERE code = ?")
    .bind(activationCode)
    .first();
  if (!code) {
    return json({ error: "activation_code_invalid_or_used" }, 400);
  }

  const existingLicense = await ctx.env.DB.prepare(
    `SELECT *
     FROM licenses
     WHERE activation_code_id = ? AND user_id = ? AND machine_fingerprint = ? AND revoked = 0
     ORDER BY id DESC
     LIMIT 1`
  )
    .bind(code.id, user.id, machineFingerprint)
    .first();
  if (existingLicense) {
    const now = nowIso();
    const isUsableExisting =
      Number(existingLicense.is_active || 0) &&
      !["pending", "rejected"].includes(String(existingLicense.approval_status || "")) &&
      existingLicense.expires_at >= todayIso();
    await ctx.env.DB.batch([
      ctx.env.DB.prepare(
        `INSERT INTO validation_logs
         (license_id, user_id, machine_fingerprint, client_version, client_ip, is_valid, fail_reason, validated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        existingLicense.license_id,
        user.id,
        machineFingerprint,
        clientVersion,
        clientIp(ctx.request),
        isUsableExisting ? 1 : 0,
        isUsableExisting ? "" : "existing_license_inactive",
        now
      ),
      isUsableExisting
        ? ctx.env.DB.prepare("UPDATE licenses SET last_online_check = ? WHERE id = ?").bind(now, existingLicense.id)
        : ctx.env.DB.prepare("SELECT 1").bind(),
    ]);
    if (!isUsableExisting) {
      return json({
        error: "existing_license_inactive",
        license_id: existingLicense.license_id,
        edition: existingLicense.edition,
        expires_at: existingLicense.expires_at,
      }, 400);
    }
    return json(licenseActivationResponse(existingLicense, {
      idempotent: true,
      message: "activation_already_completed",
    }));
  }

  if (!canUseActivationCode(user, code, machineFingerprint)) {
    return json({ error: "activation_code_invalid_or_used" }, 400);
  }

  const existingCount = await ctx.env.DB.prepare(
    "SELECT COUNT(*) AS count FROM licenses WHERE activation_code_id = ? AND revoked = 0"
  )
    .bind(code.id)
    .first();
  if (Number(existingCount.count || 0) >= Number(code.max_devices || 1)) {
    return json({ error: "device_limit_reached" }, 400);
  }

  const autoIssue = listEnv(ctx.env.LICENSE_AUTO_ISSUE_EDITIONS, "personal_standard,personal_pro").includes(
    code.edition
  );
  const issued = await issueLicensePayload(ctx.env, {
    edition: code.edition,
    customerName: user.username || user.email,
    customerEmail: user.email,
    machineFingerprint,
    days: Number(code.license_days || 365),
  });

  const now = nowIso();
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      `INSERT INTO licenses
       (user_id, activation_code_id, license_id, edition, machine_fingerprint, signed_payload, signature, nonce,
        issued_at, expires_at, is_active, approval_status, max_offline_days, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      user.id,
      code.id,
      issued.license_id,
      issued.edition,
      machineFingerprint,
      JSON.stringify(issued.payload),
      issued.signature,
      issued.payload.nonce,
      issued.issued_at,
      issued.expires_at,
      autoIssue ? 1 : 0,
      autoIssue ? "auto" : "pending",
      intEnv(ctx.env.MAX_OFFLINE_DAYS, 7),
      now
    ),
    ctx.env.DB.prepare(
      "UPDATE activation_codes SET status = 'used', used_by_user_id = ?, used_at = ? WHERE id = ?"
    ).bind(user.id, now, code.id),
    ctx.env.DB.prepare(
      `INSERT INTO validation_logs
       (license_id, user_id, machine_fingerprint, client_version, client_ip, is_valid, fail_reason, validated_at)
       VALUES (?, ?, ?, ?, ?, 1, '', ?)`
    ).bind(issued.license_id, user.id, machineFingerprint, clientVersion, clientIp(ctx.request), now),
  ]);

  if (!autoIssue) {
    return json(
      {
        license_id: issued.license_id,
        edition: issued.edition,
        status: "pending_approval",
        message: "activation_pending_admin_approval",
      },
      202
    );
  }

  return json(
    licenseActivationResponse({
      license_id: issued.license_id,
      edition: issued.edition,
      expires_at: issued.expires_at,
      signed_payload: JSON.stringify(issued.payload),
    }),
    201
  );
});

route("POST", "/v1/license/status", async (ctx) => {
  const user = await requireUser(ctx);
  const body = await readJson(ctx.request);
  const licenseId = String(body.license_id || "").trim();
  const machineFingerprint = String(body.machine_fingerprint || "").trim();
  const clientVersion = String(body.client_version || "").trim();

  const lic = await ctx.env.DB.prepare("SELECT * FROM licenses WHERE license_id = ? AND user_id = ?")
    .bind(licenseId, user.id)
    .first();
  if (!lic) {
    return json({ valid: false, reason: "not_found", message: "license_not_found" });
  }

  const today = todayIso();
  const now = nowIso();
  let valid = true;
  let reason = "";
  let message = "ok";

  if (Number(lic.revoked)) {
    valid = false;
    reason = "revoked";
    message = lic.revoke_reason || "license_revoked";
  } else if (lic.expires_at < today) {
    valid = false;
    reason = "expired";
    message = "license_expired";
  } else if (!Number(lic.is_active) || ["pending", "rejected"].includes(String(lic.approval_status || ""))) {
    valid = false;
    reason = lic.approval_status === "pending" ? "pending_approval" : "inactive";
    message = "license_inactive";
  } else if (lic.machine_fingerprint && machineFingerprint && lic.machine_fingerprint !== machineFingerprint) {
    valid = false;
    reason = "machine_mismatch";
    message = "machine_fingerprint_mismatch";
  }

  await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      `INSERT INTO validation_logs
       (license_id, user_id, machine_fingerprint, client_version, client_ip, is_valid, fail_reason, validated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(licenseId, user.id, machineFingerprint, clientVersion, clientIp(ctx.request), valid ? 1 : 0, reason, now),
    valid
      ? ctx.env.DB.prepare("UPDATE licenses SET last_online_check = ? WHERE id = ?").bind(now, lic.id)
      : ctx.env.DB.prepare("SELECT 1").bind(),
  ]);

  return json({
    valid,
    reason,
    message,
    license_id: lic.license_id,
    edition: lic.edition,
    expires_at: lic.expires_at,
    days_left: Math.max(0, daysBetween(today, lic.expires_at)),
    is_revoked: Boolean(Number(lic.revoked)),
    max_offline_days: Number(lic.max_offline_days || intEnv(ctx.env.MAX_OFFLINE_DAYS, 7)),
    features: parseJson(lic.signed_payload).features || {},
    server_time: now,
  });
});

route("POST", "/v1/license/rebind", async (ctx) => {
  const user = await requireUser(ctx);
  const body = await readJson(ctx.request);
  const licenseId = String(body.license_id || "").trim();
  const machineFingerprint = String(body.machine_fingerprint || "").trim();

  if (!licenseId || !machineFingerprint) {
    return json({ error: "license_id_and_machine_fingerprint_required" }, 400);
  }

  const lic = await ctx.env.DB.prepare("SELECT * FROM licenses WHERE license_id = ? AND user_id = ?")
    .bind(licenseId, user.id)
    .first();
  if (!lic) {
    return json({ error: "license_not_found" }, 404);
  }
  if (Number(lic.revoked)) {
    return json({ error: "license_revoked" }, 400);
  }

  const history = parseJson(lic.machine_fingerprint_history, []);
  if (lic.machine_fingerprint) {
    history.push({ fingerprint: lic.machine_fingerprint, changed_at: nowIso() });
  }

  const remainingDays = Math.max(1, daysBetween(todayIso(), lic.expires_at));
  const issued = await issueLicensePayload(ctx.env, {
    edition: lic.edition,
    customerName: user.username || user.email,
    customerEmail: user.email,
    machineFingerprint,
    days: remainingDays,
    licenseId: lic.license_id,
  });

  await ctx.env.DB.prepare(
    `UPDATE licenses
     SET machine_fingerprint = ?, machine_fingerprint_history = ?, signed_payload = ?, signature = ?, nonce = ?
     WHERE id = ?`
  )
    .bind(
      machineFingerprint,
      JSON.stringify(history),
      JSON.stringify(issued.payload),
      issued.signature,
      issued.payload.nonce,
      lic.id
    )
    .run();

  return json({
    message: "machine_rebound",
    license_id: lic.license_id,
    license_file: issued.payload,
  });
});

async function downloadLicenseFile(ctx) {
  const user = await requireUser(ctx);
  const licenseId = String(ctx.licenseId || "").trim();
  if (!licenseId) {
    return json({ error: "license_id_required" }, 400);
  }

  const lic = await ctx.env.DB.prepare("SELECT * FROM licenses WHERE license_id = ? AND user_id = ?")
    .bind(licenseId, user.id)
    .first();
  if (!lic) {
    return json({ error: "license_not_found" }, 404);
  }

  const payload = parseJson(lic.signed_payload);
  if (!payload || !payload.signature) {
    return json({ error: "license_payload_incomplete" }, 500);
  }

  return json(payload, 200, {
    "content-disposition": `attachment; filename="license-${licenseId}.json"`,
  });
}

function licenseActivationResponse(license, extras = {}) {
  const payload = parseJson(license.signed_payload, {});
  return {
    license_id: license.license_id,
    edition: license.edition || payload.edition || "",
    expires_at: license.expires_at || payload.expires_at || "",
    customer_name: payload.customer_name || "",
    features: payload.features || {},
    license_file: payload,
    ...extras,
  };
}

route("POST", "/v1/usage/report", async (ctx) => {
  const user = await requireUser(ctx);
  const body = await readJson(ctx.request);
  const licenseId = String(body.license_id || "").trim();
  const machineFingerprint = String(body.machine_fingerprint || "").trim();

  const lic = licenseId
    ? await ctx.env.DB.prepare("SELECT * FROM licenses WHERE license_id = ? AND user_id = ?")
        .bind(licenseId, user.id)
        .first()
    : await ctx.env.DB.prepare(
        "SELECT * FROM licenses WHERE user_id = ? AND is_active = 1 AND revoked = 0 ORDER BY created_at DESC LIMIT 1"
      )
        .bind(user.id)
        .first();

  if (!lic) {
    return json({ error: "active_license_not_found" }, 400);
  }

  await ctx.env.DB.prepare(
    `INSERT INTO usage_reports
     (license_id, user_id, machine_fingerprint, session_start, session_end, session_duration_seconds,
      feature_usage, client_version, os_version, reported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      lic.license_id,
      user.id,
      machineFingerprint,
      nullableText(body.session_start),
      nullableText(body.session_end),
      Number(body.duration_seconds || 0),
      JSON.stringify(body.feature_usage || {}),
      nullableText(body.client_version),
      nullableText(body.os_version),
      nowIso()
    )
    .run();

  return json({ accepted: true });
});

route("POST", "/v1/feedback", async (ctx) => {
  const body = await readJson(ctx.request);
  const item = normalizeFeedbackSubmission(body);
  const now = nowIso();
  const publicId = `FB-${Date.now().toString(36).toUpperCase()}-${randomToken(4).toUpperCase()}`;

  await ctx.env.DB.prepare(
    `INSERT INTO feedback_items
       (public_id, type, product_area, priority, status, title, description,
        contact_email, page_url, client_version, environment, rating, survey_answers,
        client_ip, user_agent, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      publicId,
      item.type,
      item.product_area,
      item.priority,
      item.title,
      item.description,
      item.contact_email,
      item.page_url,
      item.client_version,
      item.environment,
      item.rating,
      JSON.stringify(item.survey_answers),
      clientIp(ctx.request),
      safeText(ctx.request.headers.get("user-agent") || "", 400),
      now,
      now
    )
    .run();

  return json({ accepted: true, public_id: publicId, status: "new" }, 201);
});

route("GET", "/v1/scorpio_v1_admin/feedback", async (ctx) => {
  requireAdmin(ctx);
  const options = adminListOptions(ctx.url, { defaultLimit: 80, maxLimit: 300 });
  const type = normalizeFeedbackType(ctx.url.searchParams.get("type") || "", "");
  const where = [];
  const params = [];

  addListTextSearch(where, params, ["public_id", "title", "description", "contact_email", "product_area", "admin_notes"], options.q);
  if (options.status) {
    where.push("status = ?");
    params.push(normalizeFeedbackStatus(options.status, "new"));
  }
  if (type) {
    where.push("type = ?");
    params.push(type);
  }
  const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = await ctx.env.DB.prepare(`SELECT COUNT(*) AS total FROM feedback_items ${filter}`).bind(...params).first();
  const rows = await ctx.env.DB.prepare(
    `SELECT id, public_id, type, product_area, priority, status, title, description,
            contact_email, page_url, client_version, environment, rating, survey_answers,
            admin_notes, client_ip, user_agent, created_at, updated_at
     FROM feedback_items
     ${filter}
     ORDER BY
       CASE status WHEN 'new' THEN 0 WHEN 'triaged' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'resolved' THEN 3 ELSE 4 END,
       updated_at DESC,
       id DESC
     LIMIT ? OFFSET ?`
  ).bind(...params, options.limit, options.offset).all();

  return json(pageResponse(rows.results || [], total, options));
});

route("GET", "/v1/releases/latest", async (ctx) => {
  const edition = ctx.url.searchParams.get("edition") || "personal_pro";
  const channel = ctx.url.searchParams.get("channel") || "stable";
  const latest = await latestRelease(ctx.env, edition, channel);
  if (!latest) {
    return json({ error: "release_not_found" }, 404);
  }
  return json(releasePayload(latest));
});

route("GET", "/v1/releases/check", async (ctx) => {
  const current = ctx.url.searchParams.get("version") || "";
  const edition = ctx.url.searchParams.get("edition") || "personal_pro";
  const channel = ctx.url.searchParams.get("channel") || "stable";
  const latest = await latestRelease(ctx.env, edition, channel);
  if (!latest) {
    return json({ has_update: false, message: "release_not_found" });
  }
  return json({
    has_update: versionGreater(latest.version, current),
    ...releasePayload(latest),
  });
});

route("GET", "/v1/analysis/health", async (ctx) => {
  return json({
    ok: true,
    service: "scorpio-analysis-api",
    mode: analysisComputeConfigured(ctx.env) ? "compute_proxy" : "contract_ready",
    generated_at: nowIso(),
  });
});

route("POST", "/v1/analysis/stock/bundle", async (ctx) => {
  const startedAt = Date.now();
  const user = await requireUser(ctx);
  const body = await readJson(ctx.request);
  const request = normalizeAnalysisRequest(body, "stock");
  const license = await verifyAnalysisLicense(ctx.env, user, request.license_id);

  if (analysisComputeConfigured(ctx.env)) {
    return proxyAnalysisCompute(ctx, {
      endpoint: "/v1/analysis/stock/bundle",
      body: { ...request, user_id: user.id, email: user.email },
      user,
      license,
      startedAt,
    });
  }

  const response = contractStockBundle(request, {
    user,
    license,
    endpoint: "/v1/analysis/stock/bundle",
  });
  await recordAnalysisRequest(ctx.env, {
    user,
    license,
    endpoint: "/v1/analysis/stock/bundle",
    assetType: "stock",
    assetCode: request.code,
    request,
    clientIp: clientIp(ctx.request),
    status: response.status,
    latencyMs: Date.now() - startedAt,
  });
  return json(response);
});

route("POST", "/v1/analysis/stock/price-technical", async (ctx) => {
  const startedAt = Date.now();
  const user = await requireUser(ctx);
  const body = await readJson(ctx.request);
  const request = normalizeAnalysisRequest(body, "stock");
  const license = await verifyAnalysisLicense(ctx.env, user, request.license_id);

  if (analysisComputeConfigured(ctx.env)) {
    return proxyAnalysisCompute(ctx, {
      endpoint: "/v1/analysis/stock/price-technical",
      body: { ...request, user_id: user.id, email: user.email },
      user,
      license,
      startedAt,
    });
  }

  const response = contractFeatureBundle(request, {
    user,
    license,
    endpoint: "/v1/analysis/stock/price-technical",
    feature: "price_technical",
  });
  await recordAnalysisRequest(ctx.env, {
    user,
    license,
    endpoint: "/v1/analysis/stock/price-technical",
    assetType: "stock",
    assetCode: request.code,
    request,
    clientIp: clientIp(ctx.request),
    status: response.status,
    latencyMs: Date.now() - startedAt,
  });
  return json(response);
});

route("POST", "/v1/analysis/stock/reason", async (ctx) => {
  const startedAt = Date.now();
  const user = await requireUser(ctx);
  const body = await readJson(ctx.request);
  const request = normalizeAnalysisRequest(body, "stock");
  const license = await verifyAnalysisLicense(ctx.env, user, request.license_id);

  if (analysisComputeConfigured(ctx.env)) {
    return proxyAnalysisCompute(ctx, {
      endpoint: "/v1/analysis/stock/reason",
      body: { ...request, user_id: user.id, email: user.email },
      user,
      license,
      startedAt,
    });
  }

  const response = contractFeatureBundle(request, {
    user,
    license,
    endpoint: "/v1/analysis/stock/reason",
    feature: "reason",
  });
  await recordAnalysisRequest(ctx.env, {
    user,
    license,
    endpoint: "/v1/analysis/stock/reason",
    assetType: "stock",
    assetCode: request.code,
    request,
    clientIp: clientIp(ctx.request),
    status: response.status,
    latencyMs: Date.now() - startedAt,
  });
  return json(response);
});

route("POST", "/v1/analysis/stock/fundamental", async (ctx) => {
  return handleStockAnalysisPost(ctx, {
    endpoint: "/v1/analysis/stock/fundamental",
    feature: "fundamental",
  });
});

route("POST", "/v1/analysis/stock/financial", async (ctx) => {
  return handleStockAnalysisPost(ctx, {
    endpoint: "/v1/analysis/stock/financial",
    feature: "financial",
  });
});

route("POST", "/v1/analysis/stock/news", async (ctx) => {
  return handleStockAnalysisPost(ctx, {
    endpoint: "/v1/analysis/stock/news",
    feature: "news",
  });
});

route("GET", "/v1/analysis/market/overview", async (ctx) => {
  return handleSharedAnalysisGet(ctx, {
    endpoint: "/v1/analysis/market/overview",
    assetType: "market",
    feature: "market_overview",
  });
});

route("GET", "/v1/analysis/industry/overview", async (ctx) => {
  return handleSharedAnalysisGet(ctx, {
    endpoint: "/v1/analysis/industry/overview",
    assetType: "industry",
    feature: "industry_overview",
  });
});

route("GET", "/v1/analysis/capital/flow", async (ctx) => {
  return handleSharedAnalysisGet(ctx, {
    endpoint: "/v1/analysis/capital/flow",
    assetType: "market",
    feature: "capital_flow",
  });
});

route("GET", "/v1/analysis/fund/bundle", async (ctx) => {
  return handleAssetAnalysisGet(ctx, {
    endpoint: "/v1/analysis/fund/bundle",
    assetType: "fund",
    feature: "fund_bundle",
  });
});

route("GET", "/v1/analysis/bond/bundle", async (ctx) => {
  return handleAssetAnalysisGet(ctx, {
    endpoint: "/v1/analysis/bond/bundle",
    assetType: "bond",
    feature: "bond_bundle",
  });
});

route("POST", "/v1/analysis/portfolio/enrich", async (ctx) => {
  const startedAt = Date.now();
  const user = await requireUser(ctx);
  const body = await readJson(ctx.request);
  const request = normalizePortfolioRequest(body);
  const license = await verifyAnalysisLicense(ctx.env, user, request.license_id);

  if (analysisComputeConfigured(ctx.env)) {
    return proxyAnalysisCompute(ctx, {
      endpoint: "/v1/analysis/portfolio/enrich",
      body: { ...request, user_id: user.id, email: user.email },
      user,
      license,
      startedAt,
    });
  }

  const response = {
    status: "contract_ready",
    feature: "portfolio_enrich",
    as_of: nowIso(),
    data_quality: {
      level: "not_computed",
      freshness: "not_bound",
      missing: ["analysis_compute_service"],
    },
    summary: {
      title: "Analysis contract is ready",
      brief: "The Cloudflare API has authentication and safe response contracts. Bind Analysis Compute to enable real portfolio enrichment.",
      risk_level: "unknown",
    },
    portfolio: {
      position_count: request.positions.length,
      uploaded_fields: ["asset_type", "code", "weight"],
    },
    risk_flags: [],
    next_actions: ["Bind Analysis Compute before enabling production portfolio enrichment."],
    source: safeAnalysisSource("/v1/analysis/portfolio/enrich", user, license),
  };
  await recordAnalysisRequest(ctx.env, {
    user,
    license,
    endpoint: "/v1/analysis/portfolio/enrich",
    assetType: "portfolio",
    assetCode: "",
    request,
    clientIp: clientIp(ctx.request),
    status: response.status,
    latencyMs: Date.now() - startedAt,
  });
  return json(response);
});

route("POST", "/v1/scorpio_v1_admin/activation-codes", async (ctx) => {
  requireAdmin(ctx);
  const body = await readJson(ctx.request);
  const count = Math.min(Math.max(Number(body.count || 1), 1), 100);
  const edition = normalizeEdition(body.edition || "personal_pro");
  const days = Math.max(Number(body.license_days || body.days || 365), 1);
  const maxDevices = Math.max(Number(body.max_devices || 1), 1);
  const email = body.email ? normalizeEmail(body.email) : "";
  if (email && !isEmail(email)) {
    return json({ error: "email_invalid" }, 400);
  }
  const user = email
    ? await ctx.env.DB.prepare("SELECT id, username, email FROM users WHERE email = ?").bind(email).first()
    : null;
  const customer = await resolveCustomerForActivation(ctx.env, {
    customerId: body.customer_id,
    userId: user ? user.id : null,
    customerName: body.customer_name || (user ? user.username : ""),
    customerEmail: email,
    edition,
    licenseDays: days,
    machineFingerprintPrebind: body.machine_fingerprint_prebind || "",
    notes: body.notes || "",
  });

  const codes = [];
  const statements = [];
  for (let i = 0; i < count; i += 1) {
    const code = await uniqueActivationCode(ctx.env);
    codes.push(code);
    statements.push(
      ctx.env.DB.prepare(
        `INSERT INTO activation_codes
         (code, edition, license_days, max_devices, status, assigned_to_user_id, customer_id, customer_name, customer_email,
          machine_fingerprint_prebind, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        code,
        edition,
        days,
        maxDevices,
        user ? "assigned" : "active",
        user ? user.id : null,
        customer ? customer.id : null,
        customer ? customer.customer_name : body.customer_name || (user ? user.username : ""),
        email,
        customer ? customer.machine_fingerprint_prebind : body.machine_fingerprint_prebind || "",
        body.notes || "created_by_worker_admin_api",
        nowIso()
      )
    );
  }
  await ctx.env.DB.batch(statements);
  await audit(ctx.env, "create_activation_codes", "admin_api", {
    count,
    edition,
    email,
    customer_id: customer ? customer.id : null,
  });
  return json({ codes, edition, license_days: days, max_devices: maxDevices, customer }, 201);
});

route("GET", "/v1/scorpio_v1_admin/overview", async (ctx) => {
  requireAdmin(ctx);
  const today = todayIso();
  const expiringBefore = addDays(today, 30);
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [customers, codes, licenses, releases, analysis, recentAudits, recentLicenses, expiringLicenses] =
    await Promise.all([
      ctx.env.DB.prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status IN ('active', 'issued') THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft,
                SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended
         FROM customers`
      ).first(),
      ctx.env.DB.prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END) AS assigned,
                SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) AS used,
                SUM(CASE WHEN status = 'revoked' THEN 1 ELSE 0 END) AS revoked
         FROM activation_codes`
      ).first(),
      ctx.env.DB.prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN is_active = 1 AND revoked = 0 THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN approval_status = 'pending' THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN revoked = 1 THEN 1 ELSE 0 END) AS revoked,
                SUM(CASE WHEN revoked = 0 AND expires_at BETWEEN ? AND ? THEN 1 ELSE 0 END) AS expiring_soon
         FROM licenses`
      ).bind(today, expiringBefore).first(),
      ctx.env.DB.prepare(
        `SELECT COUNT(*) AS total,
                MAX(released_at) AS latest_released_at
         FROM release_versions`
      ).first(),
      ctx.env.DB.prepare(
        `SELECT COUNT(*) AS total_24h,
                SUM(CASE WHEN status IN ('ok', 'contract_ready', 'compute_proxy') THEN 0 ELSE 1 END) AS exceptions_24h,
                AVG(latency_ms) AS avg_latency_ms_24h
         FROM analysis_requests
         WHERE created_at >= ?`
      ).bind(since24h).first(),
      ctx.env.DB.prepare(
        `SELECT id, action, actor, payload, created_at
         FROM admin_audit_events
         ORDER BY id DESC
         LIMIT 10`
      ).all(),
      ctx.env.DB.prepare(
        `SELECT l.license_id, l.edition, u.email, u.username, l.expires_at, l.is_active,
                l.revoked, l.approval_status, l.created_at
         FROM licenses l
         JOIN users u ON u.id = l.user_id
         ORDER BY l.id DESC
         LIMIT 10`
      ).all(),
      ctx.env.DB.prepare(
        `SELECT l.license_id, l.edition, u.email, u.username, l.expires_at, l.is_active,
                l.revoked, l.approval_status
         FROM licenses l
         JOIN users u ON u.id = l.user_id
         WHERE l.revoked = 0 AND l.expires_at BETWEEN ? AND ?
         ORDER BY l.expires_at ASC
         LIMIT 10`
      ).bind(today, expiringBefore).all(),
    ]);

  const nextActions = [];
  if (numberField(licenses, "pending") > 0) {
    nextActions.push({ level: "warn", text: "存在待审批授权，需要处理后再交付客户。" });
  }
  if (numberField(licenses, "expiring_soon") > 0) {
    nextActions.push({ level: "info", text: "存在 30 天内到期授权，建议提前续期或沟通。" });
  }
  if (numberField(codes, "active") === 0) {
    nextActions.push({ level: "info", text: "当前没有可直接交付的激活码，可先生成备用码。" });
  }
  if (numberField(analysis, "exceptions_24h") > 0) {
    nextActions.push({ level: "warn", text: "近 24 小时分析接口有异常状态，请查看分析请求日志。" });
  }

  return json({
    generated_at: nowIso(),
    customers: compactCounts(customers, ["total", "active", "draft", "suspended"]),
    activation_codes: compactCounts(codes, ["total", "active", "assigned", "used", "revoked"]),
    licenses: compactCounts(licenses, ["total", "active", "pending", "revoked", "expiring_soon"]),
    releases: compactCounts(releases, ["total"]),
    release_latest_released_at: (releases && releases.latest_released_at) || "",
    analysis: {
      total_24h: numberField(analysis, "total_24h"),
      exceptions_24h: numberField(analysis, "exceptions_24h"),
      avg_latency_ms_24h: Math.round(Number((analysis && analysis.avg_latency_ms_24h) || 0)),
    },
    recent_audit_events: recentAudits.results || [],
    recent_licenses: recentLicenses.results || [],
    expiring_licenses: expiringLicenses.results || [],
    next_actions: nextActions,
  });
});

route("GET", "/v1/scorpio_v1_admin/activation-codes", async (ctx) => {
  requireAdmin(ctx);
  const options = adminListOptions(ctx.url, { defaultLimit: 50, maxLimit: 200 });
  const where = [];
  const params = [];
  addListTextSearch(where, params, ["code", "customer_name", "customer_email", "notes"], options.q);
  if (options.status) {
    where.push("status = ?");
    params.push(options.status);
  }
  if (options.edition) {
    where.push("edition = ?");
    params.push(options.edition);
  }
  const customerId = positiveInteger(ctx.url.searchParams.get("customer_id"), 0);
  if (customerId > 0) {
    where.push("customer_id = ?");
    params.push(customerId);
  }
  const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = await ctx.env.DB.prepare(`SELECT COUNT(*) AS total FROM activation_codes ${filter}`).bind(...params).first();
  const rows = await ctx.env.DB.prepare(
    `SELECT id, code, edition, license_days, max_devices, status, assigned_to_user_id, used_by_user_id,
            customer_id, customer_name, customer_email, machine_fingerprint_prebind, notes, created_at, used_at
     FROM activation_codes
     ${filter}
     ORDER BY id DESC
     LIMIT ? OFFSET ?`
  ).bind(...params, options.limit, options.offset).all();
  return json(pageResponse(rows.results || [], total, options));
});

route("GET", "/v1/scorpio_v1_admin/customers", async (ctx) => {
  requireAdmin(ctx);
  const options = adminListOptions(ctx.url, { defaultLimit: 50, maxLimit: 200 });
  const where = [];
  const params = [];
  addListTextSearch(where, params, ["c.customer_name", "c.customer_email", "c.notes"], options.q);
  if (options.status) {
    where.push("c.status = ?");
    params.push(options.status);
  }
  if (options.edition) {
    where.push("c.edition = ?");
    params.push(options.edition);
  }
  const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = await ctx.env.DB.prepare(`SELECT COUNT(*) AS total FROM customers c ${filter}`).bind(...params).first();
  const rows = await ctx.env.DB.prepare(
    `SELECT c.id, c.user_id, c.customer_name, c.customer_email, c.edition,
            c.machine_fingerprint_prebind, c.license_days, c.status, c.notes,
            c.created_at, c.updated_at,
            COUNT(ac.id) AS activation_code_count,
            SUM(CASE WHEN ac.status = 'used' THEN 1 ELSE 0 END) AS used_code_count,
            MAX(ac.created_at) AS latest_code_created_at
     FROM customers c
     LEFT JOIN activation_codes ac ON ac.customer_id = c.id
     ${filter}
     GROUP BY c.id
     ORDER BY c.updated_at DESC, c.id DESC
     LIMIT ? OFFSET ?`
  ).bind(...params, options.limit, options.offset).all();
  return json(pageResponse(rows.results || [], total, options));
});

route("POST", "/v1/scorpio_v1_admin/customers", async (ctx) => {
  requireAdmin(ctx);
  const body = await readJson(ctx.request);
  const email = body.customer_email || body.email ? normalizeEmail(body.customer_email || body.email) : "";
  const name = safeText(body.customer_name || body.name, 128);
  if (email && !isEmail(email)) {
    return json({ error: "email_invalid" }, 400);
  }
  if (!email && !name) {
    return json({ error: "customer_identity_required" }, 400);
  }

  const user = email
    ? await ctx.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first()
    : null;
  const customer = await upsertCustomer(ctx.env, {
    userId: user ? user.id : null,
    customerName: name,
    customerEmail: email,
    edition: normalizeEdition(body.edition || "personal_pro"),
    machineFingerprintPrebind: body.machine_fingerprint_prebind || "",
    licenseDays: body.license_days || 365,
    status: normalizeCustomerStatus(body.status || "draft"),
    notes: body.notes || "",
  });
  await audit(ctx.env, "upsert_customer", "admin_api", { customer_id: customer.id, email });
  return json(customer, 201);
});

async function updateAdminCustomer(ctx) {
  requireAdmin(ctx);
  const customerId = Number(ctx.customerId || 0);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return json({ error: "customer_id_invalid" }, 400);
  }
  const existing = await ctx.env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(customerId).first();
  if (!existing) {
    return json({ error: "customer_not_found" }, 404);
  }

  const body = await readJson(ctx.request);
  const email = body.customer_email || body.email ? normalizeEmail(body.customer_email || body.email) : "";
  const name = safeText(body.customer_name || body.name, 128);
  if (email && !isEmail(email)) {
    return json({ error: "email_invalid" }, 400);
  }
  if (!email && !name) {
    return json({ error: "customer_identity_required" }, 400);
  }

  const user = email
    ? await ctx.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first()
    : null;
  const customer = await upsertCustomer(ctx.env, {
    customerId,
    userId: user ? user.id : existing.user_id,
    customerName: name || existing.customer_name,
    customerEmail: email || existing.customer_email,
    edition: normalizeEdition(body.edition || existing.edition || "personal_pro"),
    machineFingerprintPrebind: body.machine_fingerprint_prebind || existing.machine_fingerprint_prebind || "",
    licenseDays: body.license_days || existing.license_days || 365,
    status: normalizeCustomerStatus(body.status || existing.status || "draft"),
    notes: body.notes || existing.notes || "",
  });
  await audit(ctx.env, "update_customer", "admin_api", { customer_id: customer.id, email: customer.customer_email });
  return json(customer);
}

async function deleteAdminCustomer(ctx) {
  requireAdmin(ctx);
  const customerId = Number(ctx.customerId || 0);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return json({ error: "customer_id_invalid" }, 400);
  }
  const existing = await ctx.env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(customerId).first();
  if (!existing) {
    return json({ error: "customer_not_found" }, 404);
  }

  const linked = await ctx.env.DB.prepare(
    "SELECT COUNT(*) AS activation_code_count FROM activation_codes WHERE customer_id = ?"
  )
    .bind(customerId)
    .first();
  const activationCodeCount = Number((linked && linked.activation_code_count) || 0);
  if (activationCodeCount > 0) {
    const archivedNotes = appendNote(existing.notes, `archived_by_admin_api; linked_activation_codes=${activationCodeCount}`);
    await ctx.env.DB.prepare("UPDATE customers SET status = 'cancelled', notes = ?, updated_at = ? WHERE id = ?")
      .bind(archivedNotes, nowIso(), customerId)
      .run();
    await audit(ctx.env, "archive_customer", "admin_api", {
      customer_id: customerId,
      email: existing.customer_email,
      activation_code_count: activationCodeCount,
    });
    return json({ deleted: false, archived: true, id: customerId, activation_code_count: activationCodeCount });
  }

  await ctx.env.DB.prepare("DELETE FROM customers WHERE id = ?").bind(customerId).run();
  await audit(ctx.env, "delete_customer", "admin_api", {
    customer_id: customerId,
    email: existing.customer_email,
  });
  return json({ deleted: true, id: customerId });
}

async function updateAdminActivationCode(ctx) {
  requireAdmin(ctx);
  const codeText = String(ctx.code || "").trim().toUpperCase();
  if (!codeText) {
    return json({ error: "activation_code_required" }, 400);
  }
  const existing = await ctx.env.DB.prepare("SELECT * FROM activation_codes WHERE code = ?").bind(codeText).first();
  if (!existing) {
    return json({ error: "activation_code_not_found" }, 404);
  }

  const body = await readJson(ctx.request);
  const status = body.status ? normalizeActivationCodeStatus(body.status, existing.status) : existing.status;
  const canChangeTerms = String(existing.status || "") !== "used";
  const edition = canChangeTerms && body.edition ? normalizeEdition(body.edition) : existing.edition;
  const licenseDays = canChangeTerms && body.license_days ? Math.max(Number(body.license_days), 1) : existing.license_days;
  const maxDevices = canChangeTerms && body.max_devices ? Math.max(Number(body.max_devices), 1) : existing.max_devices;
  const customerName = body.customer_name !== undefined ? safeText(body.customer_name, 128) : existing.customer_name || "";
  const customerEmail = body.customer_email !== undefined ? normalizeEmail(body.customer_email) : existing.customer_email || "";
  const machineFingerprintPrebind =
    body.machine_fingerprint_prebind !== undefined
      ? safeText(body.machine_fingerprint_prebind, 128)
      : existing.machine_fingerprint_prebind || "";
  const notes = body.notes !== undefined ? safeText(body.notes, 2000) : existing.notes || "";

  if (customerEmail && !isEmail(customerEmail)) {
    return json({ error: "email_invalid" }, 400);
  }
  if (String(existing.status || "") === "used" && status !== "used") {
    return json({ error: "used_activation_code_status_locked" }, 409);
  }

  await ctx.env.DB.prepare(
    `UPDATE activation_codes
     SET edition = ?, license_days = ?, max_devices = ?, status = ?, customer_name = ?,
         customer_email = ?, machine_fingerprint_prebind = ?, notes = ?
     WHERE code = ?`
  )
    .bind(edition, licenseDays, maxDevices, status, customerName, customerEmail, machineFingerprintPrebind, notes, codeText)
    .run();
  await audit(ctx.env, "update_activation_code", "admin_api", {
    code: codeText,
    status,
    affects_existing_license: false,
  });
  const updated = await ctx.env.DB.prepare("SELECT * FROM activation_codes WHERE code = ?").bind(codeText).first();
  return json({ ...updated, affects_existing_license: false });
}

async function revokeAdminActivationCode(ctx) {
  requireAdmin(ctx);
  const codeText = String(ctx.code || "").trim().toUpperCase();
  if (!codeText) {
    return json({ error: "activation_code_required" }, 400);
  }
  const existing = await ctx.env.DB.prepare("SELECT * FROM activation_codes WHERE code = ?").bind(codeText).first();
  if (!existing) {
    return json({ error: "activation_code_not_found" }, 404);
  }
  if (String(existing.status || "") === "used") {
    return json({ error: "used_activation_code_cannot_be_deleted_revoke_license_instead" }, 409);
  }
  await ctx.env.DB.prepare("UPDATE activation_codes SET status = 'revoked', notes = ? WHERE code = ?")
    .bind(appendNote(existing.notes, "revoked_by_admin_api"), codeText)
    .run();
  await audit(ctx.env, "revoke_activation_code", "admin_api", { code: codeText });
  return json({ deleted: false, revoked: true, code: codeText });
}

async function updateAdminLicense(ctx) {
  requireAdmin(ctx);
  const licenseId = String(ctx.licenseId || "").trim();
  if (!licenseId) {
    return json({ error: "license_id_required" }, 400);
  }
  const existing = await ctx.env.DB.prepare(
    `SELECT l.*, u.email, u.username
     FROM licenses l
     JOIN users u ON u.id = l.user_id
     WHERE l.license_id = ?`
  )
    .bind(licenseId)
    .first();
  if (!existing) {
    return json({ error: "license_not_found" }, 404);
  }

  const body = await readJson(ctx.request);
  const currentPayload = parseJson(existing.signed_payload, {});
  const expiresAt = normalizeLicenseExpiry(body, existing.expires_at);
  const isActive = body.is_active === undefined ? Number(existing.is_active || 0) : boolToInt(body.is_active);
  const revoked = body.revoked === undefined ? Number(existing.revoked || 0) : boolToInt(body.revoked);
  const approvalStatus = body.approval_status
    ? normalizeApprovalStatus(body.approval_status)
    : existing.approval_status || "auto";
  const revokeReason =
    body.revoke_reason !== undefined ? safeText(body.revoke_reason, 256) : existing.revoke_reason || "";
  const machineFingerprint =
    body.machine_fingerprint !== undefined
      ? safeText(body.machine_fingerprint, 128)
      : existing.machine_fingerprint || currentPayload.machine_fingerprint || "";

  const issued = await issueLicensePayload(ctx.env, {
    edition: existing.edition,
    customerName: currentPayload.customer_name || existing.username || existing.email,
    customerEmail: existing.email,
    machineFingerprint,
    licenseId: existing.license_id,
    expiresAt,
    features: currentPayload.features || {},
  });

  await ctx.env.DB.prepare(
    `UPDATE licenses
     SET machine_fingerprint = ?, signed_payload = ?, signature = ?, nonce = ?, expires_at = ?,
         is_active = ?, revoked = ?, revoke_reason = ?, approval_status = ?
     WHERE license_id = ?`
  )
    .bind(
      machineFingerprint,
      JSON.stringify(issued.payload),
      issued.signature,
      issued.payload.nonce,
      issued.expires_at,
      isActive,
      revoked,
      revokeReason,
      approvalStatus,
      licenseId
    )
    .run();
  await audit(ctx.env, "update_license", "admin_api", {
    license_id: licenseId,
    expires_at: issued.expires_at,
    is_active: Boolean(isActive),
    revoked: Boolean(revoked),
    approval_status: approvalStatus,
  });
  return json({
    license_id: licenseId,
    expires_at: issued.expires_at,
    is_active: Boolean(isActive),
    revoked: Boolean(revoked),
    approval_status: approvalStatus,
    license_file: issued.payload,
  });
}

async function revokeAdminLicense(ctx) {
  requireAdmin(ctx);
  const licenseId = String(ctx.licenseId || "").trim();
  if (!licenseId) {
    return json({ error: "license_id_required" }, 400);
  }
  const existing = await ctx.env.DB.prepare("SELECT * FROM licenses WHERE license_id = ?").bind(licenseId).first();
  if (!existing) {
    return json({ error: "license_not_found" }, 404);
  }
  await ctx.env.DB.prepare(
    `UPDATE licenses
     SET is_active = 0,
         revoked = 1,
         revoke_reason = CASE
           WHEN revoke_reason IS NULL OR revoke_reason = '' THEN 'revoked_by_admin_api'
           ELSE revoke_reason
         END
     WHERE license_id = ?`
  )
    .bind(licenseId)
    .run();
  await audit(ctx.env, "revoke_license", "admin_api", { license_id: licenseId });
  return json({ revoked: true, license_id: licenseId });
}

async function updateAdminFeedback(ctx) {
  requireAdmin(ctx);
  const feedbackId = Number(ctx.feedbackId || 0);
  if (!Number.isInteger(feedbackId) || feedbackId <= 0) {
    return json({ error: "feedback_id_invalid" }, 400);
  }
  const existing = await ctx.env.DB.prepare("SELECT * FROM feedback_items WHERE id = ?").bind(feedbackId).first();
  if (!existing) {
    return json({ error: "feedback_not_found" }, 404);
  }

  const body = await readJson(ctx.request);
  const status = normalizeFeedbackStatus(body.status || existing.status, existing.status || "new");
  const priority = normalizeFeedbackPriority(body.priority || existing.priority, existing.priority || "normal");
  const adminNotes = body.admin_notes !== undefined ? safeText(body.admin_notes, 2000) : existing.admin_notes || "";
  const updatedAt = nowIso();

  await ctx.env.DB.prepare(
    `UPDATE feedback_items
     SET status = ?, priority = ?, admin_notes = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(status, priority, adminNotes, updatedAt, feedbackId)
    .run();
  await audit(ctx.env, "update_feedback", "admin_api", {
    feedback_id: feedbackId,
    public_id: existing.public_id,
    status,
    priority,
  });

  const updated = await ctx.env.DB.prepare("SELECT * FROM feedback_items WHERE id = ?").bind(feedbackId).first();
  return json(updated);
}

route("GET", "/v1/scorpio_v1_admin/licenses", async (ctx) => {
  requireAdmin(ctx);
  const options = adminListOptions(ctx.url, { defaultLimit: 50, maxLimit: 200 });
  const where = [];
  const params = [];
  addListTextSearch(
    where,
    params,
    ["l.license_id", "l.machine_fingerprint", "u.email", "u.username", "ac.code", "l.revoke_reason"],
    options.q
  );
  if (options.edition) {
    where.push("l.edition = ?");
    params.push(options.edition);
  }
  if (options.status === "active") {
    where.push("l.is_active = 1 AND l.revoked = 0");
  } else if (options.status === "revoked") {
    where.push("l.revoked = 1");
  } else if (options.status === "pending") {
    where.push("l.approval_status = 'pending'");
  } else if (options.status === "inactive") {
    where.push("l.is_active = 0 AND l.revoked = 0");
  }
  const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = await ctx.env.DB.prepare(
    `SELECT COUNT(*) AS total
     FROM licenses l
     JOIN users u ON u.id = l.user_id
     LEFT JOIN activation_codes ac ON ac.id = l.activation_code_id
     ${filter}`
  ).bind(...params).first();
  const rows = await ctx.env.DB.prepare(
    `SELECT l.id, l.license_id, l.edition, u.email, u.username, ac.code AS activation_code,
            l.machine_fingerprint, l.expires_at, l.is_active, l.revoked, l.revoke_reason,
            l.approval_status, l.last_online_check, l.created_at
     FROM licenses l
     JOIN users u ON u.id = l.user_id
     LEFT JOIN activation_codes ac ON ac.id = l.activation_code_id
     ${filter}
     ORDER BY l.id DESC
     LIMIT ? OFFSET ?`
  ).bind(...params, options.limit, options.offset).all();
  return json(pageResponse(rows.results || [], total, options));
});

route("GET", "/v1/scorpio_v1_admin/releases", async (ctx) => {
  requireAdmin(ctx);
  const options = adminListOptions(ctx.url, { defaultLimit: 50, maxLimit: 200 });
  const where = [];
  const params = [];
  addListTextSearch(where, params, ["version", "release_notes", "download_url"], options.q);
  if (options.edition) {
    where.push("edition = ?");
    params.push(options.edition);
  }
  if (options.channel) {
    where.push("channel = ?");
    params.push(options.channel);
  }
  const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = await ctx.env.DB.prepare(`SELECT COUNT(*) AS total FROM release_versions ${filter}`).bind(...params).first();
  const rows = await ctx.env.DB.prepare(
    `SELECT version, channel, edition, release_notes, download_url, file_hash_sha256,
            file_size_bytes, is_required, released_at
     FROM release_versions
     ${filter}
     ORDER BY released_at DESC, id DESC
     LIMIT ? OFFSET ?`
  ).bind(...params, options.limit, options.offset).all();
  return json(pageResponse(rows.results || [], total, options));
});

route("GET", "/v1/scorpio_v1_admin/audit-events", async (ctx) => {
  requireAdmin(ctx);
  const options = adminListOptions(ctx.url, { defaultLimit: 50, maxLimit: 200 });
  const where = [];
  const params = [];
  addListTextSearch(where, params, ["action", "actor", "payload"], options.q);
  const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = await ctx.env.DB.prepare(`SELECT COUNT(*) AS total FROM admin_audit_events ${filter}`).bind(...params).first();
  const rows = await ctx.env.DB.prepare(
    `SELECT id, action, actor, payload, created_at
     FROM admin_audit_events
     ${filter}
     ORDER BY id DESC
     LIMIT ? OFFSET ?`
  ).bind(...params, options.limit, options.offset).all();
  return json(pageResponse(rows.results || [], total, options));
});

route("GET", "/v1/scorpio_v1_admin/usage-reports", async (ctx) => {
  requireAdmin(ctx);
  const options = adminListOptions(ctx.url, { defaultLimit: 50, maxLimit: 200 });
  const where = [];
  const params = [];
  addListTextSearch(where, params, ["license_id", "machine_fingerprint", "client_version", "os_version", "feature_usage"], options.q);
  const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = await ctx.env.DB.prepare(`SELECT COUNT(*) AS total FROM usage_reports ${filter}`).bind(...params).first();
  const rows = await ctx.env.DB.prepare(
    `SELECT id, license_id, user_id, machine_fingerprint, session_start, session_end,
            session_duration_seconds, feature_usage, client_version, os_version, reported_at
     FROM usage_reports
     ${filter}
     ORDER BY id DESC
     LIMIT ? OFFSET ?`
  ).bind(...params, options.limit, options.offset).all();
  return json(pageResponse(rows.results || [], total, options));
});

route("GET", "/v1/scorpio_v1_admin/analysis-requests", async (ctx) => {
  requireAdmin(ctx);
  const options = adminListOptions(ctx.url, { defaultLimit: 50, maxLimit: 200 });
  const where = [];
  const params = [];
  addListTextSearch(where, params, ["endpoint", "asset_type", "asset_code", "status", "client_version", "client_ip"], options.q);
  if (options.status) {
    where.push("status = ?");
    params.push(options.status);
  }
  const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = await ctx.env.DB.prepare(`SELECT COUNT(*) AS total FROM analysis_requests ${filter}`).bind(...params).first();
  const rows = await ctx.env.DB.prepare(
    `SELECT id, user_id, license_id, endpoint, asset_type, asset_code, request_hash,
            client_version, client_ip, status, latency_ms, created_at
     FROM analysis_requests
     ${filter}
     ORDER BY id DESC
     LIMIT ? OFFSET ?`
  ).bind(...params, options.limit, options.offset).all();
  return json(pageResponse(rows.results || [], total, options));
});

route("POST", "/v1/scorpio_v1_admin/releases", async (ctx) => {
  requireAdmin(ctx);
  const body = await readJson(ctx.request);
  const version = String(body.version || "").trim().replace(/^v/i, "");
  const channel = String(body.channel || "stable").trim().toLowerCase() || "stable";
  const edition = normalizeEdition(body.edition || "personal_pro");
  const downloadUrl = String(body.download_url || "").trim();
  const notes = String(body.release_notes || "").trim();
  const sha256 = String(body.file_hash_sha256 || body.sha256 || "").trim();
  const sizeBytes = Math.max(Number(body.file_size_bytes || 0), 0);
  const isRequired = body.is_required ? 1 : 0;
  const releasedAt = String(body.released_at || "").trim() || nowIso();

  if (!version) {
    return json({ error: "version_required" }, 400);
  }
  if (downloadUrl && !/^https:\/\//i.test(downloadUrl)) {
    return json({ error: "download_url_https_required" }, 400);
  }

  await ctx.env.DB.prepare(
    `INSERT INTO release_versions
       (version, channel, edition, release_notes, download_url, file_hash_sha256,
        file_size_bytes, is_required, released_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(version, channel, edition) DO UPDATE SET
       release_notes = excluded.release_notes,
       download_url = excluded.download_url,
       file_hash_sha256 = excluded.file_hash_sha256,
       file_size_bytes = excluded.file_size_bytes,
       is_required = excluded.is_required,
       released_at = excluded.released_at`
  )
    .bind(version, channel, edition, notes, downloadUrl, sha256, sizeBytes, isRequired, releasedAt)
    .run();

  await audit(ctx.env, "upsert_release", "admin_api", { version, channel, edition });
  return json({
    version,
    channel,
    edition,
    release_notes: notes,
    download_url: downloadUrl,
    file_hash_sha256: sha256,
    file_size_bytes: sizeBytes,
    is_required: Boolean(isRequired),
    released_at: releasedAt,
  }, 201);
});

function route(method, path, handler) {
  ROUTES.set(`${method.toUpperCase()} ${normalizePath(path)}`, handler);
}

function normalizePath(path) {
  if (!path || path === "/") return "/";
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function withCors(response, corsHeaders) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function cors(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = listEnv(env.CORS_ALLOWED_ORIGINS, "");
  const allowOrigin = allowed.length === 0 || allowed.includes(origin) ? origin || "*" : allowed[0];
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-admin-token",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function adminListOptions(url, defaults = {}) {
  return {
    limit: Math.max(1, positiveInteger(url.searchParams.get("limit"), defaults.defaultLimit || 50, defaults.maxLimit || 200)),
    offset: positiveInteger(url.searchParams.get("offset"), 0, 100000),
    q: safeText(url.searchParams.get("q") || "", 128).toLowerCase(),
    status: safeText(url.searchParams.get("status") || "", 32).toLowerCase(),
    edition: safeText(url.searchParams.get("edition") || "", 32).toLowerCase().replaceAll("-", "_"),
    channel: safeText(url.searchParams.get("channel") || "", 32).toLowerCase(),
  };
}

function positiveInteger(value, fallback = 0, maxValue = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.min(parsed, maxValue);
}

function addListTextSearch(where, params, columns, query) {
  if (!query) {
    return;
  }
  where.push(`(${columns.map((column) => `LOWER(${column}) LIKE ?`).join(" OR ")})`);
  for (let i = 0; i < columns.length; i += 1) {
    params.push(`%${query}%`);
  }
}

function pageResponse(results, totalRow, options) {
  const total = numberField(totalRow, "total");
  return {
    results,
    page: {
      limit: options.limit,
      offset: options.offset,
      total,
      has_more: options.offset + results.length < total,
    },
  };
}

function compactCounts(row, keys) {
  return Object.fromEntries(keys.map((key) => [key, numberField(row, key)]));
}

function numberField(row, key) {
  return Number((row && row[key]) || 0);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    const error = new Error("invalid_json");
    error.status = 400;
    error.publicMessage = "invalid_json";
    throw error;
  }
}

async function requireUser(ctx) {
  const header = ctx.request.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ")) {
    throwHttp(401, "authentication_required");
  }
  const payload = await verifyJwt(header.slice(7).trim(), ctx.env);
  if (payload.type !== "access") {
    throwHttp(401, "access_token_required");
  }
  const user = await ctx.env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(payload.user_id)
    .first();
  if (!user) {
    throwHttp(401, "user_not_found");
  }
  return user;
}

function requireAdmin(ctx) {
  const configured = String(ctx.env.ADMIN_API_TOKEN || "");
  if (!configured || ctx.request.headers.get("X-Admin-Token") !== configured) {
    throwHttp(403, "admin_token_required");
  }
}

function analysisComputeConfigured(env) {
  return Boolean(String(env.ANALYSIS_COMPUTE_URL || "").trim());
}

function normalizeAnalysisRequest(body, assetType) {
  const code = normalizeAssetCode(body.code || body.symbol || body.asset_code);
  if (!code) {
    throwHttp(400, "asset_code_required");
  }
  const market = normalizeMarket(body.market || "CN");
  const tabs = normalizeAnalysisTabs(body.tabs || []);
  return {
    asset_type: assetType,
    code,
    market,
    license_id: safeText(body.license_id || "", 96),
    machine_fingerprint: safeText(body.machine_fingerprint || "", 160),
    client_version: safeText(body.client_version || "", 64),
    mode: safeText(body.mode || "commercial_realtime", 64),
    period: safeText(body.period || "1y", 32),
    tabs,
  };
}

function normalizePortfolioRequest(body) {
  const rawPositions = Array.isArray(body.positions) ? body.positions : [];
  const positions = rawPositions.slice(0, 200).map((item) => ({
    asset_type: normalizeAssetType(item.asset_type || item.type || "stock"),
    code: normalizeAssetCode(item.code || item.symbol || item.asset_code),
    weight: clampNumber(item.weight, 0, 1, 0),
  })).filter((item) => item.code);
  return {
    license_id: safeText(body.license_id || "", 96),
    machine_fingerprint: safeText(body.machine_fingerprint || "", 160),
    client_version: safeText(body.client_version || "", 64),
    mode: safeText(body.mode || "portfolio_enrich", 64),
    positions,
  };
}

function normalizeAssetCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!code) return "";
  if (!/^[A-Z0-9._-]{1,32}$/.test(code)) {
    throwHttp(400, "asset_code_invalid");
  }
  return code;
}

function normalizeMarket(value) {
  const market = String(value || "CN").trim().toUpperCase();
  return ["CN", "HK", "US", "GLOBAL"].includes(market) ? market : "CN";
}

function normalizeAssetType(value) {
  const assetType = String(value || "stock").trim().toLowerCase();
  return ["stock", "fund", "bond", "cash", "other"].includes(assetType) ? assetType : "other";
}

function normalizeAnalysisTabs(value) {
  const allowed = new Set([
    "quote",
    "technical",
    "fundamental",
    "financial",
    "news",
    "conclusion",
    "reason",
    "fund",
    "bond",
  ]);
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim().toLowerCase()).filter((item) => allowed.has(item)).slice(0, 20);
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

async function verifyAnalysisLicense(env, user, licenseId) {
  const normalizedLicenseId = safeText(licenseId || "", 96);
  if (!normalizedLicenseId) {
    return null;
  }
  const license = await env.DB.prepare(
    `SELECT license_id, edition, expires_at, is_active, revoked
     FROM licenses
     WHERE user_id = ? AND license_id = ?
     LIMIT 1`
  )
    .bind(user.id, normalizedLicenseId)
    .first();
  if (!license) {
    throwHttp(403, "license_not_found");
  }
  if (!Number(license.is_active) || Number(license.revoked)) {
    throwHttp(403, "license_inactive");
  }
  if (license.expires_at && license.expires_at < todayIso()) {
    throwHttp(403, "license_expired");
  }
  return license;
}

async function proxyAnalysisCompute(ctx, options) {
  const baseUrl = String(ctx.env.ANALYSIS_COMPUTE_URL || "").replace(/\/+$/, "");
  const token = String(ctx.env.ANALYSIS_COMPUTE_TOKEN || "");
  const timeoutMs = clampNumber(
    intEnv(ctx.env.ANALYSIS_COMPUTE_TIMEOUT_MS, DEFAULT_ANALYSIS_COMPUTE_TIMEOUT_MS),
    1000,
    15000,
    DEFAULT_ANALYSIS_COMPUTE_TIMEOUT_MS
  );
  const headers = {
    "content-type": "application/json",
    "x-scorpio-user-id": String(options.user.id),
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("analysis_compute_timeout"), timeoutMs);
  let response;
  try {
    response = await fetch(`${baseUrl}${options.endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    const timedOut = controller.signal.aborted || (error && (error.name === "AbortError" || String(error).includes("analysis_compute_timeout")));
    const status = timedOut ? "compute_timeout" : "compute_error";
    await recordAnalysisRequest(ctx.env, {
      user: options.user,
      license: options.license,
      endpoint: options.endpoint,
      assetType: options.body.asset_type || "",
      assetCode: options.body.code || options.body.market || "",
      request: options.body,
      clientIp: clientIp(ctx.request),
      status,
      latencyMs: Date.now() - options.startedAt,
    });
    return json(analysisComputeFallback(options, status, timeoutMs), timedOut ? 504 : 502);
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  await recordAnalysisRequest(ctx.env, {
    user: options.user,
    license: options.license,
    endpoint: options.endpoint,
    assetType: options.body.asset_type || "",
    assetCode: options.body.code || options.body.market || "",
    request: options.body,
    clientIp: clientIp(ctx.request),
    status: response.ok ? "compute_proxy" : "compute_error",
    latencyMs: Date.now() - options.startedAt,
  });
  const proxied = new Response(text, {
    status: response.status,
    headers: JSON_HEADERS,
  });
  if (response.ok && options.cacheKey && options.cacheSeconds > 0 && typeof caches !== "undefined" && caches.default) {
    const cached = new Response(text, {
      status: 200,
      headers: {
        ...JSON_HEADERS,
        "cache-control": `public, max-age=${options.cacheSeconds}`,
        "x-scorpio-analysis-cache": "store",
      },
    });
    ctx.executionCtx?.waitUntil(caches.default.put(options.cacheKey, cached));
  }
  return proxied;
}

async function handleStockAnalysisPost(ctx, options) {
  const startedAt = Date.now();
  const user = await requireUser(ctx);
  const body = await readJson(ctx.request);
  const request = normalizeAnalysisRequest(body, "stock");
  const license = await verifyAnalysisLicense(ctx.env, user, request.license_id);

  if (analysisComputeConfigured(ctx.env)) {
    return proxyAnalysisCompute(ctx, {
      endpoint: options.endpoint,
      body: { ...request, user_id: user.id, email: user.email },
      user,
      license,
      startedAt,
    });
  }

  const response = contractFeatureBundle(request, {
    user,
    license,
    endpoint: options.endpoint,
    feature: options.feature,
  });
  await recordAnalysisRequest(ctx.env, {
    user,
    license,
    endpoint: options.endpoint,
    assetType: "stock",
    assetCode: request.code,
    request,
    clientIp: clientIp(ctx.request),
    status: response.status,
    latencyMs: Date.now() - startedAt,
  });
  return json(response);
}

async function handleSharedAnalysisGet(ctx, options) {
  const startedAt = Date.now();
  const user = await requireUser(ctx);
  const market = normalizeMarket(ctx.url.searchParams.get("market") || "CN");
  const request = {
    asset_type: options.assetType,
    market,
    client_version: safeText(ctx.url.searchParams.get("client_version") || "", 64),
    license_id: safeText(ctx.url.searchParams.get("license_id") || "", 96),
  };
  const license = await verifyAnalysisLicense(ctx.env, user, request.license_id);

  if (analysisComputeConfigured(ctx.env)) {
    const cacheSeconds = clampNumber(
      intEnv(ctx.env.ANALYSIS_SHARED_CACHE_SECONDS, DEFAULT_ANALYSIS_SHARED_CACHE_SECONDS),
      0,
      3600,
      DEFAULT_ANALYSIS_SHARED_CACHE_SECONDS
    );
    const cacheKey = analysisCacheKey(ctx, {
      endpoint: options.endpoint,
      market,
      edition: license ? license.edition : "unlicensed",
    });
    if (cacheSeconds > 0 && typeof caches !== "undefined" && caches.default) {
      const cached = await caches.default.match(cacheKey);
      if (cached) {
        await recordAnalysisRequest(ctx.env, {
          user,
          license,
          endpoint: options.endpoint,
          assetType: options.assetType,
          assetCode: market,
          request,
          clientIp: clientIp(ctx.request),
          status: "cache_hit",
          latencyMs: Date.now() - startedAt,
        });
        const headers = new Headers(cached.headers);
        headers.set("x-scorpio-analysis-cache", "hit");
        return new Response(cached.body, {
          status: cached.status,
          statusText: cached.statusText,
          headers,
        });
      }
    }
    return proxyAnalysisCompute(ctx, {
      endpoint: options.endpoint,
      body: { ...request, user_id: user.id, email: user.email },
      user,
      license,
      startedAt,
      cacheKey,
      cacheSeconds,
    });
  }

  const response = contractFeatureBundle({ code: market, market, ...request }, {
    user,
    license,
    endpoint: options.endpoint,
    feature: options.feature,
  });
  await recordAnalysisRequest(ctx.env, {
    user,
    license,
    endpoint: options.endpoint,
    assetType: options.assetType,
    assetCode: market,
    request,
    clientIp: clientIp(ctx.request),
    status: response.status,
    latencyMs: Date.now() - startedAt,
  });
  return json(response);
}

async function handleAssetAnalysisGet(ctx, options) {
  const startedAt = Date.now();
  const user = await requireUser(ctx);
  const code = normalizeAssetCode(ctx.url.searchParams.get("code") || "");
  if (!code) {
    throwHttp(400, "asset_code_required");
  }
  const market = normalizeMarket(ctx.url.searchParams.get("market") || "CN");
  const request = {
    asset_type: options.assetType,
    code,
    market,
    client_version: safeText(ctx.url.searchParams.get("client_version") || "", 64),
    license_id: safeText(ctx.url.searchParams.get("license_id") || "", 96),
  };
  const license = await verifyAnalysisLicense(ctx.env, user, request.license_id);

  if (analysisComputeConfigured(ctx.env)) {
    return proxyAnalysisCompute(ctx, {
      endpoint: options.endpoint,
      body: { ...request, user_id: user.id, email: user.email },
      user,
      license,
      startedAt,
    });
  }

  const response = contractFeatureBundle(request, {
    user,
    license,
    endpoint: options.endpoint,
    feature: options.feature,
  });
  await recordAnalysisRequest(ctx.env, {
    user,
    license,
    endpoint: options.endpoint,
    assetType: options.assetType,
    assetCode: code,
    request,
    clientIp: clientIp(ctx.request),
    status: response.status,
    latencyMs: Date.now() - startedAt,
  });
  return json(response);
}

function contractStockBundle(request, options) {
  return {
    status: "contract_ready",
    code: request.code,
    market: request.market,
    as_of: nowIso(),
    data_quality: {
      level: "not_computed",
      freshness: "not_bound",
      missing: ["analysis_compute_service"],
    },
    summary: {
      score: null,
      rating: "pending",
      risk_level: "unknown",
      title: "Analysis contract is ready",
      brief: "The API gateway is ready. Bind Analysis Compute before enabling production scoring.",
    },
    sections: {
      quote: {},
      technical: {},
      fundamental: {},
      financial: {},
      news: {},
      reason: {},
      conclusion: {},
    },
    risk_flags: [],
    next_actions: ["Bind Analysis Compute and return safe display-only results."],
    source: safeAnalysisSource(options.endpoint, options.user, options.license),
  };
}

function contractFeatureBundle(request, options) {
  return {
    status: "contract_ready",
    feature: options.feature,
    asset_type: request.asset_type || "stock",
    code: request.code || request.market || "",
    market: request.market || "CN",
    as_of: nowIso(),
    data_quality: {
      level: "not_computed",
      freshness: "not_bound",
      missing: ["analysis_compute_service"],
    },
    summary: {
      title: "Analysis contract is ready",
      brief: "This endpoint is authenticated and safe, but real compute is not bound yet.",
      risk_level: "unknown",
    },
    items: [],
    risk_flags: [],
    next_actions: ["Bind Analysis Compute before client production rollout."],
    source: safeAnalysisSource(options.endpoint, options.user, options.license),
  };
}

function analysisComputeFallback(options, status, timeoutMs) {
  const request = options.body || {};
  const response = contractFeatureBundle(request, {
    user: options.user,
    license: options.license,
    endpoint: options.endpoint,
    feature: request.asset_type || "analysis",
  });
  response.status = status;
  response.data_quality = {
    level: "degraded",
    freshness: "not_refreshed",
    missing: ["analysis_compute_response"],
  };
  response.summary = {
    title: status === "compute_timeout" ? "Analysis compute timed out" : "Analysis compute unavailable",
    brief:
      status === "compute_timeout"
        ? `The compute service did not respond within ${timeoutMs}ms. Please retry or use the latest cached result when available.`
        : "The compute service could not be reached. Please retry after the upstream service is restored.",
    risk_level: "unknown",
  };
  response.next_actions = ["Retry after the compute service recovers.", "Check the admin analysis request log for upstream latency."];
  return response;
}

function analysisCacheKey(ctx, options) {
  const key = new URL(ctx.request.url);
  key.pathname = `/__analysis_cache${normalizePath(options.endpoint)}`;
  key.search = "";
  key.searchParams.set("market", options.market || "CN");
  key.searchParams.set("edition", options.edition || "unlicensed");
  return new Request(key.toString(), { method: "GET" });
}

function safeAnalysisSource(endpoint, user, license) {
  return {
    provider: "scorpio_analysis_api",
    endpoint,
    user_id: user.id,
    license_checked: Boolean(license),
    trace_id: `ana_${Date.now().toString(36)}_${randomToken(4)}`,
  };
}

async function recordAnalysisRequest(env, options) {
  try {
    await env.DB.prepare(
      `INSERT INTO analysis_requests
       (user_id, license_id, endpoint, asset_type, asset_code, request_hash, client_version, client_ip, status, latency_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        options.user ? options.user.id : null,
        options.license ? options.license.license_id : "",
        options.endpoint,
        options.assetType || "",
        options.assetCode || "",
        await sha256Hex(JSON.stringify(redactAnalysisRequest(options.request || {}))),
        safeText((options.request || {}).client_version || "", 64),
        options.clientIp || "",
        options.status || "unknown",
        Number(options.latencyMs || 0),
        nowIso()
      )
      .run();
  } catch {
    // Analysis auditing must not break the user-facing request path.
  }
}

function redactAnalysisRequest(request) {
  return {
    asset_type: request.asset_type || "",
    code: request.code || "",
    market: request.market || "",
    tabs: request.tabs || [],
    mode: request.mode || "",
    client_version: request.client_version || "",
  };
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function throwHttp(status, publicMessage) {
  const error = new Error(publicMessage);
  error.status = status;
  error.publicMessage = publicMessage;
  throw error;
}

async function tokenResponse(env, user) {
  return {
    access_token: await signJwt(env, user, "access", intEnv(env.JWT_ACCESS_SECONDS, 3600)),
    refresh_token: await signJwt(env, user, "refresh", intEnv(env.JWT_REFRESH_SECONDS, 1209600)),
    user_id: user.id,
    email: user.email,
    email_verified: Boolean(Number(user.email_verified)),
  };
}

async function signJwt(env, user, type, expiresSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    user_id: user.id,
    email: user.email,
    type,
    iat: now,
    exp: now + expiresSeconds,
  };
  const header = { alg: "HS256", typ: "JWT" };
  const body = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = await hmacSha256(body, secret(env, "JWT_SECRET"));
  return `${body}.${base64UrlEncode(signature)}`;
}

async function verifyJwt(token, env) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) {
    throwHttp(401, "invalid_token");
  }
  const expected = base64UrlEncode(await hmacSha256(`${parts[0]}.${parts[1]}`, secret(env, "JWT_SECRET")));
  if (!timingSafeEqual(expected, parts[2])) {
    throwHttp(401, "invalid_token");
  }
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
  if (Number(payload.exp || 0) < Math.floor(Date.now() / 1000)) {
    throwHttp(401, "token_expired");
  }
  return payload;
}

async function hmacSha256(value, keyText) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(keyText),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

async function hashPassword(password) {
  const salt = randomToken(16);
  const iterations = 100000;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: base64UrlDecode(salt), iterations, hash: "SHA-256" },
    key,
    256
  );
  return `pbkdf2_sha256$${iterations}$${salt}$${base64UrlEncode(new Uint8Array(bits))}`;
}

async function verifyPassword(password, encoded) {
  const [scheme, iterationsText, salt, expected] = String(encoded || "").split("$");
  if (scheme !== "pbkdf2_sha256") return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: base64UrlDecode(salt), iterations: Number(iterationsText), hash: "SHA-256" },
    key,
    256
  );
  return timingSafeEqual(base64UrlEncode(new Uint8Array(bits)), expected);
}

async function issueLicensePayload(env, options) {
  const edition = normalizeEdition(options.edition);
  const issuedAt = todayIso();
  const expiresAt = options.expiresAt || addDays(issuedAt, Math.max(Number(options.days || 365), 1));
  const licenseId =
    options.licenseId ||
    `LIC-${edition.replaceAll("_", "-").toUpperCase()}-${issuedAt.replaceAll("-", "")}-${timeCompact()}`;
  const payload = {
    license_id: licenseId,
    customer_name: String(options.customerName || "Licensed User").trim(),
    customer_email_hash: await emailHash(options.customerEmail || ""),
    edition,
    issued_at: issuedAt,
    expires_at: expiresAt,
    trial: false,
    machine_fingerprint: String(options.machineFingerprint || "").trim(),
    nonce: randomToken(16),
    features: options.features || {},
  };
  const signature = await signEd25519(env, payload);
  payload.signature = signature;
  return {
    license_id: licenseId,
    payload,
    signature,
    edition,
    issued_at: issuedAt,
    expires_at: expiresAt,
  };
}

async function signEd25519(env, payload) {
  const privateKeyText = secret(env, "STOCK_SIGNING_PRIVATE_KEY");
  const keyBytes = base64UrlDecode(privateKeyText);
  const data = new TextEncoder().encode(canonicalJson(payload));
  const signature = ed25519.sign(data, keyBytes);
  return `ed25519:${base64UrlEncode(signature)}`;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

async function createTrialActivationCode(env, user) {
  const code = await uniqueActivationCode(env);
  const edition = normalizeEdition(env.REGISTRATION_TRIAL_EDITION || "personal_pro");
  const days = intEnv(env.REGISTRATION_TRIAL_DAYS, 7);
  await env.DB.prepare(
    `INSERT INTO activation_codes
     (code, edition, license_days, max_devices, status, assigned_to_user_id, customer_name, customer_email, notes, created_at)
     VALUES (?, ?, ?, 1, 'assigned', ?, ?, ?, 'auto_registration_trial', ?)`
  )
    .bind(code, edition, days, user.userId, user.username || user.email, user.email, nowIso())
    .run();
  return {
    trial_activation_code: code,
    trial_edition: edition,
    trial_license_days: days,
  };
}

async function resolveCustomerForActivation(env, options) {
  const customerId = Number(options.customerId || 0);
  if (customerId > 0) {
    const customer = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(customerId).first();
    if (!customer) {
      throwHttp(404, "customer_not_found");
    }
    return customer;
  }
  if (!options.customerEmail && !options.customerName) {
    return null;
  }
  return upsertCustomer(env, {
    userId: options.userId || null,
    customerName: options.customerName || "",
    customerEmail: options.customerEmail || "",
    edition: options.edition || "personal_pro",
    machineFingerprintPrebind: options.machineFingerprintPrebind || "",
    licenseDays: options.licenseDays || 365,
    status: "active",
    notes: options.notes || "linked_by_activation_code",
  });
}

async function upsertCustomer(env, options) {
  const now = nowIso();
  const customerId = Number(options.customerId || 0);
  const email = normalizeEmail(options.customerEmail || "");
  const name = safeText(options.customerName || email, 128);
  const edition = normalizeEdition(options.edition || "personal_pro");
  const machineFingerprintPrebind = safeText(options.machineFingerprintPrebind || "", 128);
  const licenseDays = Math.max(Number(options.licenseDays || 365), 1);
  const status = normalizeCustomerStatus(options.status || "draft");
  const notes = safeText(options.notes || "", 2000);
  const userId = options.userId ? Number(options.userId) : null;

  let existing = null;
  if (customerId > 0) {
    existing = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(customerId).first();
  } else if (email) {
    existing = await env.DB.prepare("SELECT * FROM customers WHERE customer_email = ? ORDER BY id DESC LIMIT 1")
      .bind(email)
      .first();
  }

  if (existing) {
    await env.DB.prepare(
      `UPDATE customers
       SET user_id = COALESCE(?, user_id),
           customer_name = ?,
           customer_email = ?,
           edition = ?,
           machine_fingerprint_prebind = ?,
           license_days = ?,
           status = ?,
           notes = ?,
           updated_at = ?
       WHERE id = ?`
    )
      .bind(
        userId,
        name,
        email,
        edition,
        machineFingerprintPrebind,
        licenseDays,
        status,
        notes,
        now,
        existing.id
      )
      .run();
    return env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(existing.id).first();
  }

  const result = await env.DB.prepare(
    `INSERT INTO customers
     (user_id, customer_name, customer_email, edition, machine_fingerprint_prebind,
      license_days, status, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(userId, name, email, edition, machineFingerprintPrebind, licenseDays, status, notes, now, now)
    .run();
  return env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(result.meta.last_row_id).first();
}

async function uniqueActivationCode(env) {
  for (let i = 0; i < 20; i += 1) {
    const code = activationCode();
    const existing = await env.DB.prepare("SELECT id FROM activation_codes WHERE code = ?").bind(code).first();
    if (!existing) return code;
  }
  throwHttp(500, "activation_code_generation_failed");
}

function activationCode() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const parts = [];
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  for (let i = 0; i < 4; i += 1) {
    let part = "";
    for (let j = 0; j < 4; j += 1) {
      part += alphabet[bytes[i * 4 + j] % alphabet.length];
    }
    parts.push(part);
  }
  return parts.join("-");
}

function canUseActivationCode(user, code, machineFingerprint = "") {
  const status = String(code.status || "");
  if (status === "used") {
    if (!code.used_by_user_id || Number(code.used_by_user_id) !== Number(user.id)) return false;
  } else if (!["active", "assigned"].includes(status)) {
    return false;
  }
  if (code.assigned_to_user_id && Number(code.assigned_to_user_id) !== Number(user.id)) return false;
  if (code.customer_email && normalizeEmail(code.customer_email) !== normalizeEmail(user.email)) return false;
  if (code.machine_fingerprint_prebind && String(code.machine_fingerprint_prebind).trim() !== String(machineFingerprint || "").trim()) {
    return false;
  }
  return true;
}

function normalizeActivationCodeStatus(value, fallback = "active") {
  const status = String(value || fallback || "active").trim().toLowerCase();
  return ["active", "assigned", "used", "revoked", "expired", "suspended"].includes(status) ? status : fallback;
}

function normalizeApprovalStatus(value) {
  const status = String(value || "auto").trim().toLowerCase();
  return ["auto", "manual", "pending", "approved", "rejected"].includes(status) ? status : "auto";
}

function normalizeLicenseExpiry(body, fallback) {
  const explicit = String(body.expires_at || "").trim();
  if (explicit) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(explicit)) {
      throwHttp(400, "expires_at_invalid");
    }
    return explicit;
  }
  const extendDays = Number(body.extend_days || body.days || 0);
  if (extendDays > 0) {
    const base = fallback && fallback >= todayIso() ? fallback : todayIso();
    return addDays(base, Math.floor(extendDays));
  }
  return fallback;
}

function boolToInt(value) {
  if (value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true") return 1;
  return 0;
}

function appendNote(existing, note) {
  const current = safeText(existing || "", 1800);
  const next = `[${nowIso()}] ${note}`;
  return current ? `${current}\n${next}` : next;
}

async function latestRelease(env, edition, channel) {
  return env.DB.prepare(
    `SELECT * FROM release_versions
     WHERE channel = ? AND (edition = ? OR edition = 'all')
     ORDER BY released_at DESC
     LIMIT 1`
  )
    .bind(channel, edition)
    .first();
}

function releasePayload(row) {
  return {
    latest_version: row.version,
    version: row.version,
    channel: row.channel,
    release_date: row.released_at,
    release_notes: row.release_notes || "",
    download_url: row.download_url || "",
    file_size_bytes: row.file_size_bytes || 0,
    sha256: row.file_hash_sha256 || "",
    is_required: Boolean(Number(row.is_required)),
  };
}

function versionGreater(next, current) {
  if (!current) return true;
  const a = String(next).split(".").map((part) => Number.parseInt(part, 10));
  const b = String(current).split(".").map((part) => Number.parseInt(part, 10));
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff > 0;
  }
  return String(next) !== String(current);
}

async function audit(env, action, actor, payload) {
  await env.DB.prepare("INSERT INTO admin_audit_events (action, actor, payload, created_at) VALUES (?, ?, ?, ?)")
    .bind(action, actor, JSON.stringify(payload || {}), nowIso())
    .run();
}

async function issueVerificationCode(ctx, email, purpose) {
  const normalizedPurpose = normalizeVerificationPurpose(purpose);
  const code = sixDigitCode();
  const now = nowIso();
  const expiresAt = new Date(Date.now() + intEnv(ctx.env.AUTH_CODE_TTL_SECONDS, 600) * 1000).toISOString();
  const codeHash = await verificationCodeHash(ctx.env, email, normalizedPurpose, code);

  await ctx.env.DB.prepare(
    `INSERT INTO auth_verification_codes
     (email, purpose, code_hash, expires_at, client_ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(email, normalizedPurpose, codeHash, expiresAt, clientIp(ctx.request), now)
    .run();

  await sendVerificationEmail(ctx.env, { email, purpose: normalizedPurpose, code, expiresAt });
  return { expires_at: expiresAt };
}

async function consumeVerificationCode(env, email, purpose, code) {
  const normalizedPurpose = normalizeVerificationPurpose(purpose);
  const now = nowIso();
  const row = await env.DB.prepare(
    `SELECT *
     FROM auth_verification_codes
     WHERE email = ? AND purpose = ? AND consumed_at IS NULL
     ORDER BY id DESC
     LIMIT 1`
  )
    .bind(email, normalizedPurpose)
    .first();

  if (!row) {
    throwHttp(400, "verification_code_invalid");
  }
  if (row.expires_at < now) {
    throwHttp(400, "verification_code_expired");
  }
  if (Number(row.attempt_count || 0) >= 5) {
    throwHttp(400, "verification_code_invalid");
  }

  const expected = await verificationCodeHash(env, email, normalizedPurpose, code);
  if (!timingSafeEqual(expected, row.code_hash)) {
    await env.DB.prepare("UPDATE auth_verification_codes SET attempt_count = attempt_count + 1 WHERE id = ?")
      .bind(row.id)
      .run();
    throwHttp(400, "verification_code_invalid");
  }

  await env.DB.prepare("UPDATE auth_verification_codes SET consumed_at = ? WHERE id = ?")
    .bind(now, row.id)
    .run();
}

async function verificationCodeHash(env, email, purpose, code) {
  const input = `${normalizeEmail(email)}|${normalizeVerificationPurpose(purpose)}|${String(code).trim()}`;
  return base64UrlEncode(await hmacSha256(input, secret(env, "JWT_SECRET")));
}

async function sendVerificationEmail(env, options) {
  const apiKey = String(env.RESEND_API_KEY || "");
  const from = String(env.EMAIL_FROM || "");
  if (!apiKey || !from) {
    throwHttp(503, "email_delivery_not_configured");
  }

  const subject =
    options.purpose === "reset_password"
      ? "Scorpio Intelligence 密码重置验证码"
      : "Scorpio Intelligence 注册验证码";
  const purposeText = options.purpose === "reset_password" ? "重置密码" : "完成注册";
  const text = [
    `你的 Scorpio Intelligence ${purposeText}验证码是：${options.code}`,
    "",
    "验证码 10 分钟内有效。如非本人操作，请忽略这封邮件。",
  ].join("\n");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: options.email,
      subject,
      text,
    }),
  });

  if (!response.ok) {
    throwHttp(502, "email_delivery_failed");
  }
}

function normalizeVerificationPurpose(value) {
  const purpose = String(value || "").trim().toLowerCase();
  if (purpose === "register" || purpose === "reset_password") {
    return purpose;
  }
  throwHttp(400, "verification_purpose_invalid");
}

function sixDigitCode() {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(value).padStart(6, "0");
}

async function emailHash(email) {
  if (!email) return "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeEmail(email)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function safeUsername(value) {
  const text = String(value || "user").trim();
  return text.slice(0, 64) || "user";
}

function safeText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeFeedbackSubmission(body) {
  const type = normalizeFeedbackType(body.type || body.kind || "experience", "experience");
  const contactEmail = normalizeEmail(body.contact_email || body.email || "");
  const title = safeText(body.title || "", 160);
  const description = safeText(body.description || body.message || "", 5000);
  const rating = Number(body.rating || body.satisfaction || 0);
  const surveyAnswers = typeof body.survey_answers === "object" && body.survey_answers
    ? body.survey_answers
    : {};

  if (!title) {
    throwHttp(400, "feedback_title_required");
  }
  if (!description) {
    throwHttp(400, "feedback_description_required");
  }
  if (contactEmail && !isEmail(contactEmail)) {
    throwHttp(400, "email_invalid");
  }

  return {
    type,
    product_area: normalizeFeedbackArea(body.product_area || body.area || "website"),
    priority: normalizeFeedbackPriority(body.priority || body.severity || "normal", "normal"),
    title,
    description,
    contact_email: contactEmail,
    page_url: safeUrl(body.page_url || body.url || ""),
    client_version: safeText(body.client_version || body.version || "", 80),
    environment: safeText(body.environment || body.os || "", 500),
    rating: Number.isFinite(rating) ? Math.max(0, Math.min(5, Math.round(rating))) : 0,
    survey_answers: {
      role: safeText(surveyAnswers.role || body.role || "", 80),
      usage_stage: safeText(surveyAnswers.usage_stage || body.usage_stage || "", 80),
      main_goal: safeText(surveyAnswers.main_goal || body.main_goal || "", 240),
      biggest_blocker: safeText(surveyAnswers.biggest_blocker || body.biggest_blocker || "", 500),
      expected_improvement: safeText(surveyAnswers.expected_improvement || body.expected_improvement || "", 500),
      allow_contact: Boolean(surveyAnswers.allow_contact || body.allow_contact),
    },
  };
}

function normalizeFeedbackType(value, fallback = "experience") {
  const type = String(value || fallback).trim().toLowerCase().replaceAll("-", "_");
  return ["bug", "experience", "survey", "question"].includes(type) ? type : fallback;
}

function normalizeFeedbackArea(value) {
  const area = String(value || "website").trim().toLowerCase().replaceAll("-", "_");
  return ["website", "account", "license", "desktop", "data_sync", "research", "admin", "other"].includes(area)
    ? area
    : "other";
}

function normalizeFeedbackPriority(value, fallback = "normal") {
  const priority = String(value || fallback).trim().toLowerCase();
  return ["low", "normal", "high", "urgent"].includes(priority) ? priority : fallback;
}

function normalizeFeedbackStatus(value, fallback = "new") {
  const status = String(value || fallback).trim().toLowerCase().replaceAll("-", "_");
  return ["new", "triaged", "in_progress", "resolved", "closed"].includes(status) ? status : fallback;
}

function safeUrl(value) {
  const text = safeText(value, 500);
  if (!text) return "";
  return /^https?:\/\//i.test(text) ? text : "";
}

function normalizeEdition(value) {
  const edition = String(value || "personal_pro").trim().toLowerCase().replaceAll("-", "_");
  const aliases = {
    pro: "personal_pro",
    standard: "personal_standard",
  };
  return aliases[edition] || edition;
}

function normalizeCustomerStatus(value) {
  const status = String(value || "draft").trim().toLowerCase();
  return ["draft", "active", "suspended", "cancelled", "issued"].includes(status) ? status : "draft";
}

function clientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    (request.headers.get("X-Forwarded-For") || "").split(",")[0].trim() ||
    ""
  );
}

function listEnv(value, fallback) {
  return String(value || fallback || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function intEnv(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function secret(env, name) {
  const value = env[name];
  if (!value) {
    throwHttp(500, `${name.toLowerCase()}_not_configured`);
  }
  return String(value);
}

function nowIso() {
  return new Date().toISOString();
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(start, end) {
  const a = new Date(`${start}T00:00:00.000Z`);
  const b = new Date(`${end}T00:00:00.000Z`);
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

function timeCompact() {
  return new Date().toISOString().slice(11, 19).replaceAll(":", "");
}

function nullableText(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function parseJson(value, fallback = {}) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

function randomToken(byteLength) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return base64UrlEncode(bytes);
}

function base64UrlJson(value) {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value) {
  const padded = String(value || "").replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(String(value || "").length / 4) * 4,
    "="
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function timingSafeEqual(a, b) {
  const left = new TextEncoder().encode(String(a || ""));
  const right = new TextEncoder().encode(String(b || ""));
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (left[i] || 0) ^ (right[i] || 0);
  }
  return diff === 0;
}
