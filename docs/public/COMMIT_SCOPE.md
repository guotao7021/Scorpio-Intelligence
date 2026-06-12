# Commit Scope

This repository section is intentionally narrow for public publishing.

Allowed public-site commit surface:

- `README.md`
- `docs/public/**`
- `.github/workflows/public-site.yml`
- `.github/ISSUE_TEMPLATE/**`

Do not include unrelated application code, runtime data, reports, caches, or commercial artifacts in public-site commits.

Before pushing, run:

```powershell
.\scripts\verify_public_site_scope.ps1
```

For local enforcement, point `core.hooksPath` at `.githooks` and keep the `pre-push` hook active.
