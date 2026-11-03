# Dual-source release runbook

Use this workflow for every public Windows or Android release. It publishes the selected artifacts to Cloudflare R2 and Alibaba Cloud OSS Hong Kong, verifies the OSS object metadata, and registers the release in the production D1 database.

## Prerequisites

- Cloudflare Wrangler is authenticated for this project.
- The current shell has `ALIBABA_CLOUD_ACCESS_KEY_ID` and `ALIBABA_CLOUD_ACCESS_KEY_SECRET`.
- The Alibaba Cloud CLI is installed at `%LOCALAPPDATA%\\AliyunCLI\\aliyun.exe`, or set `ALIYUN_CLI_PATH`.
- The Worker migration containing `hk_download_url` has been applied.

## Preview a release

Run the following first. It hashes both installers and prints the planned R2 and Hong Kong CDN paths without changing remote state.

```powershell
Set-Location C:\Users\guota\Documents\GitHub\Scorpio-Intelligence\cloudflare\license-api
npm run release:publish-dual -- `
  --version 1.0.12-YYYYMMDD `
  --pro-file D:\path\Scorpio-Pro-Setup-v1.0.12-YYYYMMDD.exe `
  --standard-file D:\path\Scorpio-Std-Setup-v1.0.12-YYYYMMDD.exe `
  --dry-run
```

## Publish

```powershell
npm run release:publish-dual -- `
  --version 1.0.12-YYYYMMDD `
  --pro-file D:\path\Scorpio-Pro-Setup-v1.0.12-YYYYMMDD.exe `
  --standard-file D:\path\Scorpio-Std-Setup-v1.0.12-YYYYMMDD.exe `
  --notes "Scorpio Intelligence v1.0.12 release."
```

Android APK can be published independently after the mobile build is ready:

```powershell
npm run release:publish-dual -- `
  --version 1.0.12 `
  --apk-file "D:\release\Scorpio-Android-v1.0.12.apk" `
  --notes "Scorpio Intelligence Android v1.0.12 release."
```

The Android record uses edition `android`, platform `android`, R2 path `releases/android/...`, and MIME type `application/vnd.android.package-archive`. The account page reads the active Android `beta` channel and mounts its authorized download endpoint automatically. A signed-in user with an active Personal Standard or Personal Pro entitlement can download it.

The command refuses to replace an existing `version + channel + edition`. Pass `--allow-replace` only for a deliberate correction.

## Post-release checks

1. Confirm the production admin page lists each release with the R2 source and Hong Kong CDN URL.
2. Download from an authorized account outside mainland China (R2 path).
3. Download from an authorized account inside mainland China (signed Hong Kong CDN path).
4. Verify the downloaded SHA-256 against the command output.
## Shared Worker Deployment Check

`scorpio-license-api` serves both the public website/account center and the desktop/Android clients. A deployment from either checkout replaces the same Worker. Do not deploy a client-only or website-only source tree to this Worker.

The 2026-11-03 incident was caused by a client deployment omitting the account center, operations dashboard and feedback modules and the private `FEEDBACK_BUCKET` binding. `/health` still returned 200, even though new website routes were absent.

Before publishing:

1. Compare this checkout with `D:\dev\stock\cloudflare\license-api` and the active Cloudflare version. Preserve changes from both sources. Do not overwrite the other checkout's uncommitted work.
2. Keep all migrations, `RELEASE_BUCKET`, private `FEEDBACK_BUCKET` (`website`), JWT/signing secrets, runtime variables and the existing scheduled trigger.
3. Use `npm run deploy` from this API directory. Its lifecycle runs the regression suite before publishing, preserves remote variables with `--keep-vars`, then checks the deployed API contracts and screenshot binding. A direct `wrangler deploy` bypasses these lifecycle checks.
4. `npm run deploy:verify` must pass after any deployment from another checkout. A plain HTTP 200 from `/health` is not sufficient: `contracts` must include account, operations, feedback, auth, mobile portfolio and storage support.
5. Publish static pages only after API verification succeeds. Verify authenticated read-only admin screens using an existing authorized session; never create/delete live users just to test a deployment.

The verification script sends no credentials and makes no business writes. Its 401/403 checks prove protected routes are present, not that authenticated database queries have succeeded.
