/** Owner maintenance transport. Credentials stay in memory; never in receipts.
 * The desktop upload button uses admin HTTP, not this local Wrangler helper.
 */
import {readFileSync} from 'node:fs';
import path from 'node:path';

const account = '8d68e7fd97987e033ad916a4afef544a';
const database = '44338085-38a1-4283-b6c9-91fb0d78e0ac';
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`;
const check = (ok, message) => { if (!ok) throw new Error(message); };

export function boundBatches(statements, {maxBytes=512*1024, maxStatements=4}={}) {
  check(Number.isInteger(maxBytes) && maxBytes>0 && Number.isInteger(maxStatements) && maxStatements>0, 'invalid batch limits');
  const batches=[];
  let batch=[];
  const bytes=value=>Buffer.byteLength(JSON.stringify({batch:value}), 'utf8');
  for (const item of statements) {
    check(typeof item.sql==='string' && Array.isArray(item.params) && bytes([item])<=maxBytes,
      'bound minute statement exceeds batch budget');
    if (batch.length && (batch.length===maxStatements || bytes([...batch,item])>maxBytes)) {
      batches.push(batch); batch=[];
    }
    batch.push(item);
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export function ownerToken() {
  // Use only the existing owner login. Never copy it into the workspace,
  // subprocess arguments, customer builds, stdout or exception messages.
  check(process.env.APPDATA, 'existing local Wrangler owner login required');
  const file=path.join(process.env.APPDATA,'xdg.config','.wrangler','config','default.toml');
  let raw;
  try { raw=readFileSync(file,'utf8'); } catch { throw new Error('existing local Wrangler owner login required'); }
  const match=raw.match(/^oauth_token\s*=\s*("(?:[^"\\]|\\.)*")\s*$/m);
  check(match, 'existing local Wrangler owner login required');
  return JSON.parse(match[1]);
}

export function ownerD1(token, {fetchImpl=fetch, retryDelay=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  check(typeof token==='string' && token.length>0, 'owner authorization required');
  async function execute(batch, {readonly=false}={}) {
    check(batch.length>0 && batch.every(s=>typeof s.sql==='string' && Array.isArray(s.params)), 'bound query required');
    if (readonly) check(batch.every(s=>/^\s*SELECT\b/i.test(s.sql)), 'owner read must be SELECT');
    const payload=JSON.stringify({batch});
    for (let attempt=0; attempt<3; attempt++) {
      let response;
      try {
        response=await fetchImpl(endpoint,{method:'POST',redirect:'error',headers:{
          Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:payload,
          signal:AbortSignal.timeout(60000)});
      } catch {
        if (attempt<2) { await retryDelay(1000*(attempt+1)); continue; }
        throw new Error('Cloudflare owner bound query connection failed; raw errors not logged');
      }
      if ((response.status===429 || response.status>=500) && attempt<2) {
        await retryDelay(1000*(attempt+1)); continue;
      }
      // Don't log API error bodies: they may echo submitted data or headers.
      check(response.ok, `Cloudflare owner bound query failed (HTTP ${response.status})`);
      let data;
      try { data=await response.json(); } catch { throw new Error('Cloudflare owner query invalid JSON'); }
      check(data.success===true && Array.isArray(data.result) && data.result.length===batch.length &&
        data.result.every(r=>r.success===true && Array.isArray(r.results)), 'Cloudflare owner bound query rejected');
      if (readonly) check(data.result.every(r=>r.meta?.rows_written===0), 'owner SELECT mutated source');
      return data.result;
    }
  }
  return {execute, async select(sql,params=[]) { return (await execute([{sql,params}],{readonly:true}))[0].results; }};
}
