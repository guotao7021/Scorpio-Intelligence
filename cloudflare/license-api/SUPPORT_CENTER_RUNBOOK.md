# Account Security And Feedback Center

## Scope

The account page has password visibility controls, password confirmation on
registration/reset and browser Turnstile verification. The administrator page
has an embedded Feedback inbox. The signed-in user has My feedback in the
existing account navigation. Both languages retain the official site theme.
The former feedback_admin.html URL redirects to the integrated inbox.

Feedback supports three PNG/JPEG/WebP screenshots, up to 5 MiB each and 24 million
pixels per image. The request reader enforces a 16 MiB streaming limit before
multipart parsing. The server checks raster signatures, detected image types
and dimensions; it does not perform antivirus scanning or re-encode images.

## Privacy And Ownership

- Only a validated access token can associate a new submission with a user.
  A submitted user_id or contact email cannot select an owner.
- The user routes enforce feedback_items.user_id for every list, detail and
  screenshot read. Public references are not access credentials.
- public_reply and the public status timeline are visible to the owner;
  admin_notes, IP addresses, user agents and R2 keys never enter user responses.
- Guest and historical unlinked records remain visible to administrators only.
  Do not backfill ownership by matching an unverified contact email.
- Screenshots live in FEEDBACK_BUCKET, not the public release bucket. No public
  R2 domain, r2.dev endpoint or signed public screenshot URLs are needed.
- Authenticated screenshots use private/no-store, nosniff and a restrictive CSP.
  The frontend fetches bytes with credentials and creates temporary Blob URLs;
  credentials are never embedded in image URLs. Logout/selection changes revoke
  those URLs and close the screenshot viewer.
- Text drafts are tab-local sessionStorage. Screenshots and email codes are not
  persisted into drafts. Submission failures retain the current form/images.
- R2 writes are compensated on database failure. A failed cleanup logs
  feedback_attachment_cleanup_required with the generated key for remediation.
  A process interruption between storage and D1 commit can still leave an orphan;
  compare private objects with feedback_attachments before any manual cleanup.

## Authentication Policy

GET /v1/auth/security returns the public site key only. Browser register, login,
send-code, forgot-password and reset-password requests need a single-use token
with the matching auth_register, auth_login or auth_reset action. The server
checks success, action and the allowed hostname, and fails closed on outages.
Sending a code consumes its proof; the widget resets before the final form submit.
Registration returns access/refresh tokens as additive response fields, avoiding
a second login with an already consumed proof. Existing native response fields
and desktop/Android login contracts are preserved.

All clients share IP and hashed-email authentication rate limits. The legacy
native public endpoints do not require a browser challenge. A native client
label is not device attestation: a non-browser client can still attempt those
routes under the rate limits. Do not describe this as complete bot prevention;
stronger native enforcement requires a coordinated client protocol upgrade.

The default browser limits are 60 auth requests per IP/minute, 15 login attempts
per email/15 minutes and 12 other auth writes per email/15 minutes. Existing code
send limits also apply to forgot-password. OTP consumption uses a conditional
update so concurrent requests cannot consume the same code twice.

## Deployment Gate (Not Run By Local Tests)

Deploy only after an explicit release decision. Before changing production:

1. Save the current Worker version, static deployment and D1 backup. Confirm
   the target account, production branch and existing secrets/bindings.
2. Bind the existing private R2 bucket website as FEEDBACK_BUCKET. Its r2.dev
   access must remain disabled and no public domain may be attached. Do not
   reuse this bucket for public website assets. Define the privacy/retention
   policy before collecting real screenshots; do not expire objects without a
   corresponding metadata cleanup process.
3. Apply migration 0032_feedback_center.sql. It adds nullable ownership, public
   replies, private attachment metadata and public events; it does not delete or
   reassign existing feedback. Never remove the additive schema on rollback.
4. Configure AUTH_TURNSTILE_SITE_KEY and AUTH_TURNSTILE_SECRET as a matching
   widget pair, or confirm the existing shared site key / FEEDBACK_TURNSTILE_SECRET
   pair is valid. The secret fallback is AUTH_TURNSTILE_SECRET, then
   FEEDBACK_TURNSTILE_SECRET, then TURNSTILE_SECRET_KEY. Never put a secret in HTML.
5. Allow the official domains and guotao7021.github.io in the Turnstile widget.
   AUTH_TURNSTILE_HOSTNAMES can override the server allowlist for explicitly
   approved deployment hosts. Do not use a wildcard or add arbitrary hostnames.
   Test provider availability from mainland China before rollout; failures do
   not bypass verification. Check deployment-level CSP allows the provider and
   blob: screenshot images.
6. Deploy Worker with existing secrets/variables preserved, then the static
   docs/public files to Cloudflare Pages and GitHub Pages from the same commit.
   The private bucket and schema must exist before the new UI is published.
7. Smoke-test Chinese/English login, code sending, registration/reset, feedback
   upload, shared administrator sign-in, an admin reply, owner-only progress and
   screenshot access, and an unrelated desktop/Android authorization workflow.
8. Roll back code/static deployment together if needed. Preserve uploaded
   evidence and additive tables. Do not deploy scripts/preview-turnstile.js.

Useful commands, after the release decision, from cloudflare/license-api:

```powershell
node node_modules/wrangler/bin/wrangler.js r2 bucket dev-url get website
node node_modules/wrangler/bin/wrangler.js r2 bucket domain list website
node node_modules/wrangler/bin/wrangler.js d1 migrations apply scorpio-license-db --remote
node node_modules/wrangler/bin/wrangler.js deploy --keep-vars
```

## Local Verification

Use Node 24.15+ (the current runtime is 24.16); the DOM test dependency also
supports recent Node 22 releases as declared in its package engines.

```powershell
cd cloudflare/license-api
npm ci
npm test
npm audit --omit=dev
```

From the repository root:

```powershell
node scripts/preview-account-center.mjs --port 4173
```

The preview listens only on 127.0.0.1 and uses in-memory SQLite/R2, fictional
accounts, a local provider stub and email code 123456. The local verification
checkbox is deliberately not a CAPTCHA and is not deployed. The seeded feedback
uses an already public product image, not a private user screenshot.

Preview user: researcher@example.test / LocalPreview2026!
Preview administrator token: local-preview-admin-only

The DOM integration tests execute the real page scripts against the real Worker
and isolated fixtures. They cover login controls, verification errors, screenshots,
shared admin navigation, replies and user progress. They are not a replacement for
browser rendering, responsive screenshots or a real Turnstile provider smoke test.

At implementation time, production npm dependencies have no audit advisories.
The existing Wrangler/Miniflare development dependency chain has four npm audit
entries; those pre-existing tools were not upgraded as part of this feature.

References:
- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
