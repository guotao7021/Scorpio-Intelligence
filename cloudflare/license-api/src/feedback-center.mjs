import {imageSize} from "image-size";

export const UPLOAD_LIMITS = Object.freeze({count: 3, file: 5 * 1024 * 1024, request: 16 * 1024 * 1024});
const STATUSES = ["new", "triaged", "in_progress", "resolved", "closed"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const TYPES = ["bug", "experience", "question", "survey"];
const USER_FIELDS = "f.id,f.public_id,f.type,f.product_area,f.priority,f.status,f.title,f.description,f.client_version,f.environment,f.survey_answers,f.public_reply,f.created_at,f.updated_at";
const COUNT_FILES = "(SELECT COUNT(*) FROM feedback_attachments a WHERE a.feedback_id=f.id) AS attachment_count";
function fail(status, code) { const error = new Error(code); error.status = status; error.publicMessage = code; throw error; }

async function boundedBody(request, max) {
  const declared = Number(request.headers.get("content-length"));
  if (declared > max) fail(413, "feedback_payload_too_large");
  const reader = request.body?.getReader(); if (!reader) return new Uint8Array();
  const chunks = []; let size = 0;
  try {
    while (true) { const {done, value} = await reader.read(); if (done) break; size += value.byteLength; if (size > max) { await reader.cancel(); fail(413, "feedback_payload_too_large"); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}

export async function readFeedback(request) {
  const multipart = (request.headers.get("content-type") || "").startsWith("multipart/form-data;");
  const bytes = await boundedBody(request, multipart ? UPLOAD_LIMITS.request : 16 * 1024);
  let body, files = [];
  try {
    if (multipart) {
      const data = await new Response(bytes, {headers: {"content-type": request.headers.get("content-type")}}).formData();
      const payload = data.get("payload");
      if (typeof payload !== "string" || new TextEncoder().encode(payload).length > 16 * 1024 || data.getAll("payload").length !== 1) fail(400, "feedback_payload_invalid");
      if ([...data.keys()].some((key) => !["payload", "attachments"].includes(key))) fail(400, "feedback_payload_invalid");
      body = JSON.parse(payload); files = data.getAll("attachments");
    } else body = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) { if (error.publicMessage) throw error; fail(400, "feedback_payload_invalid"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) fail(400, "feedback_payload_invalid");
  if (files.length > UPLOAD_LIMITS.count) fail(400, "feedback_attachment_count");
  const images = [];
  for (const file of files) {
    if (typeof file === "string" || !file.size || file.size > UPLOAD_LIMITS.file) fail(400, "feedback_attachment_size");
    const bytes = new Uint8Array(await file.arrayBuffer()); let info;
    const header = [...bytes.subarray(0, 12)].map((byte) => String.fromCharCode(byte)).join("");
    const raster = header.startsWith("\x89PNG\r\n\x1a\n") || bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff || header.startsWith("RIFF") && header.slice(8) === "WEBP";
    if (!raster) fail(400, "feedback_attachment_invalid");
    try { info = imageSize(bytes); } catch { fail(400, "feedback_attachment_invalid"); }
    const mime = {png: "image/png", jpg: "image/jpeg", webp: "image/webp"}[info.type];
    if (!mime || mime !== file.type || !info.width || !info.height || info.width > 16000 || info.height > 16000 || info.width * info.height > 24000000) fail(400, "feedback_attachment_invalid");
    images.push({bytes, content_type: mime, file_name: `screenshot-${images.length + 1}.${info.type === "jpg" ? "jpg" : info.type}`});
  }
  return {body, images};
}

export async function submitFeedback(ctx, d) {
  const address = d.clientIp(ctx.request) || "unknown";
  await d.enforcePublicRateLimit(ctx.env, {scope: "feedback_ip", subject: address, limit: Number(ctx.env.FEEDBACK_RATE_LIMIT_PER_HOUR || 5), windowSeconds: 3600});
  const {body, images} = await readFeedback(ctx.request);
  if (d.hasFeedbackHoneypotValue(body)) return d.json({accepted: true, status: "new"}, 201);
  const item = d.normalizeFeedbackSubmission(body);
  const user = ctx.request.headers.has("authorization") ? await d.requireUser(ctx) : null;
  if (user && item.contact_email && item.contact_email !== user.email) fail(400, "feedback_account_email_mismatch");
  if (images.length && !ctx.env.FEEDBACK_BUCKET) fail(503, "feedback_storage_unavailable");
  if (d.isMainlandChinaRequest(ctx.request)) {
    if (!item.contact_email) fail(400, "feedback_email_required");
    const code = String(body.feedback_verification_code || body.verification_code || "").trim();
    if (!code) fail(400, "feedback_verification_code_required");
    await d.consumeVerificationCode(ctx.env, item.contact_email, "feedback", code);
  } else await d.verifyTurnstileToken(ctx.env, body.turnstile_token, ctx.request);
  const duplicate = await ctx.env.DB.prepare(`SELECT public_id,status FROM feedback_items WHERE client_ip=? AND title=? AND description=? AND COALESCE(user_id,0)=? AND created_at>=? ORDER BY id DESC LIMIT 1`)
    .bind(address, item.title, item.description, user?.id || 0, new Date(Date.now() - 900000).toISOString()).first();
  if (duplicate) {
    if (images.length) fail(409, "feedback_duplicate_with_attachments");
    return d.json({accepted: true, duplicate: true, public_id: duplicate.public_id, status: duplicate.status, tracked: !!user}, 202);
  }
  const publicId = `FB-${crypto.randomUUID().toUpperCase()}`, now = new Date().toISOString(), stored = [];
  try {
    for (const image of images) {
      const id = crypto.randomUUID(), key = `feedback/${publicId}/${id}`;
      stored.push({id, key, ...image});
      await ctx.env.FEEDBACK_BUCKET.put(key, image.bytes, {httpMetadata: {contentType: image.content_type}});
    }
    const statements = [ctx.env.DB.prepare(`INSERT INTO feedback_items(public_id,type,product_area,priority,status,title,description,contact_email,page_url,client_version,environment,rating,survey_answers,client_ip,user_agent,created_at,updated_at,user_id)
      VALUES(?,?,?,?,'new',?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(publicId, item.type, item.product_area, item.priority, item.title, item.description, user?.email || item.contact_email, item.page_url, item.client_version, item.environment, item.rating, JSON.stringify(item.survey_answers), address, String(ctx.request.headers.get("user-agent") || "").slice(0, 400), now, now, user?.id || null)];
    for (const image of stored) statements.push(ctx.env.DB.prepare(`INSERT INTO feedback_attachments(attachment_id,feedback_id,r2_key,file_name,content_type,size_bytes,created_at) SELECT ?,id,?,?,?,?,? FROM feedback_items WHERE public_id=?`).bind(image.id, image.key, image.file_name, image.content_type, image.bytes.length, now, publicId));
    statements.push(ctx.env.DB.prepare(`INSERT INTO feedback_events(feedback_id,status,created_at) SELECT id,'new',? FROM feedback_items WHERE public_id=?`).bind(now, publicId));
    await ctx.env.DB.batch(statements);
  } catch (error) {
    for (const image of stored) { try { await ctx.env.FEEDBACK_BUCKET.delete(image.key); } catch { console.error("feedback_attachment_cleanup_required", {key: image.key}); } }
    throw error;
  }
  return d.json({accepted: true, public_id: publicId, status: "new", tracked: !!user, attachment_count: stored.length}, 201);
}

export async function listFeedback(ctx, d, admin = true) {
  const user = admin ? (d.requireAdmin(ctx), null) : await d.requireUser(ctx);
  const q = String(ctx.url.searchParams.get("q") || "").trim().slice(0, 160), status = ctx.url.searchParams.get("status") || "", type = ctx.url.searchParams.get("type") || "";
  if (status && !STATUSES.includes(status) || type && !TYPES.includes(type)) fail(400, "feedback_filter_invalid");
  const where = [], args = [];
  if (user) { where.push("f.user_id=?"); args.push(user.id); }
  if (q) { where.push("(f.title LIKE ? ESCAPE '\\' OR f.public_id LIKE ? ESCAPE '\\')"); const term = `%${q.replace(/[\\%_]/g, "\\$&")}%`; args.push(term, term); }
  if (status) { where.push("f.status=?"); args.push(status); } if (type) { where.push("f.type=?"); args.push(type); }
  const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(100, Math.floor(Number(ctx.url.searchParams.get("limit")) || 25)));
  const requestedOffset = Number(ctx.url.searchParams.get("offset")), offset = Number.isSafeInteger(requestedOffset) && requestedOffset > 0 ? requestedOffset : 0;
  const total = await ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM feedback_items f ${filter}`).bind(...args).first();
  const rows = await ctx.env.DB.prepare(`SELECT ${USER_FIELDS},${COUNT_FILES}${admin ? ",f.contact_email,f.user_id" : ""} FROM feedback_items f ${filter} ORDER BY f.updated_at DESC,f.id DESC LIMIT ? OFFSET ?`).bind(...args, limit, offset).all();
  const metrics = await ctx.env.DB.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN status IN ('new','triaged','in_progress') THEN 1 ELSE 0 END) AS open,SUM(CASE WHEN priority IN ('high','urgent') AND status NOT IN ('closed','resolved') THEN 1 ELSE 0 END) AS high FROM feedback_items${user ? " WHERE user_id=?" : ""}`).bind(...(user ? [user.id] : [])).first();
  const counts = Object.fromEntries(["total", "open", "high"].map((key) => [key, Number(metrics?.[key]) || 0]));
  return d.json({items: rows.results || [], results: rows.results || [], page: {total: total.n, offset, limit, has_more: offset + limit < total.n}, metrics: counts}, 200, {"cache-control": "no-store"});
}

export function registerFeedbackCenter(d) {
  const {route, json, requireAdmin, requireUser} = d;
  for (const admin of [true, false]) {
    const root = admin ? "/v1/scorpio_v1_admin/feedback" : "/v1/account/feedback";
    if (!admin) route("GET", root, (ctx) => listFeedback(ctx, d, false));
    route("GET", `${root}/detail`, async (ctx) => {
      const user = admin ? (requireAdmin(ctx), null) : await requireUser(ctx);
      const id = Number(ctx.url.searchParams.get("id"));
      if (!Number.isSafeInteger(id) || id < 1) fail(404, "feedback_not_found");
      const row = await ctx.env.DB.prepare(`SELECT ${USER_FIELDS}${admin ? ",f.contact_email,f.admin_notes,f.user_id" : ""} FROM feedback_items f WHERE f.id=?${user ? " AND f.user_id=?" : ""}`).bind(id, ...(user ? [user.id] : [])).first();
      if (!row) fail(404, "feedback_not_found");
      const files = await ctx.env.DB.prepare("SELECT attachment_id,file_name,content_type,size_bytes FROM feedback_attachments WHERE feedback_id=? ORDER BY created_at,attachment_id").bind(id).all();
      const events = await ctx.env.DB.prepare("SELECT status,reply,created_at FROM feedback_events WHERE feedback_id=? ORDER BY id").bind(id).all();
      return json({...row, attachments: files.results || [], events: events.results || []}, 200, {"cache-control": "no-store"});
    });
    route("GET", `${root}/attachment`, async (ctx) => {
      const user = admin ? (requireAdmin(ctx), null) : await requireUser(ctx);
      const row = await ctx.env.DB.prepare(`SELECT a.* FROM feedback_attachments a JOIN feedback_items f ON f.id=a.feedback_id WHERE a.attachment_id=?${user ? " AND f.user_id=?" : ""}`).bind(ctx.url.searchParams.get("id") || "", ...(user ? [user.id] : [])).first();
      if (!row) fail(404, "feedback_attachment_not_found");
      const object = await ctx.env.FEEDBACK_BUCKET?.get(row.r2_key); if (!object) fail(404, "feedback_attachment_not_found");
      return new Response(object.body, {headers: {"content-type": row.content_type, "content-length": String(row.size_bytes), "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "content-disposition": `inline; filename="${row.file_name}"`}});
    });
  }
}

export async function updateFeedback(ctx, d) {
  d.requireAdmin(ctx);
  const id = Number(ctx.feedbackId); if (!Number.isSafeInteger(id) || id < 1) fail(400, "feedback_id_invalid");
  const row = await ctx.env.DB.prepare("SELECT * FROM feedback_items WHERE id=?").bind(id).first(); if (!row) fail(404, "feedback_not_found");
  const body = await d.readJson(ctx.request, 16 * 1024);
  const status = body.status ?? row.status, priority = body.priority ?? row.priority;
  if (!STATUSES.includes(status) || !PRIORITIES.includes(priority)) fail(400, "feedback_filter_invalid");
  if (body.updated_at && body.updated_at !== row.updated_at) fail(409, "feedback_changed");
  const notes = body.admin_notes === undefined ? row.admin_notes || "" : String(body.admin_notes ?? "").trim();
  const reply = body.public_reply === undefined ? row.public_reply || "" : String(body.public_reply ?? "").trim();
  if (notes.length > 2000 || reply.length > 2000) fail(400, "feedback_reply_too_long");
  const now = new Date(Math.max(Date.now(), Date.parse(row.updated_at) + 1)).toISOString();
  const changes = await ctx.env.DB.batch([
    ctx.env.DB.prepare("UPDATE feedback_items SET status=?,priority=?,admin_notes=?,public_reply=?,updated_at=? WHERE id=? AND updated_at=?").bind(status, priority, notes || "", reply, now, id, row.updated_at),
    ctx.env.DB.prepare("INSERT INTO feedback_events(feedback_id,status,reply,created_at) SELECT id,?,?,? FROM feedback_items WHERE changes()=1 AND id=? AND updated_at=? AND (?<>? OR ?<>?)").bind(status, reply === row.public_reply ? "" : reply, now, id, now, status, row.status, reply, row.public_reply),
  ]);
  if (Number(changes[0].meta?.changes) !== 1) fail(409, "feedback_changed");
  await d.audit(ctx.env, "update_feedback", "admin_api", {feedback_id: id, public_id: row.public_id, status, priority});
  return d.json({...row, ok: true, status, priority, admin_notes: notes, public_reply: reply, updated_at: now});
}
