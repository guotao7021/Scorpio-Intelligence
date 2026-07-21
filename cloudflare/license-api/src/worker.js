import { ed25519 } from "@noble/curves/ed25519";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
};

const TEXT_HEADERS = {
  "content-type": "text/plain; charset=utf-8",
};

const DEFAULT_PUBLIC_PRODUCT_VIDEO_R2_KEY = "产品介绍/Scorpio_Intelligence_Product_Introduction.mp4";

const REAL_USER_SQL_FILTER = `
  LOWER(COALESCE(u.email, '')) NOT LIKE '%@example.com'
  AND LOWER(COALESCE(u.email, '')) NOT LIKE '%+cf%@%'
  AND LOWER(COALESCE(u.email, '')) NOT LIKE '%cf-test%'
  AND LOWER(COALESCE(u.username, '')) NOT LIKE '%cf-test%'
`;

const ROUTES = new Map();

export default {
  async fetch(request, env) {
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
        if (
          (request.method === "GET" || request.method === "HEAD") &&
          path === "/v1/site/product-video"
        ) {
          return withCors(await servePublicProductVideo({ request, env }), corsHeaders);
        }
        if (request.method === "GET" && path.startsWith("/v1/license/download/")) {
          const licenseId = decodeURIComponent(path.slice("/v1/license/download/".length)).trim();
          return withCors(await downloadLicenseFile({ request, env, licenseId }), corsHeaders);
        }
        if (request.method === "GET" && path.startsWith("/v1/releases/download/")) {
          const releaseId = Number(decodeURIComponent(path.slice("/v1/releases/download/".length)).trim());
          return withCors(await downloadReleaseFile({ request, env, releaseId }), corsHeaders);
        }
        if (request.method === "GET" && path.startsWith("/v1/data-packages/")) {
          const packageId = decodeURIComponent(path.slice("/v1/data-packages/".length)).trim();
          return withCors(await getDataPackageDetail({ request, env, url, packageId }), corsHeaders);
        }
        if (request.method === "GET" && path.startsWith("/v1/data-sync/tables/") && path.endsWith("/rows")) {
          const tableName = decodeURIComponent(
            path.slice("/v1/data-sync/tables/".length, -"/rows".length)
          ).trim();
          return withCors(await getDataSyncTableRows({ request, env, url, tableName }), corsHeaders);
        }
        if (request.method === "GET" && path.startsWith("/v1/scorpio_v1_admin/cloud-db/tables/")) {
          const tableName = decodeURIComponent(
            path.slice("/v1/scorpio_v1_admin/cloud-db/tables/".length)
          ).trim();
          return withCors(await getAdminCloudDbTableDetail({ request, env, url, tableName }), corsHeaders);
        }
        if (request.method === "GET" && path.startsWith("/v1/scorpio_v1_admin/production-uploads/")) {
          const batchId = decodeURIComponent(
            path.slice("/v1/scorpio_v1_admin/production-uploads/".length)
          ).trim();
          return withCors(await getAdminProductionUploadBatchDetail({ request, env, url, batchId }), corsHeaders);
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

        if ((request.method === "PUT" || request.method === "DELETE") && path.startsWith("/v1/scorpio_v1_admin/data-packages/")) {
          const packageId = decodeURIComponent(path.slice("/v1/scorpio_v1_admin/data-packages/".length)).trim();
          if (request.method === "PUT") {
            return withCors(await updateAdminDataPackage({ request, env, packageId }), corsHeaders);
          }
          return withCors(await deactivateAdminDataPackage({ request, env, packageId }), corsHeaders);
        }
        if ((request.method === "PUT" || request.method === "DELETE") && path.startsWith("/v1/scorpio_v1_admin/releases/")) {
          const releaseId = Number(decodeURIComponent(path.slice("/v1/scorpio_v1_admin/releases/".length)).trim());
          if (request.method === "PUT") {
            return withCors(await updateAdminRelease({ request, env, releaseId }), corsHeaders);
          }
          return withCors(await deactivateAdminRelease({ request, env, releaseId }), corsHeaders);
        }
        if (request.method === "GET" && path === "/health") {
          return json({ ok: true, service: "scorpio-license-api" }, 200, corsHeaders);
        }
        return json({ error: "not_found" }, 404, corsHeaders);
      }
      const result = await handler({ request, env, url, corsHeaders });
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

  const response = await tokenResponse(ctx.env, user);
  const activationCodes = await assignedActivationCodes(ctx.env, user.id);
  return json(withActivationCodes(response, activationCodes));
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

  await enforcePublicRateLimit(ctx.env, {
    scope: "auth_code_ip",
    subject: clientIp(ctx.request) || "unknown",
    limit: intEnv(ctx.env.AUTH_CODE_IP_RATE_LIMIT_PER_HOUR, 10),
    windowSeconds: 60 * 60,
  });
  await enforcePublicRateLimit(ctx.env, {
    scope: "auth_code_email",
    subject: email,
    limit: intEnv(ctx.env.AUTH_CODE_EMAIL_RATE_LIMIT_PER_HOUR, 3),
    windowSeconds: 60 * 60,
  });

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

route("GET", "/v1/license/current", async (ctx) => {
  const user = await requireUser(ctx);
  const lic = await ctx.env.DB.prepare(
    `SELECT *
     FROM licenses
     WHERE user_id = ? AND is_active = 1 AND revoked = 0
     ORDER BY created_at DESC, id DESC
     LIMIT 1`
  )
    .bind(user.id)
    .first();
  if (!lic) {
    const activationCodes = await assignedActivationCodes(ctx.env, user.id);
    return json(
      withActivationCodes(
        {
          active: false,
          message: activationCodes.length ? "activation_code_assigned" : "active_license_not_found",
        },
        activationCodes
      )
    );
  }
  const valid = lic.expires_at >= todayIso() && !["pending", "rejected"].includes(String(lic.approval_status || ""));
  const activationCodes = await assignedActivationCodes(ctx.env, user.id);
  return json(
    withActivationCodes(
      {
        active: valid,
        valid,
        message: valid ? "ok" : "license_inactive",
        ...licenseActivationResponse(lic),
      },
      activationCodes
    )
  );
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
    machine_fingerprint: license.machine_fingerprint || payload.machine_fingerprint || "",
    features: payload.features || {},
    license_file: payload,
    ...extras,
  };
}

async function assignedActivationCodes(env, userId) {
  const rows = await env.DB.prepare(
    `SELECT ac.code, ac.edition, ac.license_days, ac.status, ac.created_at,
            linked_license.license_id, linked_license.expires_at,
            linked_license.is_active AS license_active,
            linked_license.revoked AS license_revoked,
            linked_license.approval_status,
            linked_license.machine_fingerprint
     FROM activation_codes AS ac
     LEFT JOIN licenses AS linked_license
       ON linked_license.id = (
         SELECT latest_license.id
         FROM licenses AS latest_license
         WHERE latest_license.activation_code_id = ac.id
           AND latest_license.user_id = ?
         ORDER BY latest_license.created_at DESC, latest_license.id DESC
         LIMIT 1
       )
     WHERE (
       ac.assigned_to_user_id = ?
       OR ac.used_by_user_id = ?
       OR EXISTS (
         SELECT 1
         FROM licenses AS linked_license
         WHERE linked_license.activation_code_id = ac.id
           AND linked_license.user_id = ?
       )
     )
       AND ac.status IN ('assigned', 'active', 'used')
     ORDER BY
       CASE
         WHEN linked_license.is_active = 1 AND linked_license.revoked = 0 THEN 0
         WHEN ac.status IN ('assigned', 'active') THEN 1
         WHEN ac.status = 'used' THEN 2
         ELSE 3
       END,
       ac.created_at DESC,
       ac.id DESC`
  )
    .bind(userId, userId, userId, userId)
    .all();
  return rows.results || [];
}

function withActivationCodes(payload, activationCodes) {
  const codes = (activationCodes || []).map((item) => ({
    code: item.code,
    status: item.status || "",
    edition: item.edition || "",
    license_days: Number(item.license_days || 0),
    created_at: item.created_at || "",
    license_id: item.license_id || "",
    expires_at: item.expires_at || "",
    license_active: Boolean(Number(item.license_active || 0)),
    license_revoked: Boolean(Number(item.license_revoked || 0)),
    approval_status: item.approval_status || "",
    machine_fingerprint: item.machine_fingerprint || "",
  }));
  const activationCode = codes[0] || null;
  return {
    ...payload,
    activation_codes: codes,
    activation_code: activationCode ? activationCode.code : "",
    activation_code_status: activationCode ? activationCode.status : "",
    activation_edition: activationCode ? activationCode.edition : "",
    activation_license_days: activationCode ? activationCode.license_days : 0,
    trial_activation_code: activationCode ? activationCode.code : "",
    trial_edition: activationCode ? activationCode.edition : "",
    trial_license_days: activationCode ? activationCode.license_days : 0,
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
  if (hasFeedbackHoneypotValue(body)) {
    // Do not disclose the honeypot to automated submitters. A success-shaped
    // response prevents them from using the endpoint as an oracle.
    return json({ accepted: true, status: "new" }, 201);
  }
  await enforcePublicRateLimit(ctx.env, {
    scope: "feedback_ip",
    subject: clientIp(ctx.request) || "unknown",
    limit: intEnv(ctx.env.FEEDBACK_RATE_LIMIT_PER_HOUR, 5),
    windowSeconds: 60 * 60,
  });
  const item = normalizeFeedbackSubmission(body);
  if (isMainlandChinaRequest(ctx.request)) {
    if (!item.contact_email) {
      throwHttp(400, "feedback_email_required");
    }
    const verificationCode = String(body.feedback_verification_code || body.verification_code || "").trim();
    if (!verificationCode) {
      throwHttp(400, "feedback_verification_code_required");
    }
    await consumeVerificationCode(ctx.env, item.contact_email, "feedback", verificationCode);
  } else {
    await verifyTurnstileToken(ctx.env, body.turnstile_token, ctx.request);
  }
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

route("GET", "/v1/feedback/security", async (ctx) => {
  return json({ mode: isMainlandChinaRequest(ctx.request) ? "email" : "turnstile" });
});

route("POST", "/v1/feedback/send-code", async (ctx) => {
  if (!isMainlandChinaRequest(ctx.request)) {
    return json({ error: "feedback_email_verification_unavailable" }, 403);
  }
  const body = await readJson(ctx.request);
  const email = normalizeEmail(body.email);
  if (!isEmail(email)) {
    return json({ error: "email_invalid" }, 400);
  }
  await enforcePublicRateLimit(ctx.env, {
    scope: "feedback_code_ip",
    subject: clientIp(ctx.request) || "unknown",
    limit: intEnv(ctx.env.FEEDBACK_CODE_IP_RATE_LIMIT_PER_HOUR, 5),
    windowSeconds: 60 * 60,
  });
  await enforcePublicRateLimit(ctx.env, {
    scope: "feedback_code_email",
    subject: email,
    limit: intEnv(ctx.env.FEEDBACK_CODE_EMAIL_RATE_LIMIT_PER_HOUR, 3),
    windowSeconds: 60 * 60,
  });
  const result = await issueVerificationCode(ctx, email, "feedback");
  return json({ message: "feedback_verification_code_sent", ...result });
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
  const user = await requireUser(ctx);
  const edition = ctx.url.searchParams.get("edition") || "personal_pro";
  const channel = ctx.url.searchParams.get("channel") || "stable";
  const latest = await latestRelease(ctx.env, edition, channel);
  if (!latest) {
    return json({ error: "release_not_found" }, 404);
  }
  await requireReleaseEntitlement(ctx.env, user, latest.edition);
  return json(releasePayload(latest));
});

route("GET", "/v1/releases/check", async (ctx) => {
  const user = await requireUser(ctx);
  const current = ctx.url.searchParams.get("version") || "";
  const edition = ctx.url.searchParams.get("edition") || "personal_pro";
  const channel = ctx.url.searchParams.get("channel") || "stable";
  const latest = await latestRelease(ctx.env, edition, channel);
  if (!latest) {
    return json({ has_update: false, message: "release_not_found" });
  }
  await requireReleaseEntitlement(ctx.env, user, latest.edition);
  return json({
    has_update: versionGreater(latest.version, current),
    ...releasePayload(latest),
  });
});

route("GET", "/v1/data-packages/latest", async (ctx) => {
  const user = await requireUser(ctx);
  const request = normalizeDataPackageRequest(ctx.url.searchParams);
  const license = await verifyDataPackageLicense(ctx.env, user, request);
  const row = await latestDataPackage(ctx.env, license.edition, request.channel, request.client_version);
  if (!row) {
    await recordDeviceSyncLog(ctx.env, {
      user,
      license,
      request,
      packageId: "",
      status: "not_found",
      errorMessage: "data_package_not_found",
      clientIp: clientIp(ctx.request),
    });
    return json({ ok: false, error: "data_package_not_found", edition: license.edition, channel: request.channel }, 404);
  }
  await recordDeviceSyncLog(ctx.env, {
    user,
    license,
    request,
    packageId: row.package_id,
    status: "catalog_checked",
    clientIp: clientIp(ctx.request),
  });
  return json({ ok: true, package: dataPackagePayload(row, ctx.env) });
});

route("POST", "/v1/data-packages/sync-log", async (ctx) => {
  const user = await requireUser(ctx);
  const body = await readJson(ctx.request);
  const request = normalizeDataPackageBody(body);
  const license = await verifyDataPackageLicense(ctx.env, user, request);
  const status = normalizeSyncStatus(body.status || "client_reported");
  await recordDeviceSyncLog(ctx.env, {
    user,
    license,
    request,
    packageId: safeText(body.package_id || "", 128),
    status,
    errorMessage: safeText(body.error_message || "", 500),
    clientIp: clientIp(ctx.request),
  });
  return json({ accepted: true, status });
});

route("GET", "/v1/data-sync/manifest", async (ctx) => {
  const user = await requireUser(ctx);
  const request = normalizeDataSyncRequest(ctx.url.searchParams);
  const license = await verifyDataPackageLicense(ctx.env, user, request);
  const manifest = await dataSyncManifest(ctx.env, license, request);
  await recordDeviceSyncLog(ctx.env, {
    user,
    license,
    request,
    packageId: `row-sync:${request.module}`,
    status: "catalog_checked",
    clientIp: clientIp(ctx.request),
  });
  return json({ ok: true, ...manifest });
});

route("POST", "/v1/data-sync/client-log", async (ctx) => {
  const user = await requireUser(ctx);
  const body = await readJson(ctx.request);
  const request = normalizeDataSyncBody(body);
  const license = await verifyDataPackageLicense(ctx.env, user, request);
  const status = normalizeSyncStatus(body.status || "client_reported");
  await recordDeviceSyncLog(ctx.env, {
    user,
    license,
    request,
    packageId: `row-sync:${request.module}:${safeText(body.table_name || "", 96)}`,
    status,
    errorMessage: safeText(body.error_message || "", 500),
    clientIp: clientIp(ctx.request),
  });
  return json({ accepted: true, status });
});

route("GET", "/v1/analysis/health", async (ctx) => {
  const compute = await analysisComputeHealth(ctx.env);
  const mode = !compute.configured ? "contract_ready" : compute.ok ? "compute_proxy" : "compute_unreachable";
  return json({
    ok: true,
    service: "scorpio-analysis-api",
    mode,
    ready: !compute.configured || compute.ok,
    gateway: { ok: true },
    compute,
    security: analysisSecurityStatus(ctx.env),
    generated_at: nowIso(),
  });
});

route("POST", "/v1/analysis/stock/bundle", async (ctx) => {
  const startedAt = Date.now();
  const user = await requireUser(ctx);
  const body = await readJson(ctx.request);
  const request = normalizeAnalysisRequest(body, "stock");
  const license = await verifyAnalysisLicense(ctx.env, user, request.license_id);
  await applyAnalysisSecurity(ctx, { user, license, requestBody: body, endpoint: "/v1/analysis/stock/bundle" });

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
  await applyAnalysisSecurity(ctx, { user, license, requestBody: body, endpoint: "/v1/analysis/stock/price-technical" });

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
  await applyAnalysisSecurity(ctx, { user, license, requestBody: body, endpoint: "/v1/analysis/stock/reason" });

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

route("POST", "/v1/site/visit", async (ctx) => {
  const body = await readJson(ctx.request);
  const result = await recordSiteVisit(ctx.env, ctx.request, body);
  return json(result);
});

route("POST", "/v1/analysis/portfolio/enrich", async (ctx) => {
  const startedAt = Date.now();
  const user = await requireUser(ctx);
  const body = await readJson(ctx.request);
  const request = normalizePortfolioRequest(body);
  const license = await verifyAnalysisLicense(ctx.env, user, request.license_id);
  await applyAnalysisSecurity(ctx, { user, license, requestBody: body, endpoint: "/v1/analysis/portfolio/enrich" });

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

  const [users, licensedUsers, customers, codes, licenses, releases, downloads, visits, analysis, recentAudits, recentLicenses, expiringLicenses] =
    await Promise.all([
      ctx.env.DB.prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN email_verified = 1 THEN 1 ELSE 0 END) AS verified,
                SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS registered_24h
         FROM users u
         WHERE ${REAL_USER_SQL_FILTER}`
      ).bind(since24h).first(),
      ctx.env.DB.prepare(
        `SELECT COUNT(DISTINCT l.user_id) AS total,
                COUNT(DISTINCT CASE WHEN l.is_active = 1 AND l.revoked = 0 THEN l.user_id END) AS active,
                COUNT(DISTINCT CASE WHEN l.is_active = 1 AND l.revoked = 0 AND datetime(l.expires_at) >= datetime('now') THEN l.user_id END) AS valid,
                COUNT(DISTINCT CASE WHEN l.created_at >= ? THEN l.user_id END) AS bound_24h
         FROM licenses l
         JOIN users u ON u.id = l.user_id
         WHERE ${REAL_USER_SQL_FILTER}`
      ).bind(since24h).first(),
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
                MAX(released_at) AS latest_released_at,
                SUM(COALESCE(download_count, 0)) AS download_count
         FROM release_versions`
      ).first(),
      ctx.env.DB.prepare(
        `SELECT COALESCE(SUM(download_count), 0) AS total_24h
         FROM release_download_daily
         WHERE event_date >= ?`
      ).bind(today).first(),
      ctx.env.DB.prepare(
        `SELECT COALESCE(SUM(visit_count), 0) AS visits_24h,
                COALESCE(SUM(unique_visitor_count), 0) AS unique_visitors_24h
         FROM site_page_daily
         WHERE event_date >= ?`
      ).bind(today).first(),
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
    users: compactCounts(users, ["total", "verified", "registered_24h"]),
    licensed_users: compactCounts(licensedUsers, ["total", "active", "valid", "bound_24h"]),
    customers: compactCounts(customers, ["total", "active", "draft", "suspended"]),
    activation_codes: compactCounts(codes, ["total", "active", "assigned", "used", "revoked"]),
    licenses: compactCounts(licenses, ["total", "active", "pending", "revoked", "expiring_soon"]),
    releases: {
      ...compactCounts(releases, ["total", "download_count"]),
      downloads_24h: numberField(downloads, "total_24h"),
    },
    release_latest_released_at: (releases && releases.latest_released_at) || "",
    site: {
      visits_24h: numberField(visits, "visits_24h"),
      unique_visitors_24h: numberField(visits, "unique_visitors_24h"),
    },
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

route("GET", "/v1/scorpio_v1_admin/site-analytics", async (ctx) => {
  requireAdmin(ctx);
  const options = adminListOptions(ctx.url, { defaultLimit: 30, maxLimit: 180 });
  const days = Math.min(Math.max(Number(ctx.url.searchParams.get("days") || 30), 1), 180);
  const since = addDays(todayIso(), -(days - 1));
  const [summary, registrations, licensedUsers, pages, downloads] = await Promise.all([
    ctx.env.DB.prepare(
      `SELECT COALESCE(SUM(visit_count), 0) AS visits,
              COALESCE(SUM(unique_visitor_count), 0) AS unique_visitors
       FROM site_page_daily
       WHERE event_date >= ?`
    ).bind(since).first(),
    ctx.env.DB.prepare(
      `SELECT COUNT(*) AS total
       FROM users u
       WHERE created_at >= ? AND ${REAL_USER_SQL_FILTER}`
    ).bind(since).first(),
    ctx.env.DB.prepare(
      `SELECT COUNT(DISTINCT l.user_id) AS total,
              COUNT(DISTINCT CASE WHEN l.is_active = 1 AND l.revoked = 0 AND datetime(l.expires_at) >= datetime('now') THEN l.user_id END) AS valid
       FROM licenses l
       JOIN users u ON u.id = l.user_id
       WHERE l.created_at >= ? AND ${REAL_USER_SQL_FILTER}`
    ).bind(since).first(),
    ctx.env.DB.prepare(
      `SELECT event_date, page_path, page_title, language, visit_count, unique_visitor_count, updated_at
       FROM site_page_daily
       WHERE event_date >= ?
       ORDER BY event_date DESC, visit_count DESC
       LIMIT ? OFFSET ?`
    ).bind(since, options.limit, options.offset).all(),
    ctx.env.DB.prepare(
      `SELECT d.event_date, d.release_id, d.version, d.channel, d.edition, d.file_name,
              d.download_count, rv.download_count AS total_download_count, d.updated_at
       FROM release_download_daily d
       LEFT JOIN release_versions rv ON rv.id = d.release_id
       WHERE d.event_date >= ?
       ORDER BY d.event_date DESC, d.download_count DESC
       LIMIT ? OFFSET ?`
    ).bind(since, options.limit, options.offset).all(),
  ]);
  return json({
    generated_at: nowIso(),
    days,
    since,
    visits: {
      total: numberField(summary, "visits"),
      unique_visitors: numberField(summary, "unique_visitors"),
    },
    registrations: {
      total: numberField(registrations, "total"),
    },
    licensed_users: {
      total: numberField(licensedUsers, "total"),
      valid: numberField(licensedUsers, "valid"),
    },
    pages: pages.results || [],
    downloads: downloads.results || [],
  });
});

route("GET", "/v1/scorpio_v1_admin/signing/health", async (ctx) => {
  requireAdmin(ctx);
  const info = await signingKeyHealth(ctx.env);
  return json(info);
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

  if (adminForceDelete(ctx.request)) {
    const licenseIds = await linkedLicenseIdsForCustomer(ctx.env, customerId);
    for (const licenseId of licenseIds) {
      await deleteLicenseDependents(ctx.env, licenseId);
    }
    await ctx.env.DB.prepare(
      `DELETE FROM licenses
       WHERE activation_code_id IN (SELECT id FROM activation_codes WHERE customer_id = ?)`
    )
      .bind(customerId)
      .run();
    const deletedCodes = await ctx.env.DB.prepare("DELETE FROM activation_codes WHERE customer_id = ?")
      .bind(customerId)
      .run();
    await ctx.env.DB.prepare("DELETE FROM customers WHERE id = ?").bind(customerId).run();
    await audit(ctx.env, "force_delete_customer", "admin_api", {
      customer_id: customerId,
      email: existing.customer_email,
      activation_code_count: numberField(deletedCodes.meta || {}, "changes"),
      license_count: licenseIds.length,
    });
    return json({
      deleted: true,
      force_deleted: true,
      id: customerId,
      activation_code_count: numberField(deletedCodes.meta || {}, "changes"),
      license_count: licenseIds.length,
    });
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
  if (adminForceDelete(ctx.request)) {
    const licenseRows = await ctx.env.DB.prepare("SELECT license_id FROM licenses WHERE activation_code_id = ?")
      .bind(existing.id)
      .all();
    const licenseIds = (licenseRows.results || []).map((row) => row.license_id).filter(Boolean);
    for (const licenseId of licenseIds) {
      await deleteLicenseDependents(ctx.env, licenseId);
    }
    await ctx.env.DB.prepare("DELETE FROM licenses WHERE activation_code_id = ?").bind(existing.id).run();
    await ctx.env.DB.prepare("DELETE FROM activation_codes WHERE id = ?").bind(existing.id).run();
    await audit(ctx.env, "force_delete_activation_code", "admin_api", {
      code: codeText,
      license_count: licenseIds.length,
    });
    return json({ deleted: true, force_deleted: true, code: codeText, license_count: licenseIds.length });
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
  if (adminForceDelete(ctx.request)) {
    await deleteLicenseDependents(ctx.env, licenseId);
    await ctx.env.DB.prepare("DELETE FROM licenses WHERE license_id = ?").bind(licenseId).run();
    await audit(ctx.env, "force_delete_license", "admin_api", { license_id: licenseId });
    return json({ deleted: true, force_deleted: true, license_id: licenseId });
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
  addListTextSearch(where, params, ["version", "release_notes", "download_url", "r2_key", "file_name"], options.q);
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
    `SELECT id, version, channel, edition, release_notes, download_url, r2_key, file_name,
            content_type, file_hash_sha256, file_size_bytes, is_required, released_at,
            uploaded_at, download_count, is_active
     FROM release_versions
     ${filter}
     ORDER BY released_at DESC, id DESC
     LIMIT ? OFFSET ?`
  ).bind(...params, options.limit, options.offset).all();
  return json(pageResponse(rows.results || [], total, options));
});

route("GET", "/v1/scorpio_v1_admin/data-packages", async (ctx) => {
  requireAdmin(ctx);
  const options = adminListOptions(ctx.url, { defaultLimit: 50, maxLimit: 200 });
  const where = [];
  const params = [];
  addListTextSearch(where, params, ["package_id", "version", "data_date", "download_url", "r2_key"], options.q);
  if (options.edition) {
    where.push("edition = ?");
    params.push(options.edition);
  }
  if (options.channel) {
    where.push("channel = ?");
    params.push(options.channel);
  }
  if (options.status === "active") {
    where.push("is_active = 1");
  } else if (options.status === "inactive") {
    where.push("is_active = 0");
  }
  const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = await ctx.env.DB.prepare(`SELECT COUNT(*) AS total FROM data_packages ${filter}`).bind(...params).first();
  const rows = await ctx.env.DB.prepare(
    `SELECT id, package_id, edition, channel, version, schema_version, data_date, valid_from,
            expires_at, min_client_version, detail_level, r2_key, download_url, sha256,
            signature, size_bytes, capability_scope, manifest_summary, is_active,
            published_at, created_at, updated_at
     FROM data_packages
     ${filter}
     ORDER BY published_at DESC, id DESC
     LIMIT ? OFFSET ?`
  ).bind(...params, options.limit, options.offset).all();
  return json(pageResponse(rows.results || [], total, options));
});

route("GET", "/v1/scorpio_v1_admin/production-uploads", async (ctx) => {
  requireAdmin(ctx);
  const options = adminListOptions(ctx.url, { defaultLimit: 50, maxLimit: 200 });
  const where = [];
  const params = [];
  addListTextSearch(where, params, ["batch_id", "module", "status", "edition_scope"], options.q);
  if (options.status) {
    where.push("status = ?");
    params.push(options.status);
  }
  const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = await ctx.env.DB.prepare(`SELECT COUNT(*) AS total FROM production_upload_batches ${filter}`).bind(...params).first();
  const rows = await ctx.env.DB.prepare(
    `SELECT batch_id, module, source, mode, edition_scope, status, table_count, row_count,
            received_row_count, received_chunk_count, manifest_hash, error_message,
            created_at, updated_at, committed_at
     FROM production_upload_batches
     ${filter}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(...params, options.limit, options.offset).all();
  return json(pageResponse(rows.results || [], total, options));
});

route("GET", "/v1/scorpio_v1_admin/cloud-db/overview", async (ctx) => {
  requireAdmin(ctx);
  return json(await adminCloudDbOverview(ctx.env, ctx.url));
});

route("GET", "/v1/scorpio_v1_admin/cloud-db/tables", async (ctx) => {
  requireAdmin(ctx);
  return json(await adminCloudDbTables(ctx.env, ctx.url));
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
  const record = normalizeAdminRelease(await readJson(ctx.request));
  await upsertRelease(ctx.env, record);

  await audit(ctx.env, "upsert_release", "admin_api", {
    version: record.version,
    channel: record.channel,
    edition: record.edition,
    r2_key: record.r2_key,
  });
  return json({
    ...record,
    is_required: Boolean(record.is_required),
  }, 201);
});

route("POST", "/v1/scorpio_v1_admin/data-packages", async (ctx) => {
  requireAdmin(ctx);
  const body = await readJson(ctx.request);
  const record = normalizeAdminDataPackage(body);
  await upsertDataPackage(ctx.env, record);
  await audit(ctx.env, "upsert_data_package", "admin_api", {
    package_id: record.package_id,
    edition: record.edition,
    channel: record.channel,
    version: record.version,
  });
  return json(record, 201);
});

route("POST", "/v1/scorpio_v1_admin/production-uploads/batches", async (ctx) => {
  requireAdmin(ctx);
  const body = await readJson(ctx.request);
  const record = normalizeProductionUploadBatch(body);
  const existing = await ctx.env.DB.prepare("SELECT * FROM production_upload_batches WHERE batch_id = ?")
    .bind(record.batch_id)
    .first();
  if (existing && String(existing.status || "") === "committed") {
    return json({ ok: true, batch_id: record.batch_id, status: "committed", already_committed: true });
  }
  if (existing && body.resume && String(existing.manifest_hash || "") === record.manifest_hash && !["aborted", "committing"].includes(String(existing.status || ""))) {
    const chunks = await listProductionUploadChunks(ctx.env, record.batch_id);
    return json({
      ok: true,
      batch_id: record.batch_id,
      status: existing.status || "created",
      resumed: true,
      received_row_count: numberField(existing, "received_row_count"),
      received_chunk_count: numberField(existing, "received_chunk_count"),
      chunks,
    });
  }
  if (existing && String(existing.status || "") === "aborted") {
    await ctx.env.DB.prepare("DELETE FROM production_upload_chunks WHERE batch_id = ?").bind(record.batch_id).run();
    await ctx.env.DB.prepare("DELETE FROM production_upload_staging_rows WHERE batch_id = ?").bind(record.batch_id).run();
  } else if (existing) {
    await ctx.env.DB.prepare("DELETE FROM production_upload_chunks WHERE batch_id = ?").bind(record.batch_id).run();
    await ctx.env.DB.prepare("DELETE FROM production_upload_staging_rows WHERE batch_id = ?").bind(record.batch_id).run();
  }
  await insertProductionUploadBatch(ctx.env, record);
  await audit(ctx.env, "create_production_upload_batch", "admin_api", {
    batch_id: record.batch_id,
    module: record.module,
    edition_scope: record.edition_scope,
    row_count: record.row_count,
  });
  return json({ ok: true, batch_id: record.batch_id, status: record.status, chunks: [] }, 201);
});

route("POST", "/v1/scorpio_v1_admin/production-uploads/chunks", async (ctx) => {
  requireAdmin(ctx);
  const body = await readJson(ctx.request);
  const chunk = normalizeProductionUploadChunk(body);
  const batch = await ctx.env.DB.prepare("SELECT * FROM production_upload_batches WHERE batch_id = ?")
    .bind(chunk.batch_id)
    .first();
  if (!batch) {
    throwHttp(404, "production_upload_batch_not_found");
  }
  if (["committed", "aborted", "committing"].includes(String(batch.status || ""))) {
    throwHttp(409, `production_upload_batch_${batch.status}`);
  }
  const existingChunk = await ctx.env.DB.prepare(
    "SELECT row_count, chunk_hash FROM production_upload_chunks WHERE batch_id = ? AND table_name = ? AND chunk_index = ?"
  ).bind(chunk.batch_id, chunk.table_name, chunk.chunk_index).first();
  if (existingChunk) {
    if (
      String(existingChunk.chunk_hash || "") === chunk.chunk_hash
      && Number(existingChunk.row_count || 0) === chunk.rows.length
    ) {
      return json({
        ok: true,
        batch_id: chunk.batch_id,
        table_name: chunk.table_name,
        chunk_index: chunk.chunk_index,
        row_count: chunk.rows.length,
        duplicate: true,
      });
    }
    throwHttp(409, "production_upload_chunk_conflict");
  }
  await storeProductionUploadChunk(ctx.env, chunk);
  return json({
    ok: true,
    batch_id: chunk.batch_id,
    table_name: chunk.table_name,
    chunk_index: chunk.chunk_index,
    row_count: chunk.rows.length,
  });
});

route("POST", "/v1/scorpio_v1_admin/production-uploads/commit", async (ctx) => {
  requireAdmin(ctx);
  const body = await readJson(ctx.request);
  const batchId = safeText(body.batch_id || "", 96);
  if (!batchId) {
    throwHttp(400, "production_upload_batch_id_required");
  }
  const batch = await ctx.env.DB.prepare("SELECT * FROM production_upload_batches WHERE batch_id = ?")
    .bind(batchId)
    .first();
  if (!batch) {
    throwHttp(404, "production_upload_batch_not_found");
  }
  if (String(batch.status || "") === "committed") {
    return json({ ok: true, batch_id: batchId, status: "committed", already_committed: true });
  }
  if (String(batch.status || "") === "aborted") {
    throwHttp(409, "production_upload_batch_aborted");
  }
  const stats = await ctx.env.DB.prepare(
    `SELECT COUNT(*) AS chunk_count, COALESCE(SUM(row_count), 0) AS row_count
     FROM production_upload_chunks
     WHERE batch_id = ?`
  ).bind(batchId).first();
  const expectedRows = Math.max(Number(body.expected_row_count || 0), 0);
  const expectedChunks = Math.max(Number(body.expected_chunk_count || 0), 0);
  const rowCount = Number(stats && stats.row_count ? stats.row_count : 0);
  const chunkCount = Number(stats && stats.chunk_count ? stats.chunk_count : 0);
  if (expectedRows && expectedRows !== rowCount) {
    throwHttp(409, "production_upload_row_count_mismatch");
  }
  if (expectedChunks && expectedChunks !== chunkCount) {
    throwHttp(409, "production_upload_chunk_count_mismatch");
  }
  const staging = await ctx.env.DB.prepare(
    "SELECT COUNT(*) AS row_count FROM production_upload_staging_rows WHERE batch_id = ?"
  ).bind(batchId).first();
  const stagingRows = Number(staging && staging.row_count ? staging.row_count : 0);
  if (stagingRows !== rowCount) {
    throwHttp(409, "production_upload_staging_row_count_mismatch");
  }
  const now = nowIso();
  await ctx.env.DB.prepare(
    "UPDATE production_upload_batches SET status = 'committing', updated_at = ? WHERE batch_id = ?"
  ).bind(now, batchId).run();
  await commitProductionUploadBatch(ctx.env, batch, batchId);
  await ctx.env.DB.prepare(
    `UPDATE production_upload_batches
     SET status = 'committed',
         received_row_count = ?,
         received_chunk_count = ?,
         committed_at = ?,
         updated_at = ?
     WHERE batch_id = ?`
  ).bind(rowCount, chunkCount, now, now, batchId).run();
  await audit(ctx.env, "commit_production_upload_batch", "admin_api", {
    batch_id: batchId,
    row_count: rowCount,
    chunk_count: chunkCount,
    manifest_hash: safeText(body.manifest_hash || "", 128),
  });
  return json({ ok: true, batch_id: batchId, row_count: rowCount, chunk_count: chunkCount, status: "committed" });
});

route("POST", "/v1/scorpio_v1_admin/production-uploads/rollback", async (ctx) => {
  requireAdmin(ctx);
  const body = await readJson(ctx.request);
  const batchId = safeText(body.batch_id || "", 96);
  if (!batchId) {
    throwHttp(400, "production_upload_batch_id_required");
  }
  await rollbackProductionUploadBatch(ctx.env, batchId, safeText(body.reason || "rollback_requested", 500));
  await audit(ctx.env, "rollback_production_upload_batch", "admin_api", {
    batch_id: batchId,
    reason: safeText(body.reason || "", 500),
  });
  return json({ ok: true, batch_id: batchId, status: "aborted" });
});

async function getAdminProductionUploadBatchDetail(ctx) {
  requireAdmin(ctx);
  const batchId = safeText(ctx.batchId || "", 96);
  if (!batchId) {
    throwHttp(400, "production_upload_batch_id_required");
  }
  const batch = await ctx.env.DB.prepare(
    `SELECT batch_id, module, source, mode, edition_scope, status, table_count, row_count,
            received_row_count, received_chunk_count, manifest_hash, error_message,
            created_at, updated_at, committed_at
     FROM production_upload_batches
     WHERE batch_id = ?`
  ).bind(batchId).first();
  if (!batch) {
    throwHttp(404, "production_upload_batch_not_found");
  }
  return json({
    ok: true,
    batch,
    chunks: await listProductionUploadChunks(ctx.env, batchId),
  });
}

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
    "access-control-allow-methods": "GET,HEAD,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-admin-token,x-scorpio-timestamp,x-scorpio-nonce,x-scorpio-signature",
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
    items: results,
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
  const provided = String(ctx.request.headers.get("X-Admin-Token") || "");
  if (!configured || !timingSafeEqual(provided, configured)) {
    throwHttp(403, "admin_token_required");
  }
}

function analysisComputeConfigured(env) {
  return Boolean(String(env.ANALYSIS_COMPUTE_URL || "").trim());
}

async function analysisComputeHealth(env) {
  if (!analysisComputeConfigured(env)) {
    return {
      configured: false,
      ok: false,
      mode: "not_configured",
      message: "Analysis Compute is not configured; contract fallback is active.",
    };
  }
  const baseUrl = String(env.ANALYSIS_COMPUTE_URL || "").replace(/\/+$/, "");
  const token = String(env.ANALYSIS_COMPUTE_TOKEN || "");
  const startedAt = Date.now();
  const headers = {};
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(intEnv(env.ANALYSIS_COMPUTE_HEALTH_TIMEOUT_MS, 3000)),
    });
    const text = await response.text();
    const data = parseJson(text, {});
    return {
      configured: true,
      ok: response.ok && data.ok !== false,
      mode: response.ok ? "upstream_ready" : "upstream_error",
      http_status: response.status,
      latency_ms: Date.now() - startedAt,
      service: safeText(data.service || "", 80),
      version: safeText(data.version || "", 80),
      cache: sanitizeComputeHealthObject(data.cache),
      diagnostics: sanitizeComputeHealthObject(data.diagnostics),
      message: response.ok ? "" : safeText(data.message || data.error || text, 240),
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      mode: "upstream_unreachable",
      http_status: 0,
      latency_ms: Date.now() - startedAt,
      error: safeText(error && error.message ? error.message : String(error), 240),
    };
  }
}

function sanitizeComputeHealthObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return JSON.parse(JSON.stringify(value));
}

function analysisSecurityStatus(env) {
  return {
    require_request_signature: boolEnv(env.ANALYSIS_REQUIRE_REQUEST_SIGNATURE, false),
    require_license_id: boolEnv(env.ANALYSIS_REQUIRE_LICENSE_ID, false),
    rate_limit_per_minute: intEnv(env.ANALYSIS_RATE_LIMIT_PER_MINUTE, 120),
    replay_window_seconds: intEnv(env.ANALYSIS_REPLAY_WINDOW_SECONDS, 300),
  };
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

async function applyAnalysisSecurity(ctx, options) {
  if (boolEnv(ctx.env.ANALYSIS_REQUIRE_LICENSE_ID, false) && !options.license) {
    throwHttp(403, "analysis_license_required");
  }
  await enforceAnalysisRateLimit(ctx.env, options.user);
  await verifyAnalysisRequestSignature(ctx, options);
}

async function enforceAnalysisRateLimit(env, user) {
  if (!env.DB || !user) {
    return;
  }
  const limit = intEnv(env.ANALYSIS_RATE_LIMIT_PER_MINUTE, 120);
  if (!limit || limit < 1) {
    return;
  }
  const now = Date.now();
  const bucketStart = Math.floor(now / 60000) * 60000;
  const key = `analysis:${user.id}:${bucketStart}`;
  const updatedAt = nowIso();
  await env.DB.prepare(
    `INSERT INTO analysis_rate_limits (key, bucket_start, count, updated_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at`
  )
    .bind(key, bucketStart, updatedAt)
    .run();
  const row = await env.DB.prepare("SELECT count FROM analysis_rate_limits WHERE key = ?")
    .bind(key)
    .first();
  if (Number(row && row.count) > limit) {
    throwHttp(429, "analysis_rate_limited");
  }
  if (Math.random() < 0.02) {
    await env.DB.prepare("DELETE FROM analysis_rate_limits WHERE updated_at < ?")
      .bind(new Date(now - 24 * 60 * 60 * 1000).toISOString())
      .run();
  }
}

async function enforcePublicRateLimit(env, options) {
  if (!env.DB || !options) {
    return;
  }
  const limit = Number(options.limit || 0);
  const windowSeconds = Number(options.windowSeconds || 0);
  if (!Number.isFinite(limit) || limit < 1 || !Number.isFinite(windowSeconds) || windowSeconds < 1) {
    return;
  }
  const now = Date.now();
  const bucketMilliseconds = Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000;
  const scope = safeText(options.scope || "public", 64) || "public";
  const subject = safeText(options.subject || "unknown", 256) || "unknown";
  const key = `${scope}:${subject}:${bucketMilliseconds}`;
  const updatedAt = nowIso();
  await env.DB.prepare(
    `INSERT INTO public_rate_limits (key, bucket_start, count, updated_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at`
  )
    .bind(key, bucketMilliseconds, updatedAt)
    .run();
  const row = await env.DB.prepare("SELECT count FROM public_rate_limits WHERE key = ?")
    .bind(key)
    .first();
  if (Number(row && row.count) > limit) {
    throwHttp(429, `${scope}_rate_limited`);
  }
  if (Math.random() < 0.02) {
    await env.DB.prepare("DELETE FROM public_rate_limits WHERE updated_at < ?")
      .bind(new Date(now - 24 * 60 * 60 * 1000).toISOString())
      .run();
  }
}

async function verifyTurnstileToken(env, value, request) {
  const token = safeText(value || "", 4096);
  if (!token) {
    throwHttp(400, "turnstile_token_required");
  }
  const secretKey = String(env.FEEDBACK_TURNSTILE_SECRET || env.TURNSTILE_SECRET_KEY || "").trim();
  if (!secretKey) {
    throwHttp(503, "turnstile_verification_not_configured");
  }
  const form = new FormData();
  form.set("secret", secretKey);
  form.set("response", token);
  const remoteIp = clientIp(request);
  if (remoteIp) {
    form.set("remoteip", remoteIp);
  }
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    throwHttp(502, "turnstile_verification_unavailable");
  }
  const result = await response.json().catch(() => ({}));
  if (!result || result.success !== true) {
    throwHttp(403, "turnstile_verification_failed");
  }
}

async function verifyAnalysisRequestSignature(ctx, options) {
  const requireSignature = boolEnv(ctx.env.ANALYSIS_REQUIRE_REQUEST_SIGNATURE, false);
  const timestamp = String(ctx.request.headers.get("X-Scorpio-Timestamp") || "").trim();
  const nonce = String(ctx.request.headers.get("X-Scorpio-Nonce") || "").trim();
  const signature = normalizeSignature(ctx.request.headers.get("X-Scorpio-Signature") || "");
  const hasAny = Boolean(timestamp || nonce || signature);
  if (!hasAny && !requireSignature) {
    return;
  }
  if (!timestamp || !nonce || !signature) {
    throwHttp(400, "analysis_signature_incomplete");
  }
  const timestampMs = parseSignatureTimestamp(timestamp);
  const windowSeconds = intEnv(ctx.env.ANALYSIS_REPLAY_WINDOW_SECONDS, 300);
  if (!timestampMs || Math.abs(Date.now() - timestampMs) > windowSeconds * 1000) {
    throwHttp(401, "analysis_signature_expired");
  }
  if (!/^[A-Za-z0-9._:-]{12,128}$/.test(nonce)) {
    throwHttp(400, "analysis_nonce_invalid");
  }
  const bearer = bearerToken(ctx.request);
  if (!bearer) {
    throwHttp(401, "authentication_required");
  }
  const method = ctx.request.method.toUpperCase();
  const path = normalizePath(new URL(ctx.request.url).pathname);
  const bodyHash = await sha256Hex(stableJson(options.requestBody || {}));
  const base = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
  const expected = await hmacSha256Hex(bearer, base);
  if (!timingSafeEqual(signature, expected)) {
    throwHttp(401, "analysis_signature_invalid");
  }
  await recordAnalysisNonce(ctx.env, {
    nonce,
    userId: options.user.id,
    requestHash: bodyHash,
    expiresAt: new Date(timestampMs + windowSeconds * 1000).toISOString(),
  });
}

async function recordAnalysisNonce(env, options) {
  try {
    await env.DB.prepare(
      `INSERT INTO analysis_replay_nonces (nonce, user_id, request_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(options.nonce, options.userId, options.requestHash, options.expiresAt, nowIso())
      .run();
  } catch {
    throwHttp(409, "analysis_replay_detected");
  }
  if (Math.random() < 0.02) {
    await env.DB.prepare("DELETE FROM analysis_replay_nonces WHERE expires_at < ?")
      .bind(nowIso())
      .run();
  }
}

function bearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function parseSignatureTimestamp(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return parsed > 1000000000000 ? parsed : parsed * 1000;
}

function normalizeSignature(value) {
  const signature = String(value || "").trim().toLowerCase();
  return signature.startsWith("sha256=") ? signature.slice("sha256=".length) : signature;
}

function stableJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

async function hmacSha256Hex(secretValue, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secretValue || "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(value || "")));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function proxyAnalysisCompute(ctx, options) {
  const baseUrl = String(ctx.env.ANALYSIS_COMPUTE_URL || "").replace(/\/+$/, "");
  const token = String(ctx.env.ANALYSIS_COMPUTE_TOKEN || "");
  const headers = {
    "content-type": "application/json",
    "x-scorpio-user-id": String(options.user.id),
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  let response;
  try {
    response = await fetch(`${baseUrl}${options.endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(options.body),
      signal: AbortSignal.timeout(intEnv(ctx.env.ANALYSIS_COMPUTE_REQUEST_TIMEOUT_MS, 20000)),
    });
  } catch (error) {
    const payload = analysisComputeFetchErrorPayload(error, options.endpoint);
    await recordAnalysisRequest(ctx.env, {
      user: options.user,
      license: options.license,
      endpoint: options.endpoint,
      assetType: options.body.asset_type || "",
      assetCode: options.body.code || "",
      request: options.body,
      clientIp: clientIp(ctx.request),
      status: "compute_unreachable",
      latencyMs: Date.now() - options.startedAt,
    });
    return json(payload, 503);
  }
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  let payload = text;
  if (!contentType.includes("application/json")) {
    payload = JSON.stringify(analysisComputeErrorPayload(response.status, text, options.endpoint));
  }
  await recordAnalysisRequest(ctx.env, {
    user: options.user,
    license: options.license,
    endpoint: options.endpoint,
    assetType: options.body.asset_type || "",
    assetCode: options.body.code || "",
    request: options.body,
    clientIp: clientIp(ctx.request),
    status: response.ok ? "compute_proxy" : "compute_error",
    latencyMs: Date.now() - options.startedAt,
  });
  return new Response(payload, {
    status: response.status,
    headers: JSON_HEADERS,
  });
}

function analysisComputeFetchErrorPayload(error, endpoint) {
  return {
    ok: false,
    error: "analysis_compute_fetch_failed",
    message:
      "实时分析 API 网关已连接，但分析计算服务请求失败。请检查 Analysis Compute 进程、Cloudflare Tunnel 和源站健康状态。",
    detail: safeText(error && error.message ? error.message : String(error), 500),
    source: {
      provider: "scorpio_analysis_api",
      endpoint,
      diagnostic: "analysis_compute_fetch_failed",
      http_status: 503,
    },
  };
}

function analysisComputeErrorPayload(status, rawText, endpoint) {
  const raw = String(rawText || "");
  const cloudflareOriginStatus = [521, 522, 523, 524, 525, 526, 530];
  if (cloudflareOriginStatus.includes(Number(status)) || /Error (521|522|523|524|525|526|530)/.test(raw)) {
    return {
      ok: false,
      error: "analysis_compute_origin_unreachable",
      message:
        "实时分析 API 网关已连接，但分析计算服务上游不可达。请检查 ANALYSIS_COMPUTE_URL、DNS、Cloudflare Tunnel 或源站域名配置。",
      detail: "Cloudflare origin status indicates the proxy cannot resolve or connect to the configured compute origin hostname.",
      source: {
        provider: "scorpio_analysis_api",
        endpoint,
        diagnostic: "cloudflare_origin_hostname_unresolved",
        http_status: Number(status) || 530,
      },
    };
  }
  return {
    ok: false,
    error: "analysis_compute_non_json_response",
    message: "实时分析计算服务返回了非 JSON 响应，请检查计算服务健康状态和代理配置。",
    detail: raw.slice(0, 500),
    source: {
      provider: "scorpio_analysis_api",
      endpoint,
      diagnostic: "compute_non_json_response",
      http_status: Number(status) || 0,
    },
  };
}

async function handleStockAnalysisPost(ctx, options) {
  const startedAt = Date.now();
  const user = await requireUser(ctx);
  const body = await readJson(ctx.request);
  const request = normalizeAnalysisRequest(body, "stock");
  const license = await verifyAnalysisLicense(ctx.env, user, request.license_id);
  await applyAnalysisSecurity(ctx, { user, license, requestBody: body, endpoint: options.endpoint });

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
  await applyAnalysisSecurity(ctx, { user, license, requestBody: request, endpoint: options.endpoint });

  if (analysisComputeConfigured(ctx.env)) {
    return proxyAnalysisCompute(ctx, {
      endpoint: options.endpoint,
      body: { ...request, user_id: user.id, email: user.email },
      user,
      license,
      startedAt,
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
  await applyAnalysisSecurity(ctx, { user, license, requestBody: request, endpoint: options.endpoint });

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
  if (keyBytes.length !== 32) {
    throwHttp(500, "stock_signing_private_key_invalid");
  }
  const data = new TextEncoder().encode(canonicalJson(payload));
  const signature = ed25519.sign(data, keyBytes);
  return `ed25519:${base64UrlEncode(signature)}`;
}

async function signingKeyHealth(env) {
  let keyBytes;
  try {
    const privateKeyText = secret(env, "STOCK_SIGNING_PRIVATE_KEY");
    keyBytes = base64UrlDecode(privateKeyText);
  } catch (error) {
    return {
      ok: false,
      algorithm: "ed25519",
      private_key_valid: false,
      key_length: 0,
      error: error.publicMessage || "stock_signing_private_key_invalid",
    };
  }
  if (keyBytes.length !== 32) {
    return {
      ok: false,
      algorithm: "ed25519",
      private_key_valid: false,
      key_length: keyBytes.length,
      error: "stock_signing_private_key_invalid",
    };
  }
  const publicKey = ed25519.getPublicKey(keyBytes);
  return {
    ok: true,
    algorithm: "ed25519",
    private_key_valid: true,
    public_key_fingerprint: `sha256:${await sha256Hex(base64UrlEncode(publicKey))}`,
  };
}

function adminForceDelete(request) {
  const url = new URL(request.url);
  return url.searchParams.get("force") === "1" && url.searchParams.get("confirm") === "DELETE_TEST_RECORDS";
}

async function linkedLicenseIdsForCustomer(env, customerId) {
  const rows = await env.DB.prepare(
    `SELECT license_id
     FROM licenses
     WHERE activation_code_id IN (SELECT id FROM activation_codes WHERE customer_id = ?)`
  )
    .bind(customerId)
    .all();
  return (rows.results || []).map((row) => row.license_id).filter(Boolean);
}

async function deleteLicenseDependents(env, licenseId) {
  await env.DB.prepare("DELETE FROM validation_logs WHERE license_id = ?").bind(licenseId).run();
  await env.DB.prepare("DELETE FROM usage_reports WHERE license_id = ?").bind(licenseId).run();
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

function canUseActivationCode(user, code) {
  if (!["active", "assigned"].includes(String(code.status || ""))) return false;
  if (code.assigned_to_user_id && Number(code.assigned_to_user_id) !== Number(user.id)) return false;
  if (code.customer_email && normalizeEmail(code.customer_email) !== normalizeEmail(user.email)) return false;
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

async function getDataPackageDetail(ctx) {
  const user = await requireUser(ctx);
  const packageId = safeText(ctx.packageId || "", 128);
  if (!packageId || packageId === "latest") {
    return json({ error: "data_package_id_required" }, 400);
  }
  const request = normalizeDataPackageRequest(ctx.url.searchParams);
  const license = await verifyDataPackageLicense(ctx.env, user, request);
  const row = await ctx.env.DB.prepare(
    `SELECT *
     FROM data_packages
     WHERE package_id = ? AND is_active = 1
     LIMIT 1`
  )
    .bind(packageId)
    .first();
  if (!row) {
    await recordDeviceSyncLog(ctx.env, {
      user,
      license,
      request,
      packageId,
      status: "not_found",
      errorMessage: "data_package_not_found",
      clientIp: clientIp(ctx.request),
    });
    return json({ ok: false, error: "data_package_not_found", package_id: packageId }, 404);
  }
  assertDataPackageEntitlement(row, license, request);
  await recordDeviceSyncLog(ctx.env, {
    user,
    license,
    request,
    packageId,
    status: "detail_checked",
    clientIp: clientIp(ctx.request),
  });
  return json({ ok: true, package: dataPackagePayload(row, ctx.env) });
}

async function updateAdminDataPackage(ctx) {
  requireAdmin(ctx);
  const packageId = safeText(ctx.packageId || "", 128);
  if (!packageId) {
    return json({ error: "data_package_id_required" }, 400);
  }
  const existing = await ctx.env.DB.prepare("SELECT * FROM data_packages WHERE package_id = ?").bind(packageId).first();
  if (!existing) {
    return json({ error: "data_package_not_found" }, 404);
  }
  const body = await readJson(ctx.request);
  const record = normalizeAdminDataPackage({ ...existing, ...body, package_id: packageId });
  await upsertDataPackage(ctx.env, record);
  await audit(ctx.env, "update_data_package", "admin_api", {
    package_id: packageId,
    edition: record.edition,
    channel: record.channel,
    version: record.version,
  });
  return json(record);
}

async function deactivateAdminDataPackage(ctx) {
  requireAdmin(ctx);
  const packageId = safeText(ctx.packageId || "", 128);
  if (!packageId) {
    return json({ error: "data_package_id_required" }, 400);
  }
  await ctx.env.DB.prepare("UPDATE data_packages SET is_active = 0, updated_at = ? WHERE package_id = ?")
    .bind(nowIso(), packageId)
    .run();
  await audit(ctx.env, "deactivate_data_package", "admin_api", { package_id: packageId });
  return json({ deactivated: true, package_id: packageId });
}

async function updateAdminRelease(ctx) {
  requireAdmin(ctx);
  const releaseId = Number(ctx.releaseId || 0);
  if (!releaseId) {
    return json({ error: "release_id_required" }, 400);
  }
  const existing = await ctx.env.DB.prepare("SELECT * FROM release_versions WHERE id = ?").bind(releaseId).first();
  if (!existing) {
    return json({ error: "release_not_found" }, 404);
  }
  const record = normalizeAdminRelease({
    ...existing,
    ...(await readJson(ctx.request)),
    version: existing.version,
    channel: existing.channel,
    edition: existing.edition,
  });
  await ctx.env.DB.prepare(
    `UPDATE release_versions
     SET release_notes = ?,
         download_url = ?,
         hk_download_url = ?,
         r2_key = ?,
         file_name = ?,
         content_type = ?,
         file_hash_sha256 = ?,
         file_size_bytes = ?,
         is_required = ?,
         released_at = ?,
         uploaded_at = ?
     WHERE id = ?`
  )
    .bind(
      record.release_notes,
      record.download_url,
      record.hk_download_url,
      record.r2_key,
      record.file_name,
      record.content_type,
      record.file_hash_sha256,
      record.file_size_bytes,
      record.is_required,
      record.released_at,
      record.uploaded_at,
      releaseId
    )
    .run();
  await audit(ctx.env, "update_release", "admin_api", { id: releaseId, r2_key: record.r2_key });
  return json({ ok: true, id: releaseId, ...record });
}

async function deactivateAdminRelease(ctx) {
  requireAdmin(ctx);
  const releaseId = Number(ctx.releaseId || 0);
  if (!releaseId) {
    return json({ error: "release_id_required" }, 400);
  }
  const existing = await ctx.env.DB.prepare("SELECT * FROM release_versions WHERE id = ?").bind(releaseId).first();
  if (!existing) {
    return json({ error: "release_not_found" }, 404);
  }
  await ctx.env.DB.prepare("UPDATE release_versions SET is_active = 0 WHERE id = ?")
    .bind(releaseId)
    .run();
  await audit(ctx.env, "disable_release", "admin_api", { id: releaseId, version: existing.version });
  return json({ ok: true, id: releaseId });
}

function normalizeDataPackageRequest(params) {
  return {
    license_id: safeText(params.get("license_id") || "", 96),
    machine_fingerprint: safeText(params.get("machine_fingerprint") || params.get("device_id") || "", 160),
    channel: normalizePackageChannel(params.get("channel") || "stable"),
    client_version: safeText(params.get("client_version") || "", 64),
  };
}

function normalizeDataPackageBody(body) {
  return {
    license_id: safeText(body.license_id || "", 96),
    machine_fingerprint: safeText(body.machine_fingerprint || body.device_id || "", 160),
    channel: normalizePackageChannel(body.channel || "stable"),
    client_version: safeText(body.client_version || "", 64),
  };
}

function normalizeDataSyncRequest(params) {
  return {
    ...normalizeDataPackageRequest(params),
    module: normalizeDataSyncModule(params.get("module") || "target_research"),
    since: safeText(params.get("since") || "", 64),
    limit: Math.max(1, positiveInteger(params.get("limit"), 2000, 2000)),
    offset: positiveInteger(params.get("offset"), 0, 10000000),
  };
}

function normalizeDataSyncBody(body) {
  return {
    ...normalizeDataPackageBody(body),
    module: normalizeDataSyncModule(body.module || "target_research"),
  };
}

async function verifyDataPackageLicense(env, user, request) {
  if (!request.license_id) {
    throwHttp(400, "license_id_required");
  }
  if (!request.machine_fingerprint) {
    throwHttp(400, "machine_fingerprint_required");
  }
  const license = await env.DB.prepare(
    `SELECT license_id, edition, machine_fingerprint, machine_fingerprint_history,
            expires_at, is_active, revoked
     FROM licenses
     WHERE user_id = ? AND license_id = ?
     LIMIT 1`
  )
    .bind(user.id, request.license_id)
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
  if (!licenseMachineMatches(license, request.machine_fingerprint)) {
    throwHttp(403, "device_not_bound_to_license");
  }
  license.edition = normalizeEdition(license.edition);
  return license;
}

function licenseMachineMatches(license, machineFingerprint) {
  const current = safeText(license.machine_fingerprint || "", 160);
  if (current && current === machineFingerprint) {
    return true;
  }
  const history = parseJson(license.machine_fingerprint_history || "[]", []);
  return Array.isArray(history) && history.some((item) => {
    if (typeof item === "string") return item === machineFingerprint;
    return safeText(item && item.fingerprint, 160) === machineFingerprint;
  });
}

async function latestDataPackage(env, edition, channel, clientVersion) {
  const now = todayIso();
  const rows = await env.DB.prepare(
    `SELECT *
     FROM data_packages
     WHERE channel = ?
       AND is_active = 1
       AND (edition = ? OR edition = 'all')
       AND (expires_at IS NULL OR expires_at = '' OR expires_at >= ?)
     ORDER BY
       CASE WHEN edition = ? THEN 0 ELSE 1 END,
       published_at DESC,
       id DESC
     LIMIT 20`
  )
    .bind(channel, edition, now, edition)
    .all();
  return (rows.results || []).find((row) => {
    const minimum = safeText(row.min_client_version || "", 64);
    return !minimum || !clientVersion || !versionGreater(minimum, clientVersion);
  }) || null;
}

function assertDataPackageEntitlement(row, license, request) {
  const packageEdition = normalizePackageEdition(row.edition || "all");
  if (packageEdition !== "all" && packageEdition !== license.edition) {
    throwHttp(403, "data_package_edition_not_allowed");
  }
  if (normalizePackageChannel(row.channel || "stable") !== request.channel) {
    throwHttp(403, "data_package_channel_not_allowed");
  }
  if (row.expires_at && row.expires_at < todayIso()) {
    throwHttp(410, "data_package_expired");
  }
  const minimum = safeText(row.min_client_version || "", 64);
  if (minimum && request.client_version && versionGreater(minimum, request.client_version)) {
    throwHttp(426, "client_version_too_old");
  }
}

function dataPackagePayload(row, env) {
  const capabilityScope = parseJson(row.capability_scope || "{}", {});
  const manifestSummary = parseJson(row.manifest_summary || "{}", {});
  return {
    package_id: row.package_id,
    edition: row.edition,
    channel: row.channel,
    version: row.version,
    schema_version: Number(row.schema_version || 1),
    data_date: row.data_date || "",
    valid_from: row.valid_from || "",
    expires_at: row.expires_at || "",
    min_client_version: row.min_client_version || "",
    detail_level: row.detail_level || "",
    download_url: packageDownloadUrl(row, env),
    r2_key: row.r2_key || "",
    sha256: row.sha256 || "",
    signature: row.signature || "",
    size_bytes: Number(row.size_bytes || 0),
    capability_scope: capabilityScope,
    manifest_summary: manifestSummary,
    published_at: row.published_at || "",
  };
}

function packageDownloadUrl(row, env) {
  const direct = safeText(row.download_url || "", 2048);
  if (direct) {
    return direct;
  }
  const base = safeText(env.DATA_PACKAGE_PUBLIC_BASE_URL || "", 2048).replace(/\/+$/, "");
  const key = safeText(row.r2_key || "", 512).replace(/^\/+/, "");
  return base && key ? `${base}/${key}` : "";
}

async function getDataSyncTableRows(ctx) {
  const user = await requireUser(ctx);
  const request = normalizeDataSyncRequest(ctx.url.searchParams);
  const license = await verifyDataPackageLicense(ctx.env, user, request);
  const tableName = safeText(ctx.tableName || "", 96);
  if (!PRODUCTION_UPLOAD_TABLES.has(tableName)) {
    throwHttp(404, "data_sync_table_not_found");
  }
  if (request.module !== "all_publishable" && PRODUCTION_UPLOAD_TABLES.get(tableName) !== request.module) {
    throwHttp(400, "data_sync_table_module_mismatch");
  }

  const scopes = dataSyncEditionScopes(license.edition);
  const scopePlaceholders = scopes.map(() => "?").join(", ");
  const where = [
    "r.table_name = ?",
    `r.edition_scope IN (${scopePlaceholders})`,
    "b.status = 'committed'",
  ];
  const params = [tableName, ...scopes];
  if (request.module !== "all_publishable") {
    where.push("r.module = ?");
    params.push(request.module);
  }
  if (request.since) {
    where.push("r.updated_at > ?");
    params.push(request.since);
  }
  const filter = where.join(" AND ");
  const total = await ctx.env.DB.prepare(
    `SELECT COUNT(*) AS total
     FROM production_table_rows r
     JOIN production_upload_batches b ON b.batch_id = r.batch_id
     WHERE ${filter}`
  ).bind(...params).first();
  const rows = await ctx.env.DB.prepare(
    `SELECT r.table_name, r.row_key, r.row_hash, r.row_json, r.data_date,
            r.edition_scope, r.module, r.batch_id, r.updated_at
     FROM production_table_rows r
     JOIN production_upload_batches b ON b.batch_id = r.batch_id
     WHERE ${filter}
     ORDER BY r.updated_at ASC, r.table_name ASC, r.row_key ASC
     LIMIT ? OFFSET ?`
  ).bind(...params, request.limit, request.offset).all();

  const results = (rows.results || []).map(dataSyncRowPayload);
  return json({
    ok: true,
    table_name: tableName,
    module: request.module,
    edition: license.edition,
    edition_scopes: scopes,
    results,
    page: {
      limit: request.limit,
      offset: request.offset,
      total: numberField(total, "total"),
      has_more: request.offset + results.length < numberField(total, "total"),
    },
  });
}

async function dataSyncManifest(env, license, request) {
  const scopes = dataSyncEditionScopes(license.edition);
  const scopePlaceholders = scopes.map(() => "?").join(", ");
  const where = [`r.edition_scope IN (${scopePlaceholders})`, "b.status = 'committed'"];
  const params = [...scopes];
  if (request.module !== "all_publishable") {
    where.push("r.module = ?");
    params.push(request.module);
  }
  const rows = await env.DB.prepare(
    `SELECT r.table_name, r.module, r.edition_scope,
            COUNT(*) AS row_count,
            MAX(r.data_date) AS data_date,
            MAX(r.batch_id) AS latest_batch_id,
            MAX(r.updated_at) AS updated_at
     FROM production_table_rows r
     JOIN production_upload_batches b ON b.batch_id = r.batch_id
     WHERE ${where.join(" AND ")}
     GROUP BY r.table_name, r.module, r.edition_scope
     ORDER BY r.module ASC, r.table_name ASC, r.edition_scope ASC`
  ).bind(...params).all();
  return {
    module: request.module,
    edition: license.edition,
    edition_scopes: scopes,
    tables: rows.results || [],
    generated_at: nowIso(),
  };
}

async function adminCloudDbOverview(env, url) {
  const tables = await cloudDbTableStats(env, cloudDbQueryOptions(url), { includeEmpty: true });
  const populatedTables = tables.filter((table) => Number(table.row_count || 0) > 0);
  const totalRows = tables.reduce((total, table) => total + Number(table.row_count || 0), 0);
  const totalDataDays = tables.reduce((total, table) => total + Number(table.data_day_count || 0), 0);
  const latestDataDate = maxText(populatedTables.map((table) => table.max_data_date));
  const latestUpdatedAt = maxText(populatedTables.map((table) => table.updated_at));
  const latestUpload = await env.DB.prepare(
    `SELECT batch_id, module, edition_scope, status, table_count, row_count,
            received_row_count, received_chunk_count, error_message,
            created_at, updated_at, committed_at
     FROM production_upload_batches
     ORDER BY created_at DESC
     LIMIT 1`
  ).first();
  const uploadCounts = await env.DB.prepare(
    `SELECT
       COUNT(*) AS batch_count,
       SUM(CASE WHEN status = 'committed' THEN 1 ELSE 0 END) AS committed_count,
       SUM(CASE WHEN status = 'aborted' THEN 1 ELSE 0 END) AS aborted_count,
       SUM(CASE WHEN status NOT IN ('committed', 'aborted') THEN 1 ELSE 0 END) AS open_count
     FROM production_upload_batches`
  ).first();

  return {
    ok: true,
    generated_at: nowIso(),
    allowed_table_count: PRODUCTION_UPLOAD_TABLES.size,
    populated_table_count: populatedTables.length,
    production_row_count: totalRows,
    data_day_total: totalDataDays,
    latest_data_date: latestDataDate,
    latest_updated_at: latestUpdatedAt,
    latest_upload: latestUpload || null,
    upload_counts: compactCounts(uploadCounts, ["batch_count", "committed_count", "aborted_count", "open_count"]),
    warnings: cloudDbWarnings(tables, latestUpload),
  };
}

async function adminCloudDbTables(env, url) {
  const options = cloudDbQueryOptions(url);
  return {
    ok: true,
    generated_at: nowIso(),
    module: options.module,
    edition_scope: options.edition_scope,
    tables: await cloudDbTableStats(env, options, { includeEmpty: true }),
  };
}

async function getAdminCloudDbTableDetail(ctx) {
  requireAdmin(ctx);
  const tableName = safeText(ctx.tableName || "", 96);
  if (!PRODUCTION_UPLOAD_TABLES.has(tableName)) {
    throwHttp(404, "cloud_db_table_not_allowed");
  }
  const options = cloudDbQueryOptions(ctx.url);
  const tableStats = await cloudDbTableStats(ctx.env, { ...options, table_name: tableName }, { includeEmpty: true });
  const stats = aggregateCloudDbTableStats(tableName, tableStats);
  const where = ["r.table_name = ?", "b.status = 'committed'"];
  const params = [tableName];
  addCloudDbFilters(where, params, options);
  const recentJoinFilters = [];
  const recentParams = [tableName];
  if (options.module && options.module !== "all_publishable") {
    recentJoinFilters.push("r.module = ?");
    recentParams.push(options.module);
  }
  if (options.edition_scope) {
    recentJoinFilters.push("r.edition_scope = ?");
    recentParams.push(options.edition_scope);
  }
  const recentBatches = await ctx.env.DB.prepare(
    `SELECT b.batch_id, b.module, b.edition_scope, b.status, b.table_count, b.row_count,
            b.received_row_count, b.received_chunk_count, b.error_message,
            b.created_at, b.updated_at, b.committed_at,
            COUNT(r.row_key) AS table_row_count,
            COUNT(DISTINCT CASE WHEN r.data_date <> '' THEN r.data_date ELSE NULL END) AS table_data_day_count,
            MIN(CASE WHEN r.data_date <> '' THEN r.data_date ELSE NULL END) AS min_data_date,
            MAX(CASE WHEN r.data_date <> '' THEN r.data_date ELSE NULL END) AS max_data_date
     FROM production_upload_batches b
     LEFT JOIN production_table_rows r
       ON r.batch_id = b.batch_id
      AND r.table_name = ?
      ${recentJoinFilters.length ? `AND ${recentJoinFilters.join(" AND ")}` : ""}
     WHERE b.status = 'committed'
     GROUP BY b.batch_id, b.module, b.edition_scope, b.status, b.table_count, b.row_count,
              b.received_row_count, b.received_chunk_count, b.error_message,
              b.created_at, b.updated_at, b.committed_at
     HAVING table_row_count > 0
     ORDER BY b.committed_at DESC, b.updated_at DESC
     LIMIT ?`
  ).bind(
    ...recentParams,
    Math.max(1, Math.min(positiveInteger(ctx.url.searchParams.get("batch_limit"), 20, 100), 100))
  ).all();
  const coverage = await ctx.env.DB.prepare(
    `SELECT r.data_date, COUNT(*) AS row_count, MAX(r.updated_at) AS updated_at
     FROM production_table_rows r
     JOIN production_upload_batches b ON b.batch_id = r.batch_id
     WHERE ${where.join(" AND ")} AND r.data_date <> ''
     GROUP BY r.data_date
     ORDER BY r.data_date DESC
     LIMIT ?`
  ).bind(...params, Math.max(1, Math.min(positiveInteger(ctx.url.searchParams.get("day_limit"), 30, 200), 200))).all();
  return json({
    ok: true,
    generated_at: nowIso(),
    table_name: tableName,
    module: PRODUCTION_UPLOAD_TABLES.get(tableName),
    stats,
    stats_groups: tableStats,
    recent_batches: recentBatches.results || [],
    recent_data_days: coverage.results || [],
  });
}

async function cloudDbTableStats(env, options = {}, behavior = {}) {
  const where = ["b.status = 'committed'"];
  const params = [];
  addCloudDbFilters(where, params, options);
  if (options.table_name) {
    where.push("r.table_name = ?");
    params.push(options.table_name);
  }
  const rows = await env.DB.prepare(
    `SELECT r.table_name, r.module, r.edition_scope,
            COUNT(*) AS row_count,
            COUNT(DISTINCT CASE WHEN r.data_date <> '' THEN r.data_date ELSE NULL END) AS data_day_count,
            MIN(CASE WHEN r.data_date <> '' THEN r.data_date ELSE NULL END) AS min_data_date,
            MAX(CASE WHEN r.data_date <> '' THEN r.data_date ELSE NULL END) AS max_data_date,
            MAX(r.batch_id) AS latest_batch_id,
            MAX(r.updated_at) AS updated_at
     FROM production_table_rows r
     JOIN production_upload_batches b ON b.batch_id = r.batch_id
     WHERE ${where.join(" AND ")}
     GROUP BY r.table_name, r.module, r.edition_scope
     ORDER BY r.module ASC, r.table_name ASC, r.edition_scope ASC`
  ).bind(...params).all();
  const stats = rows.results || [];
  if (!behavior.includeEmpty) {
    return stats;
  }
  const present = new Set(stats.map((row) => `${row.table_name}:${row.edition_scope || ""}`));
  const include = [];
  for (const [tableName, module] of PRODUCTION_UPLOAD_TABLES.entries()) {
    if (options.table_name && tableName !== options.table_name) {
      continue;
    }
    if (options.module !== "all_publishable" && options.module && module !== options.module) {
      continue;
    }
    const key = `${tableName}:${options.edition_scope || ""}`;
    const hasAny = stats.some((row) => row.table_name === tableName);
    if (!hasAny && !present.has(key)) {
      include.push(emptyCloudDbTableStat(tableName, module, options.edition_scope || ""));
    }
  }
  return [...stats, ...include].sort((left, right) => {
    const moduleCompare = String(left.module || "").localeCompare(String(right.module || ""));
    if (moduleCompare) return moduleCompare;
    const tableCompare = String(left.table_name || "").localeCompare(String(right.table_name || ""));
    if (tableCompare) return tableCompare;
    return String(left.edition_scope || "").localeCompare(String(right.edition_scope || ""));
  });
}

function cloudDbQueryOptions(url) {
  return {
    module: normalizeDataSyncModule(url.searchParams.get("module") || "all_publishable"),
    edition_scope: safeCloudDbEditionScope(url.searchParams.get("edition_scope") || ""),
  };
}

function addCloudDbFilters(where, params, options) {
  if (options.module && options.module !== "all_publishable") {
    where.push("r.module = ?");
    params.push(options.module);
  }
  if (options.edition_scope) {
    where.push("r.edition_scope = ?");
    params.push(options.edition_scope);
  }
}

function emptyCloudDbTableStat(tableName, module = "", editionScope = "") {
  return {
    table_name: tableName,
    module: module || PRODUCTION_UPLOAD_TABLES.get(tableName) || "",
    edition_scope: editionScope,
    row_count: 0,
    data_day_count: 0,
    min_data_date: "",
    max_data_date: "",
    latest_batch_id: "",
    updated_at: "",
  };
}

function aggregateCloudDbTableStats(tableName, rows) {
  const activeRows = rows.filter((row) => Number(row.row_count || 0) > 0);
  if (!activeRows.length) {
    return emptyCloudDbTableStat(tableName);
  }
  return {
    table_name: tableName,
    module: PRODUCTION_UPLOAD_TABLES.get(tableName) || "",
    edition_scope: activeRows.length === 1 ? activeRows[0].edition_scope || "" : "mixed",
    row_count: activeRows.reduce((total, row) => total + Number(row.row_count || 0), 0),
    data_day_count: activeRows.reduce((total, row) => total + Number(row.data_day_count || 0), 0),
    min_data_date: minText(activeRows.map((row) => row.min_data_date)),
    max_data_date: maxText(activeRows.map((row) => row.max_data_date)),
    latest_batch_id: maxText(activeRows.map((row) => row.latest_batch_id)),
    updated_at: maxText(activeRows.map((row) => row.updated_at)),
  };
}

function safeCloudDbEditionScope(value) {
  const scope = safeText(value || "", 32).toLowerCase().replaceAll("-", "_");
  return ["standard", "pro", "standard_pro", "internal"].includes(scope) ? scope : "";
}

function cloudDbWarnings(tables, latestUpload) {
  const warnings = [];
  const emptyTables = tables.filter((table) => Number(table.row_count || 0) === 0).map((table) => table.table_name);
  if (emptyTables.length) {
    warnings.push(`empty_tables:${emptyTables.slice(0, 8).join(",")}`);
  }
  const missingDateTables = tables
    .filter((table) => Number(table.row_count || 0) > 0 && Number(table.data_day_count || 0) === 0)
    .map((table) => table.table_name);
  if (missingDateTables.length) {
    warnings.push(`missing_data_date:${missingDateTables.slice(0, 8).join(",")}`);
  }
  if (latestUpload && !["committed", "aborted"].includes(String(latestUpload.status || ""))) {
    warnings.push(`latest_upload_open:${latestUpload.batch_id || ""}`);
  }
  return warnings;
}

function maxText(values) {
  return values.filter(Boolean).reduce((latest, value) => (String(value) > String(latest) ? value : latest), "");
}

function minText(values) {
  return values.filter(Boolean).reduce((earliest, value) => (!earliest || String(value) < String(earliest) ? value : earliest), "");
}

function dataSyncRowPayload(row) {
  return {
    table_name: row.table_name,
    row_key: row.row_key,
    row_hash: row.row_hash,
    row: parseJson(row.row_json || "{}", {}),
    data_date: row.data_date || "",
    edition_scope: row.edition_scope || "",
    module: row.module || "",
    batch_id: row.batch_id || "",
    updated_at: row.updated_at || "",
  };
}

function dataSyncEditionScopes(edition) {
  const normalized = normalizeEdition(edition);
  if (normalized === "personal_standard") {
    return ["standard_pro", "standard"];
  }
  if (normalized === "personal_pro") {
    return ["standard_pro", "standard", "pro"];
  }
  if (["team", "enterprise"].includes(normalized)) {
    return ["standard_pro", "standard", "pro"];
  }
  return ["standard_pro"];
}

async function recordDeviceSyncLog(env, options) {
  await env.DB.prepare(
    `INSERT INTO device_sync_logs
       (license_id, user_id, machine_fingerprint, package_id, edition, channel,
        client_version, status, error_message, client_ip, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      options.license ? options.license.license_id : options.request.license_id,
      options.user ? options.user.id : null,
      options.request.machine_fingerprint || "",
      options.packageId || "",
      options.license ? options.license.edition : "",
      options.request.channel || "stable",
      options.request.client_version || "",
      options.status || "unknown",
      options.errorMessage || "",
      options.clientIp || "",
      nowIso()
    )
    .run();
}

function normalizeAdminDataPackage(body) {
  const packageId = safeText(body.package_id || "", 128);
  const edition = normalizePackageEdition(body.edition || "personal_pro");
  const channel = normalizePackageChannel(body.channel || "stable");
  const version = safeText(body.version || body.data_date || packageId, 80);
  const sha256 = safeText(body.sha256 || body.file_hash_sha256 || "", 128).toLowerCase();
  if (!packageId) {
    throwHttp(400, "package_id_required");
  }
  if (!version) {
    throwHttp(400, "version_required");
  }
  if (!sha256) {
    throwHttp(400, "sha256_required");
  }
  const downloadUrl = safeText(body.download_url || "", 2048);
  if (downloadUrl && !/^https:\/\//i.test(downloadUrl)) {
    throwHttp(400, "download_url_https_required");
  }
  const now = nowIso();
  return {
    package_id: packageId,
    edition,
    channel,
    version,
    schema_version: Math.max(Number(body.schema_version || 1), 1),
    data_date: safeText(body.data_date || "", 32),
    valid_from: safeText(body.valid_from || "", 32),
    expires_at: safeText(body.expires_at || body.valid_until || "", 32),
    min_client_version: safeText(body.min_client_version || "", 64),
    detail_level: normalizeDetailLevel(body.detail_level || (edition === "personal_standard" ? "standard" : "pro")),
    r2_key: safeText(body.r2_key || "", 512),
    download_url: downloadUrl,
    sha256,
    signature: safeText(body.signature || "", 512),
    size_bytes: Math.max(Number(body.size_bytes || body.file_size_bytes || 0), 0),
    capability_scope: JSON.stringify(safeJsonObject(body.capability_scope || body.capabilities || {})),
    manifest_summary: JSON.stringify(safeJsonObject(body.manifest_summary || body.manifest || {})),
    is_active: body.is_active === undefined ? 1 : boolToInt(body.is_active),
    published_at: safeText(body.published_at || body.released_at || now, 64),
    created_at: safeText(body.created_at || now, 64),
    updated_at: now,
  };
}

async function upsertDataPackage(env, record) {
  await env.DB.prepare(
    `INSERT INTO data_packages
       (package_id, edition, channel, version, schema_version, data_date, valid_from,
        expires_at, min_client_version, detail_level, r2_key, download_url, sha256,
        signature, size_bytes, capability_scope, manifest_summary, is_active,
        published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(package_id) DO UPDATE SET
       edition = excluded.edition,
       channel = excluded.channel,
       version = excluded.version,
       schema_version = excluded.schema_version,
       data_date = excluded.data_date,
       valid_from = excluded.valid_from,
       expires_at = excluded.expires_at,
       min_client_version = excluded.min_client_version,
       detail_level = excluded.detail_level,
       r2_key = excluded.r2_key,
       download_url = excluded.download_url,
       sha256 = excluded.sha256,
       signature = excluded.signature,
       size_bytes = excluded.size_bytes,
       capability_scope = excluded.capability_scope,
       manifest_summary = excluded.manifest_summary,
       is_active = excluded.is_active,
       published_at = excluded.published_at,
       updated_at = excluded.updated_at`
  )
    .bind(
      record.package_id,
      record.edition,
      record.channel,
      record.version,
      record.schema_version,
      record.data_date,
      record.valid_from,
      record.expires_at,
      record.min_client_version,
      record.detail_level,
      record.r2_key,
      record.download_url,
      record.sha256,
      record.signature,
      record.size_bytes,
      record.capability_scope,
      record.manifest_summary,
      record.is_active,
      record.published_at,
      record.created_at,
      record.updated_at
    )
    .run();
}

const PRODUCTION_UPLOAD_TABLES = new Map([
  ["score_history", "target_research"],
  ["stock_analysis_pool", "target_research"],
  ["stock_info", "target_research"],
  ["industry_info", "target_research"],
  ["stock_daily_latest", "market_context"],
  ["stock_daily_ohlcv", "market_context"],
  ["stock_financial_metrics", "market_context"],
  ["stock_risk_metrics", "market_context"],
  ["sector_rotation_daily", "market_context"],
  ["market_fund_flow_cache", "market_context"],
  ["industry_fund_flow_cache", "market_context"],
  ["market_sentiment_daily", "market_context"],
]);

function normalizeProductionUploadBatch(body) {
  const now = nowIso();
  const batchId = safeText(body.batch_id || `pu_${Date.now()}_${timeCompact()}`, 96);
  const module = normalizeProductionUploadModule(body.module || "all_publishable");
  const editionScope = normalizeProductionEditionScope(body.edition_scope || "standard_pro");
  const rowCount = Math.max(Number(body.row_count || 0), 0);
  const tableCount = Math.max(Number(body.table_count || 0), 0);
  return {
    batch_id: batchId,
    module,
    source: safeText(body.source || "self_use_production", 64),
    mode: safeText(body.mode || "module", 32),
    edition_scope: editionScope,
    status: "created",
    table_count: tableCount,
    row_count: rowCount,
    received_row_count: 0,
    received_chunk_count: 0,
    manifest_json: JSON.stringify(safeJsonObject(body.manifest || {})),
    manifest_hash: safeText(body.manifest_hash || "", 128),
    error_message: "",
    created_at: now,
    updated_at: now,
    committed_at: "",
  };
}

async function insertProductionUploadBatch(env, record) {
  await env.DB.prepare(
    `INSERT INTO production_upload_batches
       (batch_id, module, source, mode, edition_scope, status, table_count, row_count,
        received_row_count, received_chunk_count, manifest_json, manifest_hash,
        error_message, created_at, updated_at, committed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(batch_id) DO UPDATE SET
       module = excluded.module,
       source = excluded.source,
       mode = excluded.mode,
       edition_scope = excluded.edition_scope,
       status = excluded.status,
       table_count = excluded.table_count,
       row_count = excluded.row_count,
       received_row_count = excluded.received_row_count,
       received_chunk_count = excluded.received_chunk_count,
       manifest_json = excluded.manifest_json,
       manifest_hash = excluded.manifest_hash,
       error_message = excluded.error_message,
       created_at = excluded.created_at,
       committed_at = excluded.committed_at,
       updated_at = excluded.updated_at`
  ).bind(
    record.batch_id,
    record.module,
    record.source,
    record.mode,
    record.edition_scope,
    record.status,
    record.table_count,
    record.row_count,
    record.received_row_count,
    record.received_chunk_count,
    record.manifest_json,
    record.manifest_hash,
    record.error_message,
    record.created_at,
    record.updated_at,
    record.committed_at
  ).run();
}

async function listProductionUploadChunks(env, batchId) {
  const rows = await env.DB.prepare(
    `SELECT table_name, chunk_index, row_count, chunk_hash, created_at
     FROM production_upload_chunks
     WHERE batch_id = ?
     ORDER BY table_name ASC, chunk_index ASC`
  ).bind(batchId).all();
  return rows.results || [];
}

function normalizeProductionUploadChunk(body) {
  const batchId = safeText(body.batch_id || "", 96);
  const tableName = safeText(body.table_name || "", 96);
  if (!batchId) {
    throwHttp(400, "production_upload_batch_id_required");
  }
  if (!PRODUCTION_UPLOAD_TABLES.has(tableName)) {
    throwHttp(400, "production_upload_table_not_allowed");
  }
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) {
    throwHttp(400, "production_upload_rows_required");
  }
  if (rows.length > 500) {
    throwHttp(413, "production_upload_chunk_too_large");
  }
  return {
    batch_id: batchId,
    table_name: tableName,
    module: normalizeProductionUploadModule(body.module || PRODUCTION_UPLOAD_TABLES.get(tableName)),
    mode: normalizeProductionUploadMode(body.mode || "incremental_upsert"),
    edition_scope: normalizeProductionEditionScope(body.edition_scope || "standard_pro"),
    chunk_index: Math.max(Number(body.chunk_index || 1), 1),
    chunk_hash: safeText(body.chunk_hash || "", 128),
    rows: rows.map(normalizeProductionUploadRow),
  };
}

function normalizeProductionUploadRow(row) {
  const payload = row && typeof row === "object" ? row : {};
  const rowKey = safeText(payload.row_key || "", 128);
  const rowHash = safeText(payload.row_hash || "", 128);
  const dataDate = safeText(payload.data_date || "", 32);
  const data = payload.row && typeof payload.row === "object" && !Array.isArray(payload.row) ? payload.row : {};
  if (!rowKey || !rowHash) {
    throwHttp(400, "production_upload_row_key_required");
  }
  return {
    row_key: rowKey,
    row_hash: rowHash,
    data_date: dataDate,
    row_json: JSON.stringify(data),
  };
}

async function storeProductionUploadChunk(env, chunk) {
  const now = nowIso();
  const statements = [
    env.DB.prepare(
    `INSERT INTO production_upload_chunks
       (batch_id, table_name, chunk_index, row_count, chunk_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(batch_id, table_name, chunk_index) DO UPDATE SET
       row_count = excluded.row_count,
       chunk_hash = excluded.chunk_hash,
       created_at = excluded.created_at`
    ).bind(chunk.batch_id, chunk.table_name, chunk.chunk_index, chunk.rows.length, chunk.chunk_hash, now),
  ];

  for (const row of chunk.rows) {
    statements.push(env.DB.prepare(
      `INSERT INTO production_upload_staging_rows
         (batch_id, table_name, row_key, row_hash, row_json, data_date, edition_scope, module, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(batch_id, table_name, row_key, edition_scope) DO UPDATE SET
         row_hash = excluded.row_hash,
         row_json = excluded.row_json,
         data_date = excluded.data_date,
       module = excluded.module,
       updated_at = excluded.updated_at`
    ).bind(
      chunk.batch_id,
      chunk.table_name,
      row.row_key,
      row.row_hash,
      row.row_json,
      row.data_date,
      chunk.edition_scope,
      chunk.module,
      now
    ));
  }
  statements.push(env.DB.prepare(
    `UPDATE production_upload_batches
     SET status = 'receiving',
         received_row_count = received_row_count + ?,
         received_chunk_count = received_chunk_count + 1,
         updated_at = ?
     WHERE batch_id = ?`
  ).bind(chunk.rows.length, now, chunk.batch_id));
  await env.DB.batch(statements);
}

async function commitProductionUploadBatch(env, batch, batchId) {
  const fullReplaceTables = productionUploadFullReplaceTables(batch.manifest_json);
  for (const tableName of fullReplaceTables) {
    await env.DB.prepare(
      "DELETE FROM production_table_rows WHERE table_name = ? AND edition_scope = ?"
    ).bind(tableName, batch.edition_scope).run();
  }
  await env.DB.prepare(
    `INSERT OR REPLACE INTO production_table_rows
       (table_name, row_key, row_hash, row_json, data_date, edition_scope, module, batch_id, updated_at)
     SELECT table_name, row_key, row_hash, row_json, data_date, edition_scope, module, batch_id, updated_at
       FROM production_upload_staging_rows
      WHERE batch_id = ?`
  ).bind(batchId).run();
  await env.DB.prepare("DELETE FROM production_upload_staging_rows WHERE batch_id = ?").bind(batchId).run();
}

async function rollbackProductionUploadBatch(env, batchId, reason = "") {
  const now = nowIso();
  await env.DB.prepare("DELETE FROM production_upload_staging_rows WHERE batch_id = ?").bind(batchId).run();
  await env.DB.prepare(
    `UPDATE production_upload_batches
     SET status = 'aborted',
         error_message = ?,
         updated_at = ?
     WHERE batch_id = ? AND status <> 'committed'`
  ).bind(safeText(reason || "rollback_requested", 500), now, batchId).run();
}

function productionUploadFullReplaceTables(manifestJson) {
  const manifest = safeJsonObject(manifestJson);
  const tables = Array.isArray(manifest.tables) ? manifest.tables : [];
  return tables
    .filter((table) => safeText(table && table.mode, 32) === "full_replace")
    .map((table) => safeText(table && table.table_name, 96))
    .filter((tableName) => PRODUCTION_UPLOAD_TABLES.has(tableName));
}

function normalizeProductionUploadModule(value) {
  const module = safeText(value || "all_publishable", 64).toLowerCase().replaceAll("-", "_");
  return ["target_research", "market_context", "strategy_research", "all_publishable"].includes(module)
    ? module
    : "all_publishable";
}

function normalizeDataSyncModule(value) {
  const module = safeText(value || "target_research", 64).toLowerCase().replaceAll("-", "_");
  return ["target_research", "market_context", "all_publishable"].includes(module) ? module : "target_research";
}

function normalizeProductionUploadMode(value) {
  const mode = safeText(value || "incremental_upsert", 32).toLowerCase().replaceAll("-", "_");
  return ["incremental_upsert", "full_replace"].includes(mode) ? mode : "incremental_upsert";
}

function normalizeProductionEditionScope(value) {
  const scope = safeText(value || "standard_pro", 32).toLowerCase().replaceAll("-", "_");
  return ["standard", "pro", "standard_pro", "internal"].includes(scope) ? scope : "standard_pro";
}

function normalizePackageChannel(value) {
  const channel = safeText(value || "stable", 32).toLowerCase().replaceAll("_", "-");
  return ["stable", "beta", "canary", "internal"].includes(channel) ? channel : "stable";
}

function normalizePackageEdition(value) {
  const edition = safeText(value || "personal_pro", 64).toLowerCase().replaceAll("-", "_");
  if (edition === "all") {
    return "all";
  }
  if (["personal_standard", "personal_pro", "team", "enterprise"].includes(edition)) {
    return edition;
  }
  throwHttp(400, "data_package_edition_invalid");
}

function normalizeDetailLevel(value) {
  const detail = safeText(value || "", 32).toLowerCase().replaceAll("-", "_");
  return ["standard", "pro", "team", "enterprise"].includes(detail) ? detail : "";
}

function normalizeSyncStatus(value) {
  const status = safeText(value || "client_reported", 48).toLowerCase().replaceAll("-", "_");
  return [
    "catalog_checked",
    "detail_checked",
    "download_started",
    "downloaded",
    "hash_verified",
    "signature_verified",
    "imported",
    "failed",
    "not_found",
    "client_reported",
  ].includes(status) ? status : "client_reported";
}

function safeJsonObject(value) {
  if (!value) {
    return {};
  }
  if (typeof value === "string") {
    const parsed = parseJson(value, {});
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  }
  return typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function downloadReleaseFile(ctx) {
  const user = await requireUser(ctx);
  const releaseId = Number(ctx.releaseId || 0);
  if (!releaseId) return json({ error: "release_id_required" }, 400);
  const row = await ctx.env.DB.prepare("SELECT * FROM release_versions WHERE id = ? AND COALESCE(is_active, 1) = 1")
    .bind(releaseId)
    .first();
  if (!row) return json({ error: "release_not_found" }, 404);
  const entitlement = await requireReleaseEntitlement(ctx.env, user, row.edition);

  const hkDownloadUrl = safeText(row.hk_download_url || "", 2048);
  if (boolEnv(ctx.env.ALIYUN_CDN_DOWNLOAD_ENABLED, false) && isMainlandChinaRequest(ctx.request) && /^https:\/\//i.test(hkDownloadUrl)) {
    const signedUrl = signAliyunCdnDownloadUrl(ctx.env, hkDownloadUrl);
    if (signedUrl) {
      recordReleaseDownload(ctx.env, ctx.request, { row, user, entitlement, source: "aliyun_hk_cdn" }).catch(() => {});
      return Response.redirect(signedUrl, 302);
    }
  }

  const r2Key = safeText(row.r2_key || "", 512);
  if (r2Key) {
    if (!ctx.env.RELEASE_BUCKET) return json({ error: "release_bucket_not_configured" }, 500);
    const object = await ctx.env.RELEASE_BUCKET.get(r2Key);
    if (!object) return json({ error: "release_object_not_found" }, 404);
    const fileName = safeDownloadFileName(row.file_name || fileNameFromKey(r2Key) || `scorpio-${row.edition}-${row.version}.bin`);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-type", row.content_type || headers.get("content-type") || "application/octet-stream");
    headers.set("content-disposition", `attachment; filename="${fileName}"`);
    headers.set("cache-control", "private, no-store");
    headers.set("x-scorpio-release-version", row.version);
    headers.set("x-scorpio-release-edition", row.edition);
    if (row.file_hash_sha256) headers.set("x-scorpio-sha256", row.file_hash_sha256);
    recordReleaseDownload(ctx.env, ctx.request, { row, user, entitlement }).catch(() => {});
    return new Response(object.body, { headers });
  }

  const downloadUrl = safeText(row.download_url || "", 2048);
  if (/^https:\/\//i.test(downloadUrl)) {
    recordReleaseDownload(ctx.env, ctx.request, { row, user, entitlement, source: "release_redirect" }).catch(() => {});
    return Response.redirect(downloadUrl, 302);
  }
  return json({ error: "release_download_not_configured" }, 404);
}

function isMainlandChinaRequest(request) {
  return String(request.headers.get("CF-IPCountry") || "").trim().toUpperCase() === "CN";
}

function signAliyunCdnDownloadUrl(env, rawUrl) {
  const key = safeText(env.ALIYUN_CDN_AUTH_KEY || "", 128);
  const configuredHost = safeText(env.ALIYUN_CDN_DOWNLOAD_HOST || "", 255).toLowerCase();
  if (!key || !configuredHost) return "";

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== configuredHost || url.search || url.hash) {
    return "";
  }

  const timestamp = Math.floor(Date.now() / 1000).toString(16);
  const signature = md5Hex(`${key}${url.pathname}${timestamp}`);
  url.searchParams.set("sign", signature);
  url.searchParams.set("time", timestamp);
  return url.toString();
}

function md5Hex(value) {
  const source = new TextEncoder().encode(String(value));
  const paddedSize = (((source.length + 8) >>> 6) + 1) << 6;
  const data = new Uint8Array(paddedSize);
  data.set(source);
  data[source.length] = 0x80;
  const bitLength = source.length * 8;
  for (let index = 0; index < 8; index += 1) {
    data[paddedSize - 8 + index] = Math.floor(bitLength / (2 ** (8 * index))) & 0xff;
  }

  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const constants = Array.from({ length: 64 }, (_, index) => (
    Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0
  ));
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < data.length; offset += 64) {
    const words = Array.from({ length: 16 }, (_, index) => {
      const base = offset + index * 4;
      return (data[base] | (data[base + 1] << 8) | (data[base + 2] << 16) | (data[base + 3] << 24)) >>> 0;
    });
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let index = 0; index < 64; index += 1) {
      let f;
      let g;
      if (index < 16) {
        f = (b & c) | (~b & d);
        g = index;
      } else if (index < 32) {
        f = (d & b) | (~d & c);
        g = (5 * index + 1) % 16;
      } else if (index < 48) {
        f = b ^ c ^ d;
        g = (3 * index + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * index) % 16;
      }
      const next = d;
      d = c;
      c = b;
      b = addUint32(b, rotateLeft(addUint32(a, f, constants[index], words[g]), shifts[index]));
      a = next;
    }
    a0 = addUint32(a0, a);
    b0 = addUint32(b0, b);
    c0 = addUint32(c0, c);
    d0 = addUint32(d0, d);
  }
  return [a0, b0, c0, d0].map(uint32ToLittleEndianHex).join("");
}

function addUint32(...values) {
  return values.reduce((total, value) => (total + value) >>> 0, 0);
}

function rotateLeft(value, count) {
  return ((value << count) | (value >>> (32 - count))) >>> 0;
}

function uint32ToLittleEndianHex(value) {
  return [0, 8, 16, 24]
    .map((shift) => ((value >>> shift) & 0xff).toString(16).padStart(2, "0"))
    .join("");
}

async function servePublicProductVideo({ request, env }) {
  if (!env.RELEASE_BUCKET) {
    return json({ error: "release_bucket_not_configured" }, 500);
  }

  const key = safeText(
    env.PUBLIC_PRODUCT_VIDEO_R2_KEY || DEFAULT_PUBLIC_PRODUCT_VIDEO_R2_KEY,
    1024
  );
  const metadata = await env.RELEASE_BUCKET.head(key);
  if (!metadata) {
    return json({ error: "product_video_not_found" }, 404);
  }

  const size = Number(metadata.size || 0);
  const headers = new Headers();
  headers.set("content-type", metadata.httpMetadata?.contentType || "video/mp4");
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", `public, max-age=${positiveInteger(env.PUBLIC_PRODUCT_VIDEO_CACHE_SECONDS, 86400, 31536000)}`);
  headers.set("content-disposition", 'inline; filename="Scorpio_Intelligence_Product_Introduction.mp4"');
  headers.set("x-content-type-options", "nosniff");
  if (metadata.httpEtag) headers.set("etag", metadata.httpEtag);
  if (metadata.uploaded instanceof Date) headers.set("last-modified", metadata.uploaded.toUTCString());

  let status = 200;
  let object = null;
  const rangeHeader = request.headers.get("Range");
  if (rangeHeader && size > 0) {
    const range = parseSingleByteRange(rangeHeader, size);
    if (!range) {
      headers.set("content-range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    object = await env.RELEASE_BUCKET.get(key, {
      range: { offset: range.start, length: range.end - range.start + 1 },
    });
    if (!object) return json({ error: "product_video_not_found" }, 404);
    status = 206;
    headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
    headers.set("content-length", String(range.end - range.start + 1));
  } else {
    headers.set("content-length", String(size));
    if (request.method === "GET") {
      object = await env.RELEASE_BUCKET.get(key);
      if (!object) return json({ error: "product_video_not_found" }, 404);
    }
  }

  return new Response(request.method === "HEAD" ? null : object?.body, { status, headers });
}

function parseSingleByteRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(value || "").trim());
  if (!match || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(size - suffixLength, 0), end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) {
    return null;
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

async function recordReleaseDownload(env, request, options) {
  const row = options.row || {};
  const user = options.user || null;
  const entitlement = options.entitlement || {};
  const now = nowIso();
  const date = now.slice(0, 10);
  const releaseId = Number(row.id || 0);
  if (!releaseId) return;
  const uaHash = await sha256Hex(request.headers.get("user-agent") || "");
  const ipHash = await sha256Hex(`${clientIp(request)}:${secret(env, "JWT_SECRET")}`);
  const eventId = `dl_${Date.now().toString(36)}_${randomToken(8)}`;
  const fileName = safeDownloadFileName(row.file_name || fileNameFromKey(row.r2_key || row.download_url || ""));
  await env.DB.batch([
    env.DB.prepare("UPDATE release_versions SET download_count = COALESCE(download_count, 0) + 1 WHERE id = ?")
      .bind(releaseId),
    env.DB.prepare(
      `INSERT INTO release_download_events
       (event_id, event_date, release_id, version, channel, edition, file_name,
        user_id, license_id, client_ip_hash, user_agent_hash, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      eventId,
      date,
      releaseId,
      safeText(row.version || "", 80),
      safeText(row.channel || "", 32),
      safeText(row.edition || "", 64),
      fileName,
      user ? user.id : null,
      safeText(entitlement.license_id || "", 128),
      ipHash,
      uaHash,
      safeText(options.source || "release_download", 64),
      now
    ),
    env.DB.prepare(
      `INSERT INTO release_download_daily
       (event_date, release_id, version, channel, edition, file_name, download_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(event_date, release_id) DO UPDATE SET
         version = excluded.version,
         channel = excluded.channel,
         edition = excluded.edition,
         file_name = excluded.file_name,
         download_count = download_count + 1,
         updated_at = excluded.updated_at`
    ).bind(
      date,
      releaseId,
      safeText(row.version || "", 80),
      safeText(row.channel || "", 32),
      safeText(row.edition || "", 64),
      fileName,
      now
    ),
  ]);
}

async function recordSiteVisit(env, request, body) {
  const now = nowIso();
  const date = now.slice(0, 10);
  const pagePath = normalizeAnalyticsPath(body.page_path || body.path || "/");
  const pageTitle = safeText(body.page_title || body.title || "", 180);
  const language = safeText(body.language || body.lang || "", 32);
  const referrerHost = safeReferrerHost(body.referrer || "");
  const ua = request.headers.get("user-agent") || "";
  const visitorSource = [
    clientIp(request),
    ua,
    safeText(body.screen || "", 64),
    safeText(body.timezone || "", 64),
  ].join("|");
  const visitorHash = await sha256Hex(`${visitorSource}:${secret(env, "JWT_SECRET")}`);
  const uaHash = await sha256Hex(ua);
  const eventId = safeText(body.event_id || "", 80) || `visit_${Date.now().toString(36)}_${randomToken(8)}`;

  await env.DB.prepare(
    `INSERT OR IGNORE INTO site_visit_events
     (event_id, event_date, page_path, page_title, language, referrer_host,
      visitor_hash, user_agent_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(eventId, date, pagePath, pageTitle, language, referrerHost, visitorHash, uaHash, now).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO site_unique_visitors
     (event_date, page_path, visitor_hash, first_seen_at)
     VALUES (?, ?, ?, ?)`
  ).bind(date, pagePath, visitorHash, now).run();
  const unique = await env.DB.prepare(
    `SELECT COUNT(*) AS total
     FROM site_unique_visitors
     WHERE event_date = ? AND page_path = ?`
  ).bind(date, pagePath).first();
  await env.DB.prepare(
    `INSERT INTO site_page_daily
     (event_date, page_path, language, page_title, referrer_host, visit_count, unique_visitor_count, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(event_date, page_path) DO UPDATE SET
       language = excluded.language,
       page_title = excluded.page_title,
       referrer_host = excluded.referrer_host,
       visit_count = visit_count + 1,
       unique_visitor_count = excluded.unique_visitor_count,
       updated_at = excluded.updated_at`
  ).bind(date, pagePath, language, pageTitle, referrerHost, numberField(unique, "total"), now).run();
  return { ok: true };
}

function normalizeAnalyticsPath(value) {
  const path = safeText(value || "/", 240).split("?")[0].split("#")[0] || "/";
  if (!path.startsWith("/")) return `/${path}`;
  return path;
}

function safeReferrerHost(value) {
  const text = safeText(value || "", 512);
  if (!text) return "";
  try {
    return safeText(new URL(text).host, 120);
  } catch {
    return "";
  }
}

async function requireReleaseEntitlement(env, user, edition) {
  const normalized = normalizeEdition(edition || "personal_pro");
  if (normalized === "all") return true;
  const license = await env.DB.prepare(
    `SELECT id, license_id FROM licenses
     WHERE user_id = ? AND edition = ? AND is_active = 1 AND revoked = 0
       AND datetime(expires_at) >= datetime('now')
     LIMIT 1`
  )
    .bind(user.id, normalized)
    .first();
  if (license) return license;
  const code = await env.DB.prepare(
    `SELECT id FROM activation_codes
     WHERE assigned_to_user_id = ? AND edition = ? AND status IN ('active', 'assigned', 'used')
     LIMIT 1`
  )
    .bind(user.id, normalized)
    .first();
  if (code) return { activation_code_id: code.id };
  throwHttp(403, "release_entitlement_required");
}

function normalizeAdminRelease(body) {
  const version = safeText(body.version || "", 80).replace(/^v/i, "");
  const channel = normalizePackageChannel(body.channel || "stable");
  const edition = normalizeEdition(body.edition || "personal_pro");
  const downloadUrl = safeText(body.download_url || "", 2048);
  const hkDownloadUrl = safeText(body.hk_download_url || "", 2048);
  const r2Key = normalizeR2Key(body.r2_key || "");
  const fileName = safeDownloadFileName(body.file_name || fileNameFromKey(r2Key || downloadUrl || hkDownloadUrl));
  const contentType = safeText(body.content_type || "application/octet-stream", 120) || "application/octet-stream";
  const sha256 = safeText(body.file_hash_sha256 || body.sha256 || "", 128).toLowerCase();
  if (!version) throwHttp(400, "version_required");
  if (!r2Key && !/^https:\/\//i.test(downloadUrl) && !/^https:\/\//i.test(hkDownloadUrl)) throwHttp(400, "release_download_source_required");
  if (downloadUrl && !/^https:\/\//i.test(downloadUrl)) throwHttp(400, "download_url_https_required");
  if (hkDownloadUrl && !/^https:\/\//i.test(hkDownloadUrl)) throwHttp(400, "hk_download_url_https_required");
  if (sha256 && !/^[a-f0-9]{64}$/i.test(sha256)) throwHttp(400, "sha256_invalid");
  return {
    version,
    channel,
    edition,
    release_notes: safeText(body.release_notes || "", 4000),
    download_url: downloadUrl,
    hk_download_url: hkDownloadUrl,
    r2_key: r2Key,
    file_name: fileName,
    content_type: contentType,
    file_hash_sha256: sha256,
    file_size_bytes: Math.max(Number(body.file_size_bytes || 0), 0),
    is_required: body.is_required ? 1 : 0,
    is_active: body.is_active === undefined ? 1 : (body.is_active ? 1 : 0),
    released_at: safeText(body.released_at || "", 64) || nowIso(),
    uploaded_at: safeText(body.uploaded_at || "", 64) || (r2Key ? nowIso() : ""),
  };
}

async function upsertRelease(env, record) {
  await env.DB.prepare(
    `INSERT INTO release_versions
       (version, channel, edition, release_notes, download_url, hk_download_url, r2_key, file_name,
        content_type, file_hash_sha256, file_size_bytes, is_required, is_active,
        released_at, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(version, channel, edition) DO UPDATE SET
       release_notes = excluded.release_notes,
       download_url = excluded.download_url,
       hk_download_url = excluded.hk_download_url,
       r2_key = excluded.r2_key,
       file_name = excluded.file_name,
       content_type = excluded.content_type,
       file_hash_sha256 = excluded.file_hash_sha256,
       file_size_bytes = excluded.file_size_bytes,
       is_required = excluded.is_required,
       is_active = excluded.is_active,
       released_at = excluded.released_at,
       uploaded_at = excluded.uploaded_at`
  )
    .bind(
      record.version,
      record.channel,
      record.edition,
      record.release_notes,
      record.download_url,
      record.hk_download_url,
      record.r2_key,
      record.file_name,
      record.content_type,
      record.file_hash_sha256,
      record.file_size_bytes,
      record.is_required,
      record.is_active,
      record.released_at,
      record.uploaded_at
    )
    .run();
}

async function latestRelease(env, edition, channel) {
  return env.DB.prepare(
    `SELECT * FROM release_versions
     WHERE channel = ? AND (edition = ? OR edition = 'all') AND COALESCE(is_active, 1) = 1
     ORDER BY released_at DESC
     LIMIT 1`
  )
    .bind(channel, edition)
    .first();
}

function normalizeR2Key(value) {
  const key = safeText(value || "", 512).replace(/^r2:\/\//i, "").replace(/^\/+/, "");
  if (key.includes("..") || key.includes("\\") || key.startsWith(".")) {
    throwHttp(400, "r2_key_invalid");
  }
  return key;
}

function fileNameFromKey(value) {
  const text = String(value || "").split("?")[0].replace(/\\/g, "/");
  return text.split("/").filter(Boolean).pop() || "";
}

function safeDownloadFileName(value) {
  const name = safeText(value || "", 180).replace(/[\\/:*?"<>|]/g, "_").trim();
  return name || "scorpio-release.bin";
}

function releasePayload(row) {
  const downloadEndpoint = row.id ? `/v1/releases/download/${row.id}` : "";
  return {
    id: row.id || null,
    latest_version: row.version,
    version: row.version,
    channel: row.channel,
    edition: row.edition,
    release_date: row.released_at,
    release_notes: row.release_notes || "",
    download_url: row.r2_key ? "" : (row.download_url || ""),
    download_endpoint: downloadEndpoint,
    download_available: Boolean(row.r2_key || row.download_url || row.hk_download_url),
    file_name: row.file_name || fileNameFromKey(row.r2_key || row.download_url || row.hk_download_url || ""),
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

  const purposeCopy = options.purpose === "reset_password"
    ? { subject: "Scorpio Intelligence 密码重置验证码", action: "重置密码" }
    : options.purpose === "feedback"
      ? { subject: "Scorpio Intelligence 反馈提交验证码", action: "提交反馈" }
      : { subject: "Scorpio Intelligence 注册验证码", action: "完成注册" };
  const text = [
    `你的 Scorpio Intelligence ${purposeCopy.action}验证码是：${options.code}`,
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
      subject: purposeCopy.subject,
      text,
    }),
  });

  if (!response.ok) {
    throwHttp(502, "email_delivery_failed");
  }
}

function normalizeVerificationPurpose(value) {
  const purpose = String(value || "").trim().toLowerCase();
  if (purpose === "register" || purpose === "reset_password" || purpose === "feedback") {
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

function hasFeedbackHoneypotValue(body) {
  return Boolean(safeText(body.company_website || body.website || "", 500));
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

function boolEnv(value, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(normalized);
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
