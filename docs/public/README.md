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
- `admin.html` for owner-only administration with a locally entered `ADMIN_API_TOKEN`

Keep this folder public-facing only. Do not place download packages here.
The delivery console reads release download URLs from `https://api.scorpio-intelligence.tech`.
Do not hard-code admin tokens or package secrets into this repository.
