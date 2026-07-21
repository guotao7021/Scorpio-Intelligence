import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { basename } from "node:path";
import { spawnSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const file = requiredArg(args, "file");
const edition = normalize(args.edition || "personal_pro");
const channel = normalize(args.channel || "stable");
const version = String(requiredArg(args, "version")).replace(/^v/i, "");
const bucket = args.bucket || "scorpio-releases";
const apiBase = (args.api || "").replace(/\/+$/, "");
const adminToken = args.adminToken || process.env.SCORPIO_ADMIN_API_TOKEN || "";
const notes = args.notes || "";
const contentType = args.contentType || "application/octet-stream";
const fileName = args.fileName || basename(file);
const r2Key = args.key || `releases/${edition}/${channel}/${version}/${fileName}`;
const fileInfo = statSync(file);
const sha256 = await sha256File(file);

runWrangler([
  "r2",
  "object",
  "put",
  `${bucket}/${r2Key}`,
  "--file",
  file,
  "--content-type",
  contentType,
  "--remote",
]);

if (apiBase) {
  if (!adminToken) {
    throw new Error("Missing --admin-token or SCORPIO_ADMIN_API_TOKEN for API metadata registration.");
  }
  const response = await fetch(`${apiBase}/v1/scorpio_v1_admin/releases`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-token": adminToken,
    },
    body: JSON.stringify({
      version,
      channel,
      edition,
      release_notes: notes,
      r2_key: r2Key,
      file_name: fileName,
      content_type: contentType,
      file_hash_sha256: sha256,
      file_size_bytes: fileInfo.size,
      is_required: Boolean(args.required),
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Release metadata registration failed: HTTP ${response.status} ${text}`);
  }
  console.log(text);
} else {
  console.log(JSON.stringify({
    version,
    channel,
    edition,
    r2_key: r2Key,
    file_name: fileName,
    content_type: contentType,
    file_hash_sha256: sha256,
    file_size_bytes: fileInfo.size,
  }, null, 2));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function requiredArg(values, key) {
  if (!values[key]) {
    throw new Error(`Missing required argument --${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  }
  return values[key];
}

function normalize(value) {
  return String(value || "").trim().toLowerCase().replaceAll("-", "_");
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolve);
  });
  return hash.digest("hex");
}

function runWrangler(argv) {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(command, ["wrangler", ...argv], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`wrangler failed with exit code ${result.status}`);
  }
}
