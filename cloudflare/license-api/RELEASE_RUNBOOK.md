# Dual-source release runbook

Use this workflow for every new public Windows release. It publishes both editions to Cloudflare R2 and Alibaba Cloud OSS Hong Kong, verifies the OSS object metadata, and registers the release in the production D1 database.

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

The command refuses to replace an existing `version + channel + edition`. Pass `--allow-replace` only for a deliberate correction.

## Post-release checks

1. Confirm the production admin page lists each release with the R2 source and Hong Kong CDN URL.
2. Download from an authorized account outside mainland China (R2 path).
3. Download from an authorized account inside mainland China (signed Hong Kong CDN path).
4. Verify the downloaded SHA-256 against the command output.
