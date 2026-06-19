# Scorpio License API on Cloudflare Workers

This is the Cloudflare replacement for the temporary ECS API service.

It keeps the desktop client's current HTTP contract:

- `POST /v1/auth/send-code`
- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `POST /v1/auth/refresh`
- `POST /v1/auth/forgot-password`
- `POST /v1/auth/reset-password`
- `POST /v1/license/activate`
- `POST /v1/license/status`
- `POST /v1/license/rebind`
- `GET /v1/license/download/:license_id`
- `GET /v1/releases/latest`
- `GET /v1/releases/check`
- `POST /v1/usage/report`

It also adds a Cloudflare admin API protected by `X-Admin-Token`.
List endpoints support `limit`, `offset`, `q`, `status`, and `edition`
where applicable, and return `results` plus `page` metadata:

- `GET /v1/scorpio_v1_admin/overview`
- `GET /v1/scorpio_v1_admin/customers`
- `POST /v1/scorpio_v1_admin/customers`
- `PUT /v1/scorpio_v1_admin/customers/:id`
- `DELETE /v1/scorpio_v1_admin/customers/:id`
- `POST /v1/scorpio_v1_admin/activation-codes`
- `GET /v1/scorpio_v1_admin/activation-codes`
- `PUT /v1/scorpio_v1_admin/activation-codes/:code`
- `DELETE /v1/scorpio_v1_admin/activation-codes/:code`
- `GET /v1/scorpio_v1_admin/licenses`
- `PUT /v1/scorpio_v1_admin/licenses/:license_id`
- `DELETE /v1/scorpio_v1_admin/licenses/:license_id`
- `GET /v1/scorpio_v1_admin/releases`
- `POST /v1/scorpio_v1_admin/releases`
- `GET /v1/scorpio_v1_admin/audit-events`
- `GET /v1/scorpio_v1_admin/usage-reports`
- `GET /v1/scorpio_v1_admin/analysis-requests`

The static admin workbench lives in `docs/public/scorpio_v1_admin.html` and
calls the Cloudflare Worker directly. It is not backed by the retired ECS/Django
admin service.

It now exposes the first Analysis API contract layer. These endpoints are meant
to be called by the desktop client, not directly by website visitors:

- `GET /v1/analysis/health`
- `POST /v1/analysis/stock/bundle`
- `POST /v1/analysis/stock/price-technical`
- `POST /v1/analysis/stock/reason`
- `GET /v1/analysis/market/overview`
- `GET /v1/analysis/industry/overview`
- `GET /v1/analysis/capital/flow`
- `GET /v1/analysis/fund/bundle`
- `GET /v1/analysis/bond/bundle`
- `POST /v1/analysis/portfolio/enrich`

The Analysis API currently acts as a secure contract/gateway layer. If
`ANALYSIS_COMPUTE_URL` is configured, it proxies requests to the compute service.
If it is not configured, it returns a safe `contract_ready` response so clients
can integrate fallback behavior without exposing factor logic.

The customer ledger is intentionally separate from website users. A `user` is a
login identity; a `customer` is an operator-managed delivery/accounting record
that can be linked to activation codes and, when an email matches, to a website
account.

## Desktop License Contract

Cloudflare is the online authority, but the desktop application still trusts the
same signed local `license.json` contract used by `D:\dev\stock\license_admin`.

The product flow is:

1. Website handles registration, email verification, trial code issuance, and
   password reset.
2. Desktop client logs in through `/v1/auth/login`.
3. Desktop client activates through `/v1/license/activate` with the local machine
   fingerprint.
4. Worker returns `license_file`, which is written to the desktop license path.
5. Desktop validation continues to verify the Ed25519 signature with
   `resources/commercial_signing_public.key`.
6. `/v1/license/download/:license_id` lets an authenticated user re-download the
   signed license file for the current account.

The Worker signing private key must match the public key embedded in the desktop
installer. If the signing key changes, the desktop package must be rebuilt with
the matching public key.

## Deploy Outline

