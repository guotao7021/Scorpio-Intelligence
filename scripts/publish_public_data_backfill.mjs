/** Only owner-authorized source-sealed hourly/NAV backfills. No HTTP auth bypass. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {canonical,digest} from '../cloudflare/license-api/src/minute-delivery.mjs';
import {__productionUploadMaintenanceTest as uploader} from '../cloudflare/license-api/src/worker.js';
import {hourlyRetentionWindow} from '../cloudflare/license-api/src/hourly-retention.mjs';
import {sqlLiteral,wranglerJson} from './publish_minute_beta.mjs';
import {mobileTrapSignals} from '../cloudflare/license-api/src/mobile-risk-details.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),cloud=path.join(root,'cloudflare/license-api');
const exec=promisify(execFile);
function check(value,msg){if(!value)throw new Error(msg);}
export function literal(v){if(v===null)return 'NULL';if(typeof v==='number'){check(Number.isFinite(v),'invalid SQL number');return String(v);}return sqlLiteral(v);}
export function render(sql,args){let i=0;const result=sql.replace(/\?/g,()=>literal(args[i++]));check(i===args.length,'binding mismatch');return result+';';}
export async function loadPlan(file){
  const w=JSON.parse(readFileSync(file,'utf8'));
  check(w.version==='production-owner-backfill-file.v1'&&Object.keys(w).sort().join(',')==='content_hash,payload_json,version'&&
    await digest(w.payload_json)===w.content_hash,'unsealed source plan');
  const p=JSON.parse(w.payload_json);
  check(Object.keys(p).sort().join(',')==='edition_scope,manifest_json,module,reference_day,rows,sample_codes,source_readonly,source_write_count,table_name,version'&&
    p.version==='production-owner-backfill-input.v1'&&p.source_readonly===true&&p.source_write_count===0&&p.edition_scope==='standard_pro', 'invalid source plan');
  check(['stock_hourly_history','fund_nav_daily','stock_signal_observation_daily','stock_info'].includes(p.table_name)&&p.module===(['fund_nav_daily','stock_info'].includes(p.table_name)?'target_research':'market_context'),'table outside bounded backfill scope');
  check(Array.isArray(p.rows)&&p.rows.length<=20000&&new Set(p.rows.map(r=>r.row_key)).size===p.rows.length,'invalid rows');
  const fields=p.table_name==='stock_info'?['code','name','industry','sector','market','list_date','status','created_at','updated_at','source',
    'listing_board','listing_board_source','listing_board_available_on','listing_board_source_hash']:p.table_name==='stock_signal_observation_daily'?['code','business_date','batch_id','snapshot_json','updated_at']:p.table_name==='stock_hourly_history'?['code','trade_date','interval_minutes','data_source','price_basis','snapshot_id','available_at','quality_status','bars_json','updated_at']:
    ['fund_code','nav_date','nav','acc_nav','daily_return_pct','source','updated_at'];
  for(const r of p.rows){
    check(Object.keys(r).sort().join(',')==='data_date,row_hash,row_json,row_key'&&await digest(r.row_json)===r.row_hash,'source row hash changed');
    const data=JSON.parse(r.row_json);
    check(Object.keys(data).every(k=>fields.includes(k)),'private source fields');
    const code=data.code||data.fund_code,date=data.trade_date||data.nav_date||data.business_date||data.updated_at;
    check(/^\d{6}$/.test(code)&&(p.table_name==='stock_info'?/^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/:/^\d{4}-\d{2}-\d{2}$/).test(date)&&r.data_date===date&&
      r.row_key===await digest(p.table_name==='stock_info'?`stock_info|${code}`:p.table_name==='stock_signal_observation_daily'?`${p.table_name}|${date}|${code}`:`${p.table_name}|${code}|${date}`),'row identity changed');
    if(p.table_name==='stock_info') {
      check(date.slice(0,10)<=p.reference_day,'future master source');
      if(data.listing_board!==undefined) check(['主板','创业板','科创板','北交所'].includes(data.listing_board)&&
        data.listing_board_source==='bq_stock_basic_info.security_type'&&/^\d{4}-\d{2}-\d{2}$/.test(data.listing_board_available_on)&&
        data.listing_board_available_on<=p.reference_day&&/^sha256:[a-f0-9]{64}$/.test(data.listing_board_source_hash),'unproven board identity');
    }
    if(p.table_name==='fund_nav_daily')check(p.sample_codes.includes(code)&&typeof data.nav==='number'&&data.nav>0&&date<=p.reference_day,'NAV outside sample or reference');
    if(p.table_name==='stock_signal_observation_daily') {
      const snapshot=JSON.parse(data.snapshot_json),{content_hash,...unsigned}=snapshot;
      check(Object.keys(data).length===fields.length && date===p.reference_day && snapshot.code===code &&
        data.batch_id===snapshot.batch_id && data.updated_at===snapshot.known_at &&
        Object.keys(snapshot).sort().join(',')==='batch_id,business_date,code,content_hash,display_only,input_revision_hash,known_at,orders_authorized,policy_hash,production_release_authorized,rules,source_hash,version' &&
        content_hash==='sha256:'+await digest(canonical(unsigned)),'signal source or private payload differs');
      const mapped=mobileTrapSignals({snapshot,code,day:date});
      check(mapped.length===22&&mapped.every(r=>r.batch_id===snapshot.batch_id &&
        r.state===snapshot.rules.find(s=>s.rule_id===r.id).assessment &&
        Object.keys(snapshot.rules.find(s=>s.rule_id===r.id)).sort().join(',')==='assessment,calibration_status,data_status,implementation,rule_id'),
        'signal display contract rejected');
    }
  }
  if(p.table_name==='stock_signal_observation_daily') {
    check(p.rows.length>0 && canonical(p.sample_codes)===canonical(p.rows.map(r=>JSON.parse(r.row_json).code).sort()),'complete signal population required');
    const snapshots=p.rows.map(r=>JSON.parse(JSON.parse(r.row_json).snapshot_json));
    check(['batch_id','known_at','input_revision_hash','policy_hash'].every(k=>new Set(snapshots.map(s=>s[k])).size===1),'mixed signal heads');
  }
  const m=JSON.parse(p.manifest_json);
  check(m.module===p.module&&m.edition_scope===p.edition_scope&&m.tables.length===1&&m.tables[0].table_name===p.table_name&&
    m.tables[0].mode===(p.table_name==='stock_info'?'full_replace':'incremental_upsert')&&m.estimated_rows===p.rows.length,'manifest differs from row plan');
  return {...p,inputHash:w.content_hash};
}
export function hourlyGuard(plan,now){
  const [first,next]=hourlyRetentionWindow(now),last=JSON.parse(plan.manifest_json).tables[0].retained_previous_date;
  check(last&&last<first&&plan.rows.every(r=>r.data_date===last),'only retained last day may be backfilled');
  return `NOT EXISTS(SELECT 1 FROM production_table_rows r JOIN production_upload_batches b ON b.batch_id=r.batch_id
    WHERE r.table_name='stock_hourly_history' AND r.edition_scope=${sqlLiteral(plan.edition_scope)} AND b.status='committed'
    AND json_valid(r.row_json) AND json_extract(r.row_json,'$.quality_status')='complete'
    AND julianday(json_extract(r.row_json,'$.available_at'))<=julianday(${sqlLiteral(now.toISOString())})
    AND ((r.data_date>=${sqlLiteral(first)} AND r.data_date<${sqlLiteral(next)}) OR (r.data_date>${sqlLiteral(last)} AND r.data_date<${sqlLiteral(first)})))`;
}
export function signalGuard(p) {
  check(/^\d{4}-\d{2}-\d{2}$/.test(p.reference_day),'signal date required');
  const known=JSON.parse(JSON.parse(p.rows[0].row_json).snapshot_json).known_at;
  return `(SELECT MAX(r.data_date) FROM production_table_rows r JOIN production_upload_batches b ON b.batch_id=r.batch_id
    WHERE r.table_name='score_history' AND r.module='target_research' AND b.status='committed'
    AND r.edition_scope IN ('standard','pro','standard_pro') AND COALESCE(json_extract(r.row_json,'$.asset_type'),'stock')='stock')=${sqlLiteral(p.reference_day)}
    AND NOT EXISTS(SELECT 1 FROM production_table_rows r JOIN production_upload_batches b ON b.batch_id=r.batch_id
    WHERE r.table_name='stock_signal_observation_daily' AND r.data_date=${sqlLiteral(p.reference_day)} AND b.status='committed'
    AND julianday(json_extract(json_extract(r.row_json,'$.snapshot_json'),'$.known_at'))>julianday(${sqlLiteral(known)}))`;
}
export async function buildSql(p,now=new Date()){
  const batch_id=`pu_owner_${p.table_name}_${p.inputHash.slice(0,24)}`,statements=[];
  const guard=p.table_name==='stock_hourly_history'?hourlyGuard(p,now):p.table_name==='stock_signal_observation_daily'?signalGuard(p):
    p.table_name==='stock_info'?`NOT EXISTS(SELECT 1 FROM production_table_rows r JOIN production_upload_batches b ON b.batch_id=r.batch_id
      WHERE r.table_name='stock_info' AND r.edition_scope='standard_pro' AND b.status='committed' AND substr(r.data_date,1,10)>${sqlLiteral(p.reference_day)})`:'1';
  const env={DB:{prepare(sql){return {bind(...args){return {async run(){
    let text=render(sql,args);
    if(sql.includes('INSERT INTO production_upload_batches')){
      // A racing same-ID write is a uniqueness failure, never an UPSERT reset.
      text=text.replace(/\s+ON CONFLICT\(batch_id\) DO UPDATE SET[\s\S]+$/,';');
      const module=literal(args[1]);
      const prefix=`VALUES (${literal(args[0])}, ${module},`;
      check(text.includes(prefix),'batch SQL contract changed');
      // module is NOT NULL. A retention change aborts the complete D1 import,
      // including all staging/normal rows and receipt, rather than leaving orphans.
      text=text.replace(prefix,`VALUES (${literal(args[0])}, CASE WHEN ${guard} THEN ${module} ELSE NULL END,`);
    }
    check(Buffer.byteLength(text,'utf8')<=100000,'owner SQL exceeds D1 statement byte limit; use smaller source chunks');
    statements.push(text);return {success:true};
  }};}};},async batch(items){for(const item of items)await item.run();return items.map(()=>({success:true}));}}};
  const batch=uploader.normalizeProductionUploadBatch({batch_id,module:p.module,edition_scope:p.edition_scope,
    source:'cloudflare_owner_source_backfill',table_count:1,row_count:p.rows.length,manifest:JSON.parse(p.manifest_json),manifest_hash:p.inputHash});
  await uploader.insertProductionUploadBatch(env,batch);
  let chunks=0;
  // HTTP uses bound parameters. Owner SQL imports inline public literals, so
  // the same logical chunk also needs a UTF-8 SQL-byte budget (D1:100KB).
  const maxBytes=p.rows.reduce((n,r)=>Math.max(n,Buffer.byteLength(r.row_json.replaceAll("'","''"),'utf8')+250),1);
  const chunkSize=p.table_name==='stock_signal_observation_daily'?Math.max(1,Math.min(500,Math.floor(80000/maxBytes))):500;
  for(let i=0;i<p.rows.length;i+=chunkSize){
    const rows=p.rows.slice(i,i+chunkSize).map(r=>({row_key:r.row_key,row_hash:r.row_hash,data_date:r.data_date,row:JSON.parse(r.row_json)}));
    const chunk=uploader.normalizeProductionUploadChunk({batch_id,table_name:p.table_name,module:p.module,edition_scope:p.edition_scope,
      mode:JSON.parse(p.manifest_json).tables[0].mode,chunk_index:++chunks,chunk_hash:await digest(canonical(rows)),rows},JSON.parse(p.manifest_json).tables[0].retained_previous_date,now);
    await uploader.storeProductionUploadChunk(env,chunk);
  }
  await env.DB.prepare("UPDATE production_upload_batches SET status='committing' WHERE batch_id=? AND status='receiving'").bind(batch_id).run();
  await uploader.commitProductionUploadBatch(env,batch,batch_id,p.rows.length,chunks,now.toISOString());
  return {batch_id,chunks,sql:statements.join('\n')};
}
export async function main(argv=process.argv.slice(2)){
  const a={apply:false};for(let i=0;i<argv.length;i++){
    if(argv[i]==='--apply'){a.apply=true;continue;}
    check(['--input','--output'].includes(argv[i])&&i+1<argv.length,'invalid argument');a[argv[i].slice(2)]=argv[++i];
  }
  const out=path.resolve(root,a.output||''),rel=path.relative(path.join(root,'outputs/public_data_backfill'),out);
  check(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel)&&!existsSync(out),'fresh exact backfill output required');
  const p=await loadPlan(path.resolve(root,a.input));mkdirSync(out,{recursive:true});
  async function query(value,file=false){try{
    const r=await exec(process.execPath,[path.join(cloud,'node_modules/wrangler/bin/wrangler.js'),'d1','execute','scorpio-license-db','--remote','--json',file?'--file':'--command',value],
      {cwd:cloud,encoding:'utf8',maxBuffer:16000000,timeout:60000});const data=wranglerJson(r.stdout);
    check(data.length===1&&data[0].success,'invalid remote result');if(!file)check(data[0].meta?.rows_written===0,'query must be read-only');return data[0].results;
  }catch(error){
    const code=typeof error.code==='number'?`exit_${error.code}`:error.killed?'timeout':'invalid_result';
    throw new Error(`Cloudflare owner ${file?'import':'read'} failed (${code}); credentials and raw errors not logged`);
  }}
  const now=new Date(),built=await buildSql(p,now);
  const readonlyEnv={DB:{prepare(sql){
    return {bind(...args){return {async first(){return (await query(render(sql,args)))[0];}};}};
  }}};
  if(p.table_name==='stock_hourly_history')await uploader.validateHourlyUploadRetention(readonlyEnv,
    {manifest_json:p.manifest_json,edition_scope:p.edition_scope},now);
  else if(p.table_name==='stock_signal_observation_daily') {
    const accepted=await query(`SELECT CASE WHEN ${signalGuard(p)} THEN 1 ELSE 0 END AS accepted;`);
    check(accepted[0]?.accepted===1,'signal day or published head changed');
  } else if(p.table_name!=='stock_info'){
    const members=await query(`SELECT DISTINCT json_extract(r.row_json,'$.code') AS code FROM production_table_rows r JOIN production_upload_batches b ON b.batch_id=r.batch_id
      WHERE r.table_name='score_history' AND r.module='target_research' AND b.status='committed' AND json_extract(r.row_json,'$.asset_type')='fund'
      AND r.data_date=${sqlLiteral(p.reference_day)} ORDER BY code;`);
    check(canonical(members.map(x=>x.code))===canonical(p.sample_codes),'fund sample changed; regenerate');
  }
  const existing=(await query(`SELECT status,manifest_hash FROM production_upload_batches WHERE batch_id=${sqlLiteral(built.batch_id)};`))[0];
  if(existing)check(existing.status==='committed'&&existing.manifest_hash===p.inputHash,'existing batch conflicts; no reset');
  const sql=path.join(out,'publish.sql');writeFileSync(sql,built.sql,{encoding:'utf8',flag:'wx'});
  let verified=false;
  if(a.apply&&p.rows.length){
    if(!existing)await query(sql,true);
    const rows=await query(`SELECT row_key,row_hash FROM production_table_rows WHERE batch_id=${sqlLiteral(built.batch_id)} AND table_name=${sqlLiteral(p.table_name)} AND edition_scope=${sqlLiteral(p.edition_scope)} ORDER BY row_key;`);
    const hashes=new Map(rows.map(r=>[r.row_key,r.row_hash]));check(hashes.size===p.rows.length&&p.rows.every(r=>hashes.get(r.row_key)===r.row_hash),'remote row readback mismatch');
    const receipt=(await query(`SELECT status,received_row_count,received_chunk_count,(SELECT COUNT(*) FROM production_upload_staging_rows WHERE batch_id=${sqlLiteral(built.batch_id)}) AS staging_rows FROM production_upload_batches WHERE batch_id=${sqlLiteral(built.batch_id)};`))[0];
    check(receipt.status==='committed'&&receipt.received_row_count===p.rows.length&&receipt.received_chunk_count===built.chunks&&receipt.staging_rows===0,'atomic receipt readback mismatch');
    verified=true;
  }
  const receipt={version:'production-owner-backfill-receipt.v1',checked_at:new Date().toISOString(),apply:a.apply,table_name:p.table_name,
    batch_id:built.batch_id,rows:p.rows.length,chunks:built.chunks,source_input_hash:p.inputHash,remote_readback_passed:verified,
    reused_committed_batch:Boolean(existing),source_write_count:0};
  receipt.content_hash=await digest(canonical(receipt));writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2),{encoding:'utf8',flag:'wx'});
  process.stdout.write(JSON.stringify(receipt)+'\n');return receipt;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{process.stderr.write(e.message+'\n');process.exitCode=1;});
