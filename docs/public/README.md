# Public Hub

This folder powers the GitHub Pages public site.

Primary entry points:

- `index.html` for the bilingual landing page
- `index-cn.html` for the Chinese site
- `index-en.html` for the English site
- `changelog-cn.html`
- `changelog-en.html`
- `feedback.html`
- `faq.html`
- `account.html` for registration, licenses, device bindings, renewal requests,
  activity and authenticated client downloads (add `?lang=en` for English)
- `account.html#software-download` for Windows, Android and the iPhone web app.
  The iPhone entry opens `iphone/` in Safari and does not download an installer.
- `scorpio_v1_admin.html` for owner-only administration with a locally entered `ADMIN_API_TOKEN`

Keep this folder public-facing only. Do not place download packages here.
The user center reads release download URLs from the configured API endpoint.
Do not hard-code admin tokens or package secrets into this repository.

The account center and registered-user administration share `account-center.css`
and `account-center-ui.js`. Their theme follows the official site's dark surface,
cyan action and teal success palette. Account-specific state is provided by the
Worker, not inferred from a locally saved activation code. Existing
`#license-console` and `#software-download` links remain supported.

`admin-accounts.js` provides the authorization workbench, registered users,
renewal approvals and the user-detail drawer. Legacy delivery tools are retained
in a separate view; registered-user license actions use the new confirmation and
audited mutation endpoints from every entry point.

For a local preview using fictional accounts and an in-memory database, run
`node scripts/preview-account-center.mjs --port 4173` from the repository root.
The bilingual feedback pages use `feedback-center-ui.js` and
`feedback-center.css`: issue classification, conditional reproduction or survey
fields, review, regional verification, tab-local drafts and numbered receipts.
They retain the existing `/v1/feedback` storage and moderation contract. There
is no public ticket-status lookup or attachment upload endpoint; the UI does not
advertise either. Verification codes are never stored in drafts.

See `cloudflare/license-api/README.md` for test credentials and deployment order.
Publishing static files alone is insufficient: review the production migration
ledger, apply the account-center migration, and deploy the compatible Worker
before publishing the UI. Deployment must be explicitly approved.
