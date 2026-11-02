import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { __dataSyncTest } from "../src/worker.js";

async function checkPagination({total=401, payloadBytes=2, offsetStart=0} = {}) {
  const secret = "pagination-contract-secret";
  const head = Buffer.from(JSON.stringify({alg:"HS256",typ:"JWT"})).toString("base64url");
  const claims = Buffer.from(JSON.stringify({user_id:7,type:"access",exp:Math.floor(Date.now()/1000)+600})).toString("base64url");
  const material = `${head}.${claims}`;
  const token = `${material}.${createHmac("sha256",secret).update(material).digest("base64url")}`;
  const seen = [];
  const db = { prepare(sql) { return {
    values: [], bind(...values) { this.values=values; return this; },
    async first() {
      if (sql.includes("FROM users")) return {id:7};
      if (sql.includes("FROM licenses")) return {license_id:"test-license",edition:"personal_standard",machine_fingerprint:"test-machine",is_active:1,revoked:0,expires_at:"2099-01-01"};
      if (sql.includes("COUNT(*)")) return {total};
      throw new Error("Unexpected query");
    },
    async all() {
      const [limit, offset] = this.values.slice(-2);
      assert.ok(limit>0 && limit<=200);
      const count=Math.max(0,Math.min(limit,total-offset));
      if (sql.includes("AS payload_bytes")) {
        return {results:Array.from({length:count},()=>({payload_bytes:payloadBytes}))};
      }
      assert.match(sql,/WHERE r\.rowid IN/);
      assert.match(sql,/SELECT r\.rowid FROM production_table_rows/);
      assert.match(sql,/r\.row_key ASC, r\.edition_scope ASC/);
      assert.ok(count<=1 || count*(payloadBytes+1024)<=2*1024*1024);
      return {results:Array.from({length:count},(_,i)=>({row_key:String(offset+i),row_json:"{}",updated_at:"2026-09-13T00:00:00Z"}))};
    }
  };}};
  let offset=offsetStart;
  do {
    const url=new URL(`https://api.example.invalid/v1/data-sync/tables/score_history/rows?license_id=test-license&machine_fingerprint=test-machine&module=target_research&limit=2000&offset=${offset}`);
    const response=await __dataSyncTest.getDataSyncTableRows({url,request:new Request(url,{headers:{Authorization:`Bearer ${token}`}}),env:{DB:db,JWT_SECRET:secret},tableName:"score_history"});
    const result=await response.json();
    assert.equal(response.status,200);
    assert.ok(result.page.limit>0 && result.page.limit<=200);
    seen.push(...result.results.map(r=>r.row_key));
    offset=result.page.offset+result.results.length;
    if (!result.page.has_more) break;
    assert.ok(result.results.length>0);
  } while (offset<total);
  assert.equal(seen.length,Math.max(0,total-offsetStart));
  assert.equal(new Set(seen).size,seen.length);
  if (seen.length) assert.equal(seen.at(-1),String(total-1));
}

test("rich score pages stay bounded and cover every row without gaps", async () => {
  await checkPagination();
});
test("large payloads shorten pages without losing rows at a high offset", async () => {
  await checkPagination({total:15401, offsetStart:15200, payloadBytes:126177});
});
test("one oversized row still advances the cursor", async () => {
  await checkPagination({total:3, payloadBytes:3*1024*1024});
});
test("empty pages have a positive limit and terminate", async () => {
  await checkPagination({total:0});
  await checkPagination({total:2,offsetStart:4});
});