```powershell
cd D:\dev\stock\cloudflare\license-api
npm install
npm run d1:create
```

Copy the returned D1 `database_id` into `wrangler.toml`, then:

```powershell
npm run d1:migrate:remote
npx wrangler secret put JWT_SECRET
npx wrangler secret put STOCK_SIGNING_PRIVATE_KEY
npx wrangler secret put ADMIN_API_TOKEN
npx wrangler secret put RESEND_API_KEY
npm run deploy
```

After deployment, bind the Worker to:

```text
api.scorpio-intelligence.tech
```

Do not put secrets in `wrangler.toml`, GitHub, Cloudflare Pages, or the desktop client.

Optional Analysis Compute binding:

```powershell
npx wrangler secret put ANALYSIS_COMPUTE_TOKEN
```

Set `ANALYSIS_COMPUTE_URL` as a plain Worker variable only when a private
analysis compute service is ready. Until then, leave it unset so the Worker
returns `contract_ready` responses.

Local/private Analysis Compute can be started from the main project root:

```powershell
cd D:\dev\stock
python scripts\run_analysis_compute_server.py --host 127.0.0.1 --port 8789
```

Smoke test:

```powershell
$body = @{ code = "002352"; market = "CN"; period = "1y" } | ConvertTo-Json
Invoke-WebRequest `
  -UseBasicParsing `
  -Method POST `
  -Uri "http://127.0.0.1:8789/v1/analysis/stock/bundle" `
  -ContentType "application/json" `
  -Body $body
```

Cloudflare Worker cannot call `127.0.0.1` on your machine. For production,
publish this compute service behind a private HTTPS endpoint, for example a
Cloudflare Tunnel or a private server, then set:

```text
ANALYSIS_COMPUTE_URL=https://your-analysis-compute-host
ANALYSIS_COMPUTE_TOKEN=<same-secret-on-worker-and-compute>
```

The compute service returns display-safe analysis payloads only. Do not expose
raw factors, strategy weights, thresholds, dataframe dumps, internal DAGs, or
private decision objects through this boundary.

## ECS Retirement Gate

Only stop ECS after all of these pass against `https://api.scorpio-intelligence.tech`:

1. Send-code sends a registration verification email.
2. Register accepts the verification code and returns a trial activation code.
3. Login returns access and refresh tokens.
4. Activation returns a signed `license_file`.
5. Existing desktop public key verifies the `ed25519:` signature.
6. Authenticated license download returns the same signed license payload shape.
7. Online status returns `valid=true`.
8. Release check returns a stable response.
9. Usage report returns `accepted=true`.
10. Admin customer ledger can create, update, delete an unlinked customer, and
    link a generated activation code to a managed customer.

Smoke test after deployment:

```powershell
cd D:\dev\stock
python scripts\verify_cloudflare_license_flow.py `
  --base-url https://api.scorpio-intelligence.tech `
  --email your-test-email@example.com `
  --verification-code <email-code>
```

To include customer ledger create/update/delete verification, pass the admin
token from the current terminal session instead of writing it to a file:

```powershell
$env:SCORPIO_ADMIN_API_TOKEN = "<ADMIN_API_TOKEN>"
python scripts\verify_cloudflare_license_flow.py `
  --base-url https://api.scorpio-intelligence.tech `
  --email your-test-email@example.com `
  --verification-code <email-code> `
  --admin-token $env:SCORPIO_ADMIN_API_TOKEN
```

This default admin check creates an unlinked temporary customer, updates it, and
deletes it again. It should not leave customer-ledger test data.

Only when you explicitly want to verify customer-linked activation-code
generation, add:

```powershell
  --include-linked-admin-record
```

That linked check intentionally leaves a customer/code record because linked
delivery records are protected from hard deletion.

Then stop and disable ECS:

```bash
systemctl stop stock-api
systemctl disable stock-api
```

Keep one offline backup of:

```text
/opt/stock-server/server/.env
/opt/stock-server/server/db.sqlite3
/opt/stock-server/server/logs/
```
