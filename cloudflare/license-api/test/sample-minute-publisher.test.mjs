import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {loadInput,sampleSql,verifyReadback} from '../../../scripts/publish_sample_minute_beta.mjs';
import {canonical,digest} from '../src/minute-delivery.mjs';
import {prepareBetaPublication} from '../src/minute-beta-direct.mjs';

test('sample transport requires seal, source verification, exact membership and public-only root',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'sample-minute-'));
  try{
    const p={version:'sample-minute-direct-input.v1',business_date:'2026-09-30',generated_at:'2026-10-06T12:00:00',
      sample_codes:['000027'],packages:[{code:'000027',business_date:'2026-09-30',generated_at:'2026-10-06T12:00:00',packs:[]}],
      source_readonly:true,source_replay_passed:true,normal_daily_acceptance_passed:false};
    async function file(value){const payload_json=canonical(value),f=path.join(dir,'input.json');
      writeFileSync(f,canonical({version:'sample-minute-direct-file.v1',payload_json,content_hash:await digest(payload_json)}));return f;}
    assert.equal((await loadInput(await file(p))).packages.length,1);
    for(const change of [{source_replay_passed:false},{normal_daily_acceptance_passed:true},{token:'PRIVATE'},
      {sample_codes:['600000']},{packages:p.packages.concat(p.packages)}])
      await assert.rejects(()=>file({...p,...change}).then(loadInput));
    const f=await file(p),raw=JSON.parse(readFileSync(f,'utf8'));raw.payload_json+=' ';
    writeFileSync(f,JSON.stringify(raw));await assert.rejects(()=>loadInput(f),/unsealed/);
    assert.throws(()=>sampleSql("2026-09-30';DROP TABLE accounts;--"));
    assert.match(sampleSql('2026-09-30'),/b.status='committed'/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

const actual=new URL('../../../outputs/minute_public_results/sample-delivery-20261006-r1/public-input.json',import.meta.url);
test('real sample packages verify through shared serving logic; damage/revocation/expiry never fall back', {skip:!existsSync(actual)},async()=>{
  const p=await loadInput(actual),r=p.packages[0],now=new Date('2026-10-06T08:00:00Z');
  const body={version:'minute-beta-direct.v1',channel:'beta',publication_id:'sample-test',code:r.code,business_date:r.business_date,
    generated_at:r.generated_at,packs:r.packs,expected_previous_publication_id:'',edition_scopes:['standard_pro'],
    expires_at:'2026-10-12T23:59:59',min_client_version:'0.3.0',display_only:true,normal_daily_acceptance_passed:false};
  // The real generation time can be later than this test's nominal afternoon.
  const clock=new Date(Math.max(now.getTime(),Date.parse(r.generated_at+'+08:00')+1000));
  const ready=await prepareBetaPublication(body,'test-owner',clock);
  const row={code:r.code,business_date:r.business_date,publication_id:body.publication_id,generated_at:r.generated_at,
    envelope_json:ready.payload,policy_json:ready.policy,publication_hash:ready.publicationHash,published_at:ready.envelope.published_at};
  const planned=[{...r,publication_id:body.publication_id}];
  assert.equal((await verifyReadback([row],planned,clock))[0].remote_readback_passed,true);
  for(const change of [{revoked_id:'sample-test'},{envelope_json:'{}'},{publication_hash:'0'.repeat(64)}])
    await assert.rejects(()=>verifyReadback([{...row,...change}],planned,clock));
  await assert.rejects(()=>verifyReadback([row],planned,new Date('2026-10-12T16:00:00Z')));
});
