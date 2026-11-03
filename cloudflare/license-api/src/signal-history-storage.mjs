/** Lossless public-only history archives. No account/raw-research tables. */
import {canonical} from './minute-delivery.mjs';

export const SIGNAL_TABLE = 'stock_signal_observation_daily';
const TABLES = new Map([[SIGNAL_TABLE,5],['stock_daily_latest',5],['stock_daily_ohlcv',60],['stock_risk_metrics',5]]);
const COLUMNS = ['table_name','row_key','row_hash','row_json','data_date','edition_scope','module','batch_id','updated_at'];
const MAX_ROWS = 1024, MAX_RAW = 8 * 1024 * 1024, MAX_GZIP = 4 * 1024 * 1024;
const enc = new TextEncoder();
function check(ok, code) { if (!ok) throw Object.assign(new Error(code), {status:409, publicMessage:code}); }
function integer(value, fallback, low, high) {
  const v = value === undefined || value === '' ? fallback : Number(value);
  check(Number.isSafeInteger(v) && v >= low && v <= high, 'signal_storage_policy_invalid');
  return v;
}
export function storagePolicy(env) {
  return {hot_days:integer(env.SIGNAL_HISTORY_HOT_DAYS,5,2,20),
    d1_soft_bytes:integer(env.D1_STORAGE_SOFT_BYTES,4000000000,1000000,5000000000),
    d1_hard_bytes:integer(env.D1_STORAGE_HARD_BYTES,4500000000,1000000,5000000000),
    r2_archive_budget_bytes:integer(env.SIGNAL_ARCHIVE_BUDGET_BYTES,2000000000,1000000,8000000000)};
}
export async function storageBudget(env) {
  const p = storagePolicy(env);
  check(p.d1_soft_bytes < p.d1_hard_bytes, 'signal_storage_policy_invalid');
  const probe = await env.DB.prepare('SELECT 1 AS storage_probe').all();
  const used = probe.meta?.size_after;
  return {...p,d1_bytes:Number.isSafeInteger(used)?used:null,
    d1_state:!Number.isSafeInteger(used)?'unknown':used>=p.d1_hard_bytes?'hard_limit':used>=p.d1_soft_bytes?'warning':'within_budget',
    account_total_or_R2_usage_certified:false};
}
export async function assertUploadStorageBudget(env, incomingBytes=0) {
  const p = await storageBudget(env);
  // 4x is an explicit conservative staging/publication/index reserve, not a
  // prediction of physical usage. Unknown measurements fail closed.
  check(p.d1_bytes !== null, 'production_upload_storage_measurement_unavailable');
  check(p.d1_bytes + incomingBytes * 4 < p.d1_hard_bytes, 'production_upload_storage_budget_exceeded');
  return p;
}
function scope(value) {
  const table = value.table_name || SIGNAL_TABLE;
  check(TABLES.has(table), 'signal_archive_table_not_allowed');
  check(['standard','pro','standard_pro'].includes(value.edition_scope), 'signal_archive_public_scope_required');
  check(/^\d{4}-\d{2}-\d{2}$/.test(value.data_date) && /^[0-9a-f]$/.test(value.key_prefix), 'signal_archive_partition_invalid');
  return {table_name:table,edition_scope:value.edition_scope,data_date:value.data_date,key_prefix:value.key_prefix};
}
function range(prefix) { return [prefix, prefix === 'f' ? 'g' : (parseInt(prefix,16)+1).toString(16)]; }
async function active(env) {
  return Boolean(await env.DB.prepare("SELECT 1 AS active FROM production_upload_batches WHERE status IN ('created','receiving','committing') LIMIT 1").first());
}
async function hotDates(env, table, edition, keep) {
  // Serving rows are published atomically with their committed batch. Keep all
  // served dates conservatively, using the covering lookup index. Exact cold
  // archive reads still require committed lineage and the expected module.
  const r = await env.DB.prepare(`SELECT DISTINCT data_date FROM production_table_rows
    WHERE table_name=? AND edition_scope=? ORDER BY data_date DESC LIMIT ?`).bind(table,edition,keep).all();
  return r.results.map(v=>v.data_date);
}
function validateRows(rows, partition) {
  check(rows.length>0 && rows.length<=MAX_ROWS, 'signal_archive_partition_size_invalid');
  let previous='';
  for(const r of rows) {
    check(Object.keys(r).sort().join(',')===[...COLUMNS].sort().join(','), 'signal_archive_columns_changed');
    check(r.table_name===partition.table_name && r.module==='market_context' && r.edition_scope===partition.edition_scope &&
      r.data_date===partition.data_date && r.row_key.startsWith(partition.key_prefix) && r.row_key>previous,
      'signal_archive_row_scope_invalid');
    const row=JSON.parse(r.row_json);
    if (r.table_name!==SIGNAL_TABLE) {
      check(row && typeof row==='object' && !Array.isArray(row), 'signal_archive_row_invalid');
      previous=r.row_key; continue;
    }
    const snapshot=JSON.parse(row.snapshot_json);
    check(Object.keys(row).sort().join(',')==='batch_id,business_date,code,snapshot_json,updated_at' &&
      /^\d{6}$/.test(row.code) && row.business_date===r.data_date &&
      snapshot.version==='mobile-stock-signals.v1' && snapshot.code===row.code && snapshot.business_date===r.data_date &&
      snapshot.display_only===true && snapshot.orders_authorized===false && snapshot.production_release_authorized===false,
      'signal_archive_not_public_projection');
    previous=r.row_key;
  }
}
async function readLimited(stream, limit) {
  const reader=stream.getReader(), chunks=[];let size=0;
  try {
    while(true) {const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      check(size<=limit,'signal_archive_decode_limit');chunks.push(value);}
  } catch(error) {await reader.cancel();throw error;}
  const raw=new Uint8Array(size);let offset=0;for(const c of chunks){raw.set(c,offset);offset+=c.length;}return raw;
}
async function bytesHash(bytes) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join(''); }
async function decodeArchive(object, receipt) {
  check(object && receipt.r2_key.startsWith('public-history/signals/v1/'),'signal_archive_object_missing');
  const gzip=new Uint8Array(await object.arrayBuffer());
  check(gzip.byteLength===receipt.gzip_bytes && await bytesHash(gzip)===receipt.gzip_hash,'signal_archive_gzip_hash_differs');
  const raw=await readLimited(new Blob([gzip]).stream().pipeThrough(new DecompressionStream('gzip')),MAX_RAW);
  check(raw.byteLength===receipt.raw_bytes && await bytesHash(raw)===receipt.raw_hash,'signal_archive_raw_hash_differs');
  const pack=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  check(pack.version==='public-signal-history.v1' && canonical(pack.partition)===canonical(scope(receipt)) && pack.rows.length===receipt.row_count,'signal_archive_envelope_differs');
  validateRows(pack.rows,pack.partition);return pack;
}
export async function readSignalArchive(env, id) {
  check(/^sha256:[0-9a-f]{64}$/.test(id),'signal_archive_id_invalid');
  const receipt=await env.DB.prepare('SELECT * FROM production_signal_archives WHERE archive_id=?').bind(id).first();
  check(receipt && receipt.state!=='pending','signal_archive_not_verified');
  const pack=await decodeArchive(await env.RELEASE_BUCKET.get(receipt.r2_key),receipt);
  return {receipt,pack};
}
export async function archiveSignalPrefix(env, input) {
  const partition=scope(input), policy=storagePolicy(env);
  check(env.RELEASE_BUCKET,'signal_archive_bucket_missing');
  const [lo,hi]=range(partition.key_prefix);
  const rows=(await env.DB.prepare(`SELECT ${COLUMNS.map(c=>'r.'+c).join(',')} FROM production_table_rows r
    JOIN production_upload_batches b ON b.batch_id=r.batch_id
    WHERE r.table_name=? AND r.edition_scope=? AND r.data_date=? AND r.module='market_context'
      AND r.row_key>=? AND r.row_key<? AND b.status='committed' ORDER BY r.row_key LIMIT ?`)
    .bind(partition.table_name,partition.edition_scope,partition.data_date,lo,hi,MAX_ROWS+1).all()).results;
  if(!rows.length)return {status:'empty',partition};
  validateRows(rows,partition);
  const raw=enc.encode(canonical({version:'public-signal-history.v1',partition,rows}));
  check(raw.byteLength<=MAX_RAW,'signal_archive_raw_size_limit');
  const gzip=await readLimited(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip')),MAX_GZIP);
  const rawHash=await bytesHash(raw), gzipHash=await bytesHash(gzip), id='sha256:'+rawHash;
  const r2key=`public-history/signals/v1/${partition.table_name}/${partition.edition_scope}/${partition.data_date}/${partition.key_prefix}/${rawHash}.json.gz`;
  if(input.dry_run!==false)return {status:'preview',partition,archive_id:id,row_count:rows.length,raw_bytes:raw.length,gzip_bytes:gzip.length,r2_key:r2key};
  await env.DB.prepare(`INSERT OR IGNORE INTO production_signal_archives
    (archive_id,table_name,edition_scope,data_date,key_prefix,row_count,raw_bytes,gzip_bytes,raw_hash,gzip_hash,r2_key,state)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,'pending' WHERE
      (SELECT COALESCE(SUM(gzip_bytes),0) FROM production_signal_archives)+?<=?`)
    .bind(id,partition.table_name,partition.edition_scope,partition.data_date,partition.key_prefix,rows.length,raw.length,gzip.length,rawHash,gzipHash,r2key,gzip.length,policy.r2_archive_budget_bytes).run();
  const receipt=await env.DB.prepare('SELECT * FROM production_signal_archives WHERE archive_id=?').bind(id).first();
  check(receipt && receipt.r2_key===r2key && receipt.gzip_hash===gzipHash,'signal_archive_budget_or_identity_conflict');
  // Reserved bytes include interrupted writes. A retry cannot double-count or
  // delete a reservation that could still own an object.
  let object=await env.RELEASE_BUCKET.get(r2key);
  if(!object) {
    await env.RELEASE_BUCKET.put(r2key,gzip,{onlyIf:{etagDoesNotMatch:'*'},
      httpMetadata:{contentType:'application/gzip'},customMetadata:{raw_hash:rawHash,gzip_hash:gzipHash}});
    object=await env.RELEASE_BUCKET.get(r2key);
  }
  await decodeArchive(object,receipt);
  await env.DB.prepare("UPDATE production_signal_archives SET state=CASE WHEN state='pruned' THEN state ELSE 'verified' END,verified_at=? WHERE archive_id=?")
    .bind(new Date().toISOString(),id).run();
  return {status:'verified',archive_id:id,row_count:rows.length,raw_bytes:raw.length,gzip_bytes:gzip.length,r2_key:r2key,partition};
}
// Match the existing asset-code expression index. Missing identities are never
// eligible for deletion; last-per-asset coverage survives sparse new batches.
function assetCode(alias='') {
  const j=alias ? alias+'.row_json' : 'row_json';
  return `UPPER(CASE WHEN json_valid(${j}) THEN COALESCE(${['code','stock_code','symbol','ts_code','asset_code','fund_code','bond_code'].map(k=>`json_extract(${j}, '$.${k}')`).join(',')},'') ELSE '' END)`;
}
export async function attestLocalArchive(env, input) {
  const {receipt}=await readSignalArchive(env,input.archive_id);
  check(input.gzip_hash===receipt.gzip_hash && input.raw_hash===receipt.raw_hash &&
    input.gzip_bytes===receipt.gzip_bytes && input.row_count===receipt.row_count &&
    input.local_readback_verified===true, 'signal_archive_local_copy_proof_required');
  await env.DB.prepare('UPDATE production_signal_archives SET local_copy_hash=?,local_verified_at=? WHERE archive_id=?')
    .bind(receipt.gzip_hash,new Date().toISOString(),input.archive_id).run();
  return {status:'local_copy_attested',archive_id:input.archive_id};
}
export async function pruneSignalArchive(env, id, input={}) {
  check(!await active(env),'signal_archive_active_upload');
  const {receipt,pack}=await readSignalArchive(env,id);
  check(receipt.local_copy_hash===receipt.gzip_hash && receipt.local_verified_at &&
    input.local_copy_hash===receipt.gzip_hash, 'signal_archive_local_copy_proof_required');
  const completed=await env.DB.prepare("SELECT batch_id FROM production_upload_batches WHERE batch_id=? AND status='committed'")
    .bind(input.completed_batch_id || '').first();
  check(completed && input.unified_upload_completed===true,'signal_archive_completed_upload_required');
  const budget=await storageBudget(env);
  check(budget.d1_bytes!==null && budget.d1_bytes>=budget.d1_soft_bytes,'signal_archive_no_budget_pressure');
  const keep=receipt.table_name==='stock_daily_ohlcv'?60:storagePolicy(env).hot_days;
  const recent=await hotDates(env,receipt.table_name,receipt.edition_scope,keep);
  check(!recent.includes(receipt.data_date),'signal_archive_hot_day_protected');
  // Each delete carries exact original bytes and lineage. Concurrent revised
  // rows survive; active uploads and a changed retention fence veto the batch.
  const statements=[];
  for(let at=0;at<pack.rows.length;at+=12) {
    const rows=pack.rows.slice(at,at+12);
    const guards=rows.map(()=>'(row_key=? AND row_hash=? AND row_json=? AND batch_id=? AND updated_at=?)').join(' OR ');
    statements.push(env.DB.prepare(`DELETE FROM production_table_rows WHERE table_name=? AND edition_scope=? AND data_date=?
      AND module='market_context' AND (${guards})
      AND NOT EXISTS(SELECT 1 FROM production_upload_batches WHERE status IN ('created','receiving','committing'))
      AND ${assetCode()}<>''
      AND (SELECT COUNT(DISTINCT newer.data_date) FROM production_table_rows newer
        WHERE newer.table_name=production_table_rows.table_name AND newer.edition_scope=production_table_rows.edition_scope
        AND ${assetCode('newer')}=${assetCode('production_table_rows')}
        AND COALESCE(json_extract(newer.row_json,'$.data_source'),'')=COALESCE(json_extract(production_table_rows.row_json,'$.data_source'),'')
        AND newer.data_date>production_table_rows.data_date)>=?
      AND data_date NOT IN (SELECT DISTINCT data_date FROM production_table_rows WHERE table_name=? AND edition_scope=?
        AND module='market_context' ORDER BY data_date DESC LIMIT ?)`)
      .bind(receipt.table_name,receipt.edition_scope,receipt.data_date,...rows.flatMap(r=>[r.row_key,r.row_hash,r.row_json,r.batch_id,r.updated_at]),
        receipt.table_name==='stock_daily_ohlcv'?60:1,receipt.table_name,receipt.edition_scope,keep));
  }
  const result=await env.DB.batch(statements);
  const deleted=result.reduce((n,r)=>n+(r.meta?.changes||0),0);
  await env.DB.prepare("UPDATE production_signal_archives SET state='pruned',pruned_rows=pruned_rows+? WHERE archive_id=?").bind(deleted,id).run();
  return {status:'pruned',archive_id:id,deleted_rows:deleted,archive_preserved:true};
}
export async function signalStoragePlan(env) {
  const policy=storagePolicy(env), budget=await storageBudget(env);
  // Inventory only: use the covering lookup index rather than opening every
  // rich row to join its batch. Exact archive reads recheck committed lineage.
  const partitions=(await env.DB.prepare(`SELECT table_name,edition_scope,data_date,COUNT(*) AS row_count
    FROM production_table_rows WHERE table_name IN (?,?,?,?) AND edition_scope IN ('standard','pro','standard_pro')
    GROUP BY table_name,edition_scope,data_date ORDER BY data_date DESC LIMIT 1024`).bind(...TABLES.keys()).all()).results;
  const windows=new Map();
  for(const p of partitions) {
    const key=p.table_name+':'+p.edition_scope;
    if(!windows.has(key))windows.set(key,await hotDates(env,p.table_name,p.edition_scope,p.table_name==='stock_daily_ohlcv'?60:policy.hot_days));
    p.hot=windows.get(key).includes(p.data_date);
  }
  const reserved=await env.DB.prepare('SELECT COALESCE(SUM(gzip_bytes),0) AS bytes,COUNT(*) AS objects FROM production_signal_archives').first();
  const latest=await env.DB.prepare("SELECT batch_id FROM production_upload_batches WHERE status='committed' ORDER BY committed_at DESC LIMIT 1").first();
  return {version:'signal-storage-budget.v1',budget,partitions,reserved_R2:reserved,active_upload:await active(env),
    latest_committed_batch_id:latest?.batch_id || '',automatic_deletion:false,deletion_scope:[...TABLES.keys()],
    maintenance_trigger:'local_owner_after_all_upload_stages_succeed_and_budget_pressure',
    historical_restore:'verified local gzip first; bounded R2 recovery copy; last per-asset snapshot and 60 OHLC sessions protected'};
}
export function registerSignalStorageRoutes({route,requireAdmin,readJson,json}) {
  route('GET','/v1/scorpio_v1_admin/storage-budget',async ctx=>{requireAdmin(ctx);return json(await signalStoragePlan(ctx.env));});
  route('POST','/v1/scorpio_v1_admin/storage-budget/signal-archive',async ctx=>{
    requireAdmin(ctx);return json(await archiveSignalPrefix(ctx.env,await readJson(ctx.request)));});
  route('POST','/v1/scorpio_v1_admin/storage-budget/signal-prune',async ctx=>{
    requireAdmin(ctx);const b=await readJson(ctx.request);check(b.apply===true,'signal_archive_apply_required');return json(await pruneSignalArchive(ctx.env,b.archive_id,b));});
  route('POST','/v1/scorpio_v1_admin/storage-budget/plan',async ctx=>{requireAdmin(ctx);return json(await signalStoragePlan(ctx.env));});
  route('POST','/v1/scorpio_v1_admin/storage-budget/local-copy',async ctx=>{
    requireAdmin(ctx);return json(await attestLocalArchive(ctx.env,await readJson(ctx.request)));});
  route('POST','/v1/scorpio_v1_admin/storage-budget/archive-download',async ctx=>{
    requireAdmin(ctx);const b=await readJson(ctx.request),{receipt}=await readSignalArchive(ctx.env,b.archive_id);
    const bytes=new Uint8Array(await (await ctx.env.RELEASE_BUCKET.get(receipt.r2_key)).arrayBuffer());
    check(await bytesHash(bytes)===receipt.gzip_hash,'signal_archive_gzip_hash_differs');
    let binary='';for(let at=0;at<bytes.length;at+=8192)binary+=String.fromCharCode(...bytes.subarray(at,at+8192));
    return json({receipt,gzip_base64:btoa(binary)});});
  route('GET','/v1/scorpio_v1_admin/storage-budget/signal-readback',async ctx=>{
    requireAdmin(ctx);return json(await readSignalArchive(ctx.env,ctx.url.searchParams.get('archive_id')));});
}
