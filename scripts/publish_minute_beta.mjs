/** Owner-authorized single-step Beta publication. Uses no business admin secret.
 * Existing sealed source audit binds each input; shares Worker validation/storage.
 * Dry-run by default. No candidates, approvals, sample or license mutations.
 */
import {readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {canonical,digest,readPublication} from '../cloudflare/license-api/src/minute-delivery.mjs';
import {prepareBetaPublication,publishBetaDirect} from '../cloudflare/license-api/src/minute-beta-direct.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cloud=path.join(root,'cloudflare/license-api');
const outputRoot=path.join(root,'outputs/minute_public_results');
const exec=promisify(execFile);
function check(ok,message){if(!ok)throw new Error(message);}
export function sqlLiteral(value) {
  check(typeof value==='string' && !value.includes('\0'),'SQL string required');
  return `'${value.replaceAll("'","''")}'`;
}
export function boundSql(sql,args) {
  let index=0;const rendered=sql.replace(/\?/g,()=>sqlLiteral(args[index++]));
  check(index===args.length,'SQL binding count mismatch');return rendered+';';
}
export function wranglerJson(stdout) {
  // Wrangler SQL-file imports print a progress line even with --json.
  const lines=stdout.split(/\r?\n/),start=lines.findIndex(x=>x.trim()==='[');
  check(start>=0,'Cloudflare JSON result missing');
  return JSON.parse(lines.slice(start).join('\n'));
}
export async function sourceBoundRegistration(file,audit) {
  const b=JSON.parse(readFileSync(file,'utf8'));
  const fields=['version','candidate_id','code','business_date','generated_at','purpose','publication_status',
    'publishable','normal_daily_acceptance_passed','packs'];
  check(Object.keys(b).every(k=>fields.includes(k)) && b.version==='minute-explanation-candidate.v1' &&
    b.purpose==='historical_frozen_result_qa' && b.publication_status==='candidate' && b.publishable===false &&
    b.normal_daily_acceptance_passed===false,'unverified or private transport');
  const refs=audit.historical_verification.samples.filter(x=>x.candidate_id===b.candidate_id&&x.code===b.code&&x.business_date===b.business_date);
  check(refs.length===1&&refs[0].source_replay_passed===true&&refs[0].candidate_hash===await digest(canonical(b)),
    'registration not bound to real historical source replay');
  return b;
}
function argsFor(argv) {
  const result={inputs:[],apply:false};
  for(let i=0;i<argv.length;i++) {
    const a=argv[i];if(a==='--apply'){result.apply=true;continue;}
    check(['--input','--source-audit','--output','--batch-id','--expires-at'].includes(a)&&i+1<argv.length,'unknown/missing argument');
    const v=argv[++i];if(a==='--input')result.inputs.push(v);else result[a.slice(2).replaceAll('-','_')]=v;
  }
  check(result.inputs.length>0&&result.inputs.length<=20&&result.source_audit&&result.output&&result.expires_at&&
    /^[A-Za-z0-9._:-]{1,80}$/.test(result.batch_id||''),'inputs, source audit, output, batch ID and expiry required');
  return result;
}
export async function main(argv=process.argv.slice(2)) {
  const a=argsFor(argv),now=new Date(),out=path.resolve(root,a.output),relative=path.relative(outputRoot,out);
  check(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&!existsSync(out),'fresh exact output directory required');
  const audit=JSON.parse(readFileSync(path.resolve(root,a.source_audit),'utf8'));
  const {content_hash,...unsigned}=audit;
  check(audit.version==='minute-gateway-remote-audit.v1'&&content_hash===await digest(canonical(unsigned))&&
    audit.historical_verification?.historical_source_verification_passed===true&&audit.normal_daily_acceptance_passed===false,
    'sealed real source audit required, not normal daily acceptance');
  const registrations=await Promise.all(a.inputs.map(f=>sourceBoundRegistration(path.resolve(root,f),audit)));
  check(new Set(registrations.map(r=>`${r.code}/${r.business_date}`)).size===registrations.length,'duplicate stock/day');
  mkdirSync(out,{recursive:true});let serial=0;
  async function wrangler(options) {
    try {
      const r=await exec(process.execPath,[path.join(cloud,'node_modules/wrangler/bin/wrangler.js'),
        'd1','execute','scorpio-license-db','--remote','--json',...options],{cwd:cloud,encoding:'utf8',maxBuffer:4000000,timeout:60000});
      const data=wranglerJson(r.stdout);check(Array.isArray(data)&&data.length===1&&data[0].success,'remote result invalid');
      return data[0];
    } catch {throw new Error('Cloudflare owner operation failed; no credentials or raw response logged');}
  }
  const env={MINUTE_BETA_DIRECT_ENABLED:'1',DB:{prepare(sql){return {bind(...values){return {
    first:async()=>{const r=await wrangler(['--command',boundSql(sql,values)]);check(r.meta?.rows_written===0,'read mutated source');return r.results[0]||null;},
    run:async()=>{
      check(a.apply,'dry-run cannot write remote data');
      const file=path.join(out,`publish-${++serial}.sql`);writeFileSync(file,boundSql(sql,values),{encoding:'utf8',flag:'wx'});
      return wrangler(['--file',file]);
    },
  };}};}}};
  const rows=[];
  for(const r of registrations) {
    const publication_id=`${a.batch_id}-${r.code}-${r.business_date.replaceAll('-','')}`;
    const existing=await env.DB.prepare('SELECT request_hash,envelope_json,policy_json FROM minute_beta_publications WHERE publication_id=?').bind(publication_id).first();
    let result;
    if(existing) {
      const e=JSON.parse(existing.envelope_json),p=JSON.parse(existing.policy_json);
      check(canonical(e.packs)===canonical(r.packs)&&e.expires_at===a.expires_at&&e.code===r.code&&e.business_date===r.business_date&&
        canonical(p.edition_scopes)===canonical(['standard','pro','standard_pro','internal']),'existing publication differs; use new batch ID');
      result={publication_id,status:'already_published',channel:'beta'};
    } else {
      const latest=await env.DB.prepare('SELECT publication_id FROM minute_beta_publications WHERE code=? AND business_date=? ORDER BY seq DESC LIMIT 1')
        .bind(r.code,r.business_date).first();
      const body={version:'minute-beta-direct.v1',channel:'beta',publication_id,code:r.code,business_date:r.business_date,
        generated_at:r.generated_at,packs:r.packs,expected_previous_publication_id:latest?.publication_id||'',
        edition_scopes:['standard','pro','standard_pro','internal'],expires_at:a.expires_at,min_client_version:'0.3.0',display_only:true,
        normal_daily_acceptance_passed:false};
      await prepareBetaPublication(body,'cloudflare-owner-cli',now);
      writeFileSync(path.join(out,`${r.code}-${r.business_date}.publish.json`),canonical(body),{encoding:'utf8',flag:'wx'});
      result=a.apply?await publishBetaDirect(env,body,'cloudflare-owner-cli',now):{publication_id,status:'validated_not_published'};
    }
    const readback=a.apply?await readPublication(env,{code:r.code,businessDate:r.business_date,
      editionScopes:['pro'],clientVersion:'0.3.0-beta.21'},new Date()):null;
    if(a.apply)check(readback.status==='published'&&readback.publication_id===publication_id&&canonical(readback.packs)===canonical(r.packs),
      'remote readback failed; no earlier fallback or approval fabrication');
    rows.push({...result,code:r.code,business_date:r.business_date,remote_readback_passed:a.apply,
      scopes:r.packs.map(x=>JSON.parse(x.payload_json).scope),pack_hashes:r.packs.map(x=>x.content_hash)});
  }
  const receipt={version:'minute-beta-direct-receipt.v1',checked_at:new Date().toISOString(),channel:'beta',apply:a.apply,
    source_audit_hash:content_hash,results:rows,normal_daily_acceptance_passed:false,authenticated_user_acceptance_passed:false,
    sample_membership_changed:false,license_permissions_changed:false,candidate_or_approval_created:false};
  receipt.content_hash=await digest(canonical(receipt));
  writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2),{encoding:'utf8',flag:'wx'});
  process.stdout.write(JSON.stringify({published:a.apply,stock_days:rows.length,packs:rows.reduce((n,x)=>n+x.scopes.length,0),receipt:path.relative(root,path.join(out,'receipt.json'))})+'\n');
  return receipt;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{process.stderr.write(`Beta publication failed: ${e.message}\n`);process.exitCode=1;});
