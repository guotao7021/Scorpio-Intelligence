const HOSTS = ["scorpio-intelligence.tech", "www.scorpio-intelligence.tech", "scorpio-intelligence.pages.dev", "guotao7021.github.io"];
export const AUTH_SITE_KEY = "0x4AAAAAADzKKGiOMI-xdBUr";

export function registerAuthSecurity({route, json}) {
  route("GET", "/v1/auth/security", ({env}) => json({mode: "turnstile", site_key: env.AUTH_TURNSTILE_SITE_KEY || AUTH_SITE_KEY}, 200, {"cache-control": "no-store"}));
}

export async function protectAuth(ctx, body, action, {enforcePublicRateLimit, sha256Hex, throwHttp}) {
  const ip = ctx.request.headers.get("CF-Connecting-IP") || "unknown";
  await enforcePublicRateLimit(ctx.env, {scope: "auth_ip", subject: ip, limit: 60, windowSeconds: 60});
  const email = String(body.email || "").trim().toLowerCase();
  await enforcePublicRateLimit(ctx.env, {scope: action === "login" ? "auth_login_email" : "auth_write_email", subject: await sha256Hex(email), limit: action === "login" ? 15 : 12, windowSeconds: 900});
  // Native clients share these routes. Browser challenges supplement, not replace,
  // the rate limits that protect every client; a client label is not attestation.
  const browser = ctx.request.headers.has("Origin") || ctx.request.headers.has("Sec-Fetch-Mode") || body.client_version === "web-account" || body.auth_context === "browser";
  if (!browser) return;
  const token = String(body.turnstile_token || "");
  if (!token || token.length > 2048) throwHttp(400, "auth_challenge_required");
  const secret = ctx.env.AUTH_TURNSTILE_SECRET || ctx.env.FEEDBACK_TURNSTILE_SECRET || ctx.env.TURNSTILE_SECRET_KEY;
  if (!secret) throwHttp(503, "auth_challenge_unavailable");
  let result;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", body: new URLSearchParams({secret, response: token, ...(ip !== "unknown" ? {remoteip: ip} : {})}), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("provider_unavailable");
    result = await response.json();
  } catch { throwHttp(503, "auth_challenge_unavailable"); }
  const hosts = String(ctx.env.AUTH_TURNSTILE_HOSTNAMES || HOSTS.join(",")).split(",").map((value) => value.trim());
  if (result?.success !== true || result.action !== `auth_${action}` || !hosts.includes(result.hostname)) throwHttp(403, "auth_challenge_failed");
}
