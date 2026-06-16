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
- `account.html` for account login, trial-code display, and release download entry
- `scorpio_v1_admin.html` for owner-only administration with a locally entered `ADMIN_API_TOKEN`

Keep this folder public-facing only. Do not place download packages here.
The user center reads release download URLs from the configured API endpoint.
Do not hard-code admin tokens or package secrets into this repository.
