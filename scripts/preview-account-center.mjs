import http from "node:http";
import path from "node:path";
import {readFileSync, existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {createHmac} from "node:crypto";
import worker from "../cloudflare/license-api/src/worker.js";
import {createAccountFixture, PREVIEW_PASSWORD, PREVIEW_ADMIN, TEST_JWT_SECRET} from "../cloudflare/license-api/test/helpers/account-fixture.mjs";
import {memoryFeedbackBucket, issueCode, multipartFeedback, feedbackBody} from "../cloudflare/license-api/test/helpers/feedback-fixture.mjs";
import {protectAuth} from "../cloudflare/license-api/src/auth-security.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../docs/public");
const port = Number(process.argv[process.argv.indexOf("--port") + 1]) || 4173;
const base = `http://127.0.0.1:${port}`;
const fixture = createAccountFixture();
fixture.env.FEEDBACK_BUCKET = memoryFeedbackBucket();
fixture.env.AUTH_TURNSTILE_SECRET = "isolated-preview-only";
fixture.env.AUTH_TURNSTILE_HOSTNAMES = "127.0.0.1";
fixture.env.FEEDBACK_RATE_LIMIT_PER_HOUR = "100";
const providerFetch = globalThis.fetch, usedTokens = new Set();
globalThis.fetch = async (url, options) => {
  if (String(url) !== "https://challenges.cloudflare.com/turnstile/v0/siteverify") return providerFetch(url, options);
  const token = options.body.get("response") || "";
  const valid = /^local:auth_(login|register|reset):[a-f0-9-]{36}$/.test(token) && !usedTokens.has(token) && options.body.get("secret") === fixture.env.AUTH_TURNSTILE_SECRET;
  usedTokens.add(token); return Response.json({success: valid, hostname: "127.0.0.1", action: token.split(":")[1]});
};
const today = new Date().toISOString().slice(0, 10);
for (const [index, platform, edition, channel] of [[1, "desktop", "personal_pro", "stable"], [2, "desktop", "personal_standard", "stable"], [3, "android", "all", "beta"]]) {
  fixture.sql.prepare(`INSERT INTO release_versions(id,version,channel,edition,platform,release_notes,r2_key,file_name,content_type,released_at)
    VALUES(?,'0.0.0-local-preview',?,?,?,'Local preview','preview.txt','Scorpio-local-preview.txt','text/plain',?)`).run(index, channel, edition, platform, today);
}
fixture.env.RELEASE_BUCKET = {async get() {
  const bytes = new TextEncoder().encode("Local preview only. This is not a software installer.\n");
  return {body: bytes, size: bytes.byteLength, writeHttpMetadata(headers) { headers.set("content-type", "text/plain"); }};
}};
issueCode(fixture);
const sample = multipartFeedback({...feedbackBody, title: "续期后到期日未刷新（本地演示）", description: "此记录仅用于隔离验收，不代表线上故障。管理员可在问题反馈中处理，用户可在我的反馈中查看进展。"}, [new File([readFileSync(path.join(root, "assets/scorpio-workbench-preview.png"))], "preview.png", {type: "image/png"})]);
const seeded = await worker.fetch(new Request(base + "/v1/feedback", {method: "POST", headers: {authorization: `Bearer ${fixture.jwt()}`, "CF-IPCountry": "CN"}, body: sample}), fixture.env);
if (seeded.status !== 201) throw new Error("Could not seed the isolated feedback preview");
const types = {".html": "text/html; charset=utf-8", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon"};
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, base);
    if (url.pathname === "/preview-turnstile.js") {
      response.writeHead(200, {"content-type": "application/javascript", "cache-control": "no-store"});
      response.end(readFileSync(new URL("./preview-turnstile.js", import.meta.url))); return;
    }
    if (url.pathname === "/site-analytics.js") {
      response.writeHead(200, {"content-type": "application/javascript", "cache-control": "no-store"});
      response.end("// Analytics is disabled in the isolated account preview.\n"); return;
    }
    if (url.pathname.startsWith("/v1/")) {
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 16 * 1024 * 1024) throw new Error("Preview body too large"); chunks.push(chunk); }
      const bytes = Buffer.concat(chunks);
      if (["/v1/auth/send-code", "/v1/auth/forgot-password", "/v1/feedback/send-code"].includes(url.pathname) && request.method === "POST") {
        const body = JSON.parse(bytes.toString());
        const email = String(body.email || "").toLowerCase().trim();
        const purpose = url.pathname === "/v1/feedback/send-code" ? "feedback" : url.pathname.endsWith("forgot-password") ? "reset_password" : body.purpose || "register";
        if (purpose !== "feedback") {
          await protectAuth({request: new Request(url, {headers: request.headers}), env: fixture.env}, body, purpose === "register" ? "register" : "reset", {
            enforcePublicRateLimit: async () => {}, sha256Hex: async () => "preview-only",
            throwHttp(status, code) { const error = new Error(code); error.status = status; throw error; },
          });
        }
        const code = "123456";
        const hash = createHmac("sha256", TEST_JWT_SECRET).update(`${email}|${purpose}|${code}`).digest("base64url");
        fixture.sql.prepare("INSERT INTO auth_verification_codes(email,purpose,code_hash,expires_at,created_at) VALUES(?,?,?,?,?)")
          .run(email, purpose, hash, new Date(Date.now() + 600000).toISOString(), new Date().toISOString());
        response.writeHead(200, {"content-type": "application/json", "cache-control": "no-store"});
        response.end(JSON.stringify({message: "verification_code_sent", debug_code: code})); return;
      }
      const headers = new Headers(request.headers);
      if (url.pathname.startsWith("/v1/feedback")) headers.set("CF-IPCountry", "CN");
      const incoming = new Request(url, {method: request.method, headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : bytes});
      const result = await worker.fetch(incoming, fixture.env);
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer())); return;
    }
    let file = decodeURIComponent(url.pathname);
    if (file === "/") file = "/account.html";
    if (!path.extname(file)) file += ".html";
    const absolute = path.resolve(root, "." + file);
    if (!absolute.startsWith(root + path.sep) || !existsSync(absolute)) { response.writeHead(404); response.end("Not found"); return; }
    let content = readFileSync(absolute);
    if (path.extname(absolute) === ".html") content = Buffer.from(content.toString("utf8").replace('content="https://api.scorpio-intelligence.tech/v1"', `content="${base}/v1"`).replace("</head>", '<script src="/preview-turnstile.js"></script></head>'));
    response.writeHead(200, {"content-type": types[path.extname(absolute)] || "application/octet-stream", "cache-control": "no-store", "content-security-policy": "connect-src 'self'; form-action 'self'"}); response.end(content);
  } catch (error) { console.error(error); response.writeHead(error.status || 500, {"content-type": "application/json"}); response.end(JSON.stringify({error: error.status ? error.message : "local_preview_error"})); }
});
server.on("error", (error) => { console.error(error.message); process.exitCode = 1; fixture.close(); });
server.listen(port, "127.0.0.1", () => {
  console.log(`Account preview: ${base}/account.html`);
  console.log(`Admin preview: ${base}/scorpio_v1_admin.html`);
  console.log(`Fictional user: researcher@example.test / ${PREVIEW_PASSWORD}`);
  console.log(`Local-only admin token: ${PREVIEW_ADMIN}`);
  console.log("All data is fictional and held in memory. No production database or email provider is contacted.");
});
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => { fixture.close(); process.exit(0); }));
