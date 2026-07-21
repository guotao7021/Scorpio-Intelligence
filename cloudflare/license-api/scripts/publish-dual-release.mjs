import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { basename } from "node:path";
import { spawnSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const version = String(requiredArg(args, "version")).replace(/^v/i, "");
const proFile = requiredArg(args, "proFile");
const standardFile = requiredArg(args, "standardFile");
const channel = normalize(args.channel || "stable");
const notes = String(args.notes || "").trim();
const releasedAt = String(args.releasedAt || new Date().toISOString()).trim();
const r2Bucket = String(args.r2Bucket || "scorpio-releases");
const ossBucket = String(args.ossBucket || "scorpio-download-hk-20260722");
const ossEndpoint = String(args.ossEndpoint || "oss-cn-hongkong.aliyuncs.com");
const ossRegion = String(args.ossRegion || "cn-hongkong");
const hkHost = String(args.hkHost || "download-hk.scorpio-intelligence.tech").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
const dryRun = Boolean(args.dryRun);
const allowReplace = Boolean(args.allowReplace);

const releases = await Promise.all([
  buildRelease("personal_pro", proFile, notes || `Scorpio Intelligence Pro v${version} release.`),
  buildRelease("personal_standard", standardFile, notes || `Scorpio Intelligence Standard v${version} release.`),
]);

for (const release of releases) {
  console.log(`Preparing ${release.edition}: ${release.fileName} (${release.fileSizeBytes} bytes)`);
  if (!dryRun) {
    await ensureReleaseIsNew(release);
    uploadR2(release);
    uploadOss(release);
    verifyOss(release);
    registerRelease(release);
  }
}

console.log(JSON.stringify({
  status: dryRun ? "dry_run" : "published",
  version,
  channel,
  released_at: releasedAt,
  releases: releases.map(publicRelease),
}, null, 2));

async function buildRelease(edition, file, releaseNotes) {
  const info = statSync(file);
  if (!info.isFile() || info.size < 1) throw new Error(`Release file is empty or invalid: ${file}`);
  const fileName = basename(file);
  const sha256 = await sha256File(file);
  const r2Key = `releases/${edition}/${channel}/${version}/${fileName}`;
  const ossKey = `releases/v${version}/${fileName}`;
  return {
    edition,
    file,
    fileName,
    fileSizeBytes: info.size,
    sha256,
    r2Key,
    ossKey,
    hkDownloadUrl: `https://${hkHost}/${ossKey}`,
    releaseNotes,
  };
}

async function ensureReleaseIsNew(release) {
  if (allowReplace) return;
  const sql = `SELECT id FROM release_versions WHERE version = ${sqlText(version)} AND channel = ${sqlText(channel)} AND edition = ${sqlText(release.edition)} LIMIT 1;`;
  const result = run("npx.cmd", ["wrangler", "d1", "execute", "scorpio-license-db", "--remote", "--command", sql], { capture: true });
  if (/"id"\s*:\s*\d+/.test(result.stdout || "")) {
    throw new Error(`Release ${version}/${channel}/${release.edition} already exists. Use a new version or pass --allow-replace deliberately.`);
  }
}

function uploadR2(release) {
  run("npx.cmd", [
    "wrangler", "r2", "object", "put", `${r2Bucket}/${release.r2Key}`,
    "--file", release.file,
    "--content-type", "application/octet-stream",
    "--remote",
  ]);
}

function uploadOss(release) {
  const accessKeyId = requiredEnv("ALIBABA_CLOUD_ACCESS_KEY_ID");
  const accessKeySecret = requiredEnv("ALIBABA_CLOUD_ACCESS_KEY_SECRET");
  run("aliyun", [
    "oss", "cp", release.file, `oss://${ossBucket}/${release.ossKey}`,
    "--endpoint", ossEndpoint,
    "--region", ossRegion,
    "--access-key-id", accessKeyId,
    "--access-key-secret", accessKeySecret,
    "--meta", `Content-Type:application/octet-stream#Content-Disposition:attachment#x-oss-meta-sha256:${release.sha256}`,
    "--force",
  ]);
}

function verifyOss(release) {
  const accessKeyId = requiredEnv("ALIBABA_CLOUD_ACCESS_KEY_ID");
  const accessKeySecret = requiredEnv("ALIBABA_CLOUD_ACCESS_KEY_SECRET");
  const result = run("aliyun", [
    "oss", "stat", `oss://${ossBucket}/${release.ossKey}`,
    "--endpoint", ossEndpoint,
    "--region", ossRegion,
    "--access-key-id", accessKeyId,
    "--access-key-secret", accessKeySecret,
  ], { capture: true });
  const output = result.stdout || "";
  if (!output.includes(`Content-Length        : ${release.fileSizeBytes}`)) {
    throw new Error(`OSS size verification failed for ${release.fileName}`);
  }
  if (!output.toLowerCase().includes(`X-Oss-Meta-Sha256     : ${release.sha256}`.toLowerCase())) {
    throw new Error(`OSS SHA-256 metadata verification failed for ${release.fileName}`);
  }
}

function registerRelease(release) {
  const sql = `INSERT INTO release_versions (version, channel, edition, release_notes, download_url, hk_download_url, r2_key, file_name, content_type, file_hash_sha256, file_size_bytes, is_required, is_active, released_at, uploaded_at)
VALUES (${sqlText(version)}, ${sqlText(channel)}, ${sqlText(release.edition)}, ${sqlText(release.releaseNotes)}, '', ${sqlText(release.hkDownloadUrl)}, ${sqlText(release.r2Key)}, ${sqlText(release.fileName)}, 'application/octet-stream', ${sqlText(release.sha256)}, ${release.fileSizeBytes}, 0, 1, ${sqlText(releasedAt)}, ${sqlText(new Date().toISOString())})
ON CONFLICT(version, channel, edition) DO UPDATE SET
release_notes = excluded.release_notes, hk_download_url = excluded.hk_download_url, r2_key = excluded.r2_key, file_name = excluded.file_name, content_type = excluded.content_type, file_hash_sha256 = excluded.file_hash_sha256, file_size_bytes = excluded.file_size_bytes, is_active = excluded.is_active, released_at = excluded.released_at, uploaded_at = excluded.uploaded_at;`;
  run("npx.cmd", ["wrangler", "d1", "execute", "scorpio-license-db", "--remote", "--command", sql]);
}

function run(command, commandArgs, options = {}) {
  const executable = process.platform === "win32" && command === "aliyun"
    ? process.env.ALIYUN_CLI_PATH || `${process.env.LOCALAPPDATA}\\AliyunCLI\\aliyun.exe`
    : command;
  const result = spawnSync(executable, commandArgs, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? "unknown"}`);
  }
  return result;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function requiredArg(values, key) {
  if (!values[key]) throw new Error(`Missing --${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  return values[key];
}

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase().replaceAll("-", "_");
}

function sqlText(value) {
  return `'${String(value || "").replaceAll("'", "''")}'`;
}

function publicRelease(release) {
  return {
    edition: release.edition,
    file_name: release.fileName,
    file_size_bytes: release.fileSizeBytes,
    sha256: release.sha256,
    r2_key: release.r2Key,
    hk_download_url: release.hkDownloadUrl,
  };
}

async function sha256File(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", resolve);
  });
  return hash.digest("hex");
}
