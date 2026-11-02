/** Owner-authorized batch publisher, sharing the live Beta schema and verifier. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical,digest} from '../cloudflare/license-api/src/minute-delivery.mjs';
import {prepareBetaPublication,betaInsertStatement,readBetaPublication} from '../cloudflare/license-api/src/minute-beta-direct.mjs';
import {sqlLiteral} from './publish_minute_beta.mjs';
import {boundBatches,ownerToken,ownerD1} from './minute_owner_d1.mjs';
import {readMarketMinuteObservation} from '../cloudflare/license-api/src/market-minute-observation.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function check(value,message){if(!value)throw new Error(message);}
export async function loadInput(file){
  const wrapper=JSON.parse(readFileSync(file,'utf8'));
  check(Object.keys(wrapper).sort().join(',')==='content_hash,payload_json,version' && wrapper.version==='sample-minute-direct-file.v1' &&
    await digest(wrapper.payload_json)===wrapper.content_hash,'unsealed sample transport');
  const p=JSON.parse(wrapper.payload_json);
  check(Object.keys(p).sort().join(',')==='business_date,generated_at,normal_daily_acceptance_passed,packages,sample_codes,source_readonly,source_replay_passed,version' &&
    p.version==='sample-minute-direct-input.v1'&&p.source_readonly===true&&p.source_replay_passed===true&&p.normal_daily_acceptance_passed===false,
    'verified read-only source required');
  check(/^\d{4}-\d{2}-\d{2}$/.test(p.business_date)&&Array.isArray(p.sample_codes)&&p.sample_codes.length<=1000&&
    p.sample_codes.every(c=>/^\d{6}$/.test(c))&&new Set(p.sample_codes).size===p.sample_codes.length,'invalid sample scope');
  check(Array.isArray(p.packages)&&p.packages.length>0&&p.packages.length<=p.sample_codes.length&&
    new Set(p.packages.map(x=>x.code)).size===p.packages.length&&p.packages.every(x=>p.sample_codes.includes(x.code)&&x.business_date===p.business_date&&
      Object.keys(x).sort().join(',')==='business_date,code,generated_at,packs'),'invalid public sample packages');
  return {...p,inputHash:wrapper.content_hash};
}
export function sampleSql(day){
  check(/^\d{4}-\d{2}-\d{2}$/.test(day),'invalid sample date');
  return `SELECT DISTINCT substr(UPPER(json_extract(r.row_json,'$.code')),1,6) AS code FROM production_table_rows r
    JOIN production_upload_batches b ON b.batch_id=r.batch_id WHERE r.table_name='score_history' AND r.module='target_research'
    AND b.status='committed' AND r.edition_scope IN ('standard','pro','standard_pro')
    AND COALESCE(json_extract(r.row_json,'$.asset_type'),'stock')='stock' AND r.data_date=${sqlLiteral(day)} ORDER BY code;`;
}
export async function verifyReadback(rows,packages,now=new Date()){
  const byCode=new Map(rows.map(r=>[r.code,r]));
  const env={MINUTE_BETA_DIRECT_ENABLED:'1',DB:{prepare(){return {bind(code){return {async first(){return byCode.get(code)||null;}};}};}}};
  const results=[];
  for(const p of packages){
    const served=await readBetaPublication(env,{code:p.code,businessDate:p.business_date,editionScopes:['standard_pro'],clientVersion:'0.3.0-beta.23'},now);
    check(served.status==='published'&&served.publication_id===p.publication_id&&canonical(served.packs)===canonical(p.packs),'sample remote serving verification failed');
    results.push({code:p.code,business_date:p.business_date,publication_id:p.publication_id,
      remote_readback_passed:true,scopes:p.packs.map(x=>JSON.parse(x.payload_json).scope)});
  }
  return results;
}
export async function main(argv=process.argv.slice(2)){
  const a={apply:false};for(let i=0;i<argv.length;i++){
    if(argv[i]==='--apply'){a.apply=true;continue;}
    check(['--input','--output','--expires-at'].includes(argv[i])&&i+1<argv.length,'invalid argument');
    a[argv[i].slice(2).replaceAll('-','_')]=argv[++i];
  }
  const out=path.resolve(root,a.output||''),allowed=path.join(root,'outputs/minute_public_results'),rel=path.relative(allowed,out);
  check(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel)&&!existsSync(out),'fresh exact output required');
  const p=await loadInput(path.resolve(root,a.input));mkdirSync(out,{recursive:true});
  const owner=ownerD1(ownerToken());
  const query=(sql,params=[])=>owner.select(sql,params);
  const members=await query(sampleSql(p.business_date));
  check(canonical(members.map(x=>x.code))===canonical(p.sample_codes),'published sample changed; regenerate');
  const headsSql=`SELECT p.*,v.publication_id AS revoked_id FROM minute_beta_publications p LEFT JOIN minute_beta_revocations v ON v.publication_id=p.publication_id
    WHERE p.business_date=? AND p.code IN (CODES) AND NOT EXISTS(SELECT 1 FROM minute_beta_publications n WHERE n.code=p.code AND n.business_date=p.business_date AND n.seq>p.seq);`;
  async function readHeads(codes) {
    const rows=[];
    // Bound reads avoid buffering the entire 20+ MiB publication set at once.
    for(let offset=0;offset<codes.length;offset+=20) {
      const slice=codes.slice(offset,offset+20);
      rows.push(...await query(headsSql.replace('CODES',slice.map(()=>'?').join(',')),[p.business_date,...slice]));
    }
    return rows;
  }
  const heads=new Map((await readHeads(p.packages.map(r=>r.code))).map(x=>[x.code,x]));
  const planned=[],statements=[],now=new Date();
  const hasMarket=r=>r.packs.some(x=>JSON.parse(x.payload_json).scope==='market' && JSON.parse(x.payload_json).market_session);
  check(p.packages.some(hasMarket),'market minute business result required');
  for(const r of [...p.packages].sort((a,b)=>Number(hasMarket(a))-Number(hasMarket(b)) || a.code.localeCompare(b.code))){
    const signature=r.packs.map(x=>x.content_hash).sort().join(':');
    let publication_id='beta-auto-'+(await digest(canonical([r.code,r.business_date,signature,'standard_pro']))).slice(0,40);
    const head=heads.get(r.code);
    if(head && canonical(JSON.parse(head.envelope_json).packs)===canonical(r.packs)) {
      check(!head.revoked_id,'withdrawn head requires review');
      publication_id=head.publication_id;
      planned.push({...r,publication_id});continue;
    }
    check(!head?.revoked_id,'withdrawn head requires review');
    const body={version:'minute-beta-direct.v1',channel:'beta',publication_id,code:r.code,business_date:r.business_date,
      generated_at:r.generated_at,packs:r.packs,expected_previous_publication_id:heads.get(r.code)?.publication_id||'',
      edition_scopes:['standard_pro'],expires_at:a.expires_at,min_client_version:'0.3.0',display_only:true,
      normal_daily_acceptance_passed:false};
    if(heads.get(r.code)?.publication_id===publication_id){
      const existing=JSON.parse(heads.get(r.code).envelope_json);
      check(existing.expires_at===a.expires_at&&canonical(existing.packs)===canonical(r.packs), 'existing publication differs; regenerate');
    }
    const prepared=await prepareBetaPublication(body,'cloudflare-owner-cli',now);
    const stmt=betaInsertStatement(prepared);
    // Membership is also checked inside the atomic write, not just in preflight.
    const guard=` AND EXISTS(SELECT 1 FROM production_table_rows r JOIN production_upload_batches b ON b.batch_id=r.batch_id
      WHERE r.table_name='score_history' AND r.module='target_research' AND b.status='committed'
      AND r.edition_scope IN ('standard','pro','standard_pro')
      AND COALESCE(json_extract(r.row_json,'$.asset_type'),'stock')='stock' AND r.data_date=${sqlLiteral(r.business_date)}
      AND substr(UPPER(json_extract(r.row_json,'$.code')),1,6)=${sqlLiteral(r.code)})`;
    statements.push({sql:stmt.sql+guard,params:stmt.args});planned.push({...r,publication_id});
  }
  const batches=boundBatches(statements);
  // Persist public plan only; no authorization headers or local login material.
  writeFileSync(path.join(out,'bound-plan.json'),JSON.stringify({version:'minute-owner-bound-plan.v1',batches}),{encoding:'utf8',flag:'wx'});
  let results=[],marketReadback=null;
  if(a.apply){
    for(const [index,batch] of batches.entries()) {
      await owner.execute(batch);
      process.stdout.write(JSON.stringify({phase:'bound_publish',completed:index+1,total:batches.length})+'\n');
    }
    results=await verifyReadback(await readHeads(planned.map(r=>r.code)),planned);
    // Re-read heads/revocations after package verification; never bless an old
    // result if another producer or withdrawal changed it in the meantime.
    await verifyReadback(await readHeads(planned.map(r=>r.code)),planned);
    check(canonical((await query(sampleSql(p.business_date))).map(x=>x.code))===canonical(p.sample_codes),'sample changed after publish');
    const env={MINUTE_BETA_DIRECT_ENABLED:'1',DB:{prepare(sql){return {bind(...params){return {
      async first(){return (await query(sql,params))[0]||null;}};}};}}};
    const market=await readMarketMinuteObservation(env,{businessDate:p.business_date,
      editionScopes:['standard_pro'],clientVersion:'0.3.0-beta.23'},new Date());
    check(['available','partial'].includes(market.status) && market.session?.points.length===48 &&
      planned.some(r=>r.publication_id===market.publication_id),'market minute remote serving verification failed');
    marketReadback={status:market.status,publication_id:market.publication_id,points:market.session.points.length};
  }
  const receipt={version:'sample-minute-beta-receipt.v1',checked_at:new Date().toISOString(),apply:a.apply,
    source_input_hash:p.inputHash,business_date:p.business_date,stock_days:planned.length,
    pack_count:planned.reduce((n,x)=>n+x.packs.length,0),results,market_readback:marketReadback,
    pending_codes:p.sample_codes.filter(c=>!planned.some(r=>r.code===c)),
    statement_count:statements.length,batch_count:batches.length,normal_daily_acceptance_passed:false,
    source_write_count:0,candidate_or_approval_created:false,authenticated_user_acceptance_passed:false};
  receipt.content_hash=await digest(canonical(receipt));writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2),{encoding:'utf8',flag:'wx'});
  process.stdout.write(JSON.stringify({apply:a.apply,stock_days:receipt.stock_days,packs:receipt.pack_count,remote_readback:a.apply})+'\n');
  return receipt;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{process.stderr.write(e.message+'\n');process.exitCode=1;});
