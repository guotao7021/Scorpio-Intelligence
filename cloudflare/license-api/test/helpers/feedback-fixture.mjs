import {createHmac} from "node:crypto";
import {TEST_JWT_SECRET} from "./account-fixture.mjs";
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=", "base64");
export function memoryFeedbackBucket() {
  const objects = new Map();
  return {objects, async put(key, bytes) { objects.set(key, new Uint8Array(bytes)); }, async delete(key) { objects.delete(key); }, async get(key) { const bytes = objects.get(key); return bytes ? {body: new Uint8Array(bytes)} : null; }};
}
export function issueCode(f, email = "researcher@example.test", purpose = "feedback") {
  const hash = createHmac("sha256", TEST_JWT_SECRET).update(`${email}|${purpose}|123456`).digest("base64url");
  f.sql.prepare("INSERT INTO auth_verification_codes(email,purpose,code_hash,expires_at,created_at) VALUES(?,?,?,?,?)").run(email, purpose, hash, new Date(Date.now() + 600000).toISOString(), new Date().toISOString());
}
export const feedbackBody = {type: "bug", product_area: "license", title: "Renewal date did not update", description: "The expiry date is still yesterday after renewal.", contact_email: "researcher@example.test", feedback_verification_code: "123456"};
export function multipartFeedback(body = feedbackBody, files = [new File([PNG], "screenshot.png", {type: "image/png"})]) {
  const form = new FormData(); form.set("payload", JSON.stringify(body)); files.forEach((file) => form.append("attachments", file)); return form;
}
