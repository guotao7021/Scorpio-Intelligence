import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonical,digest} from '../src/minute-delivery.mjs';
import {prepareBetaPublication} from '../src/minute-beta-direct.mjs';
import {sqlLiteral,boundSql,wranglerJson,sourceBoundRegistration} from '../../../scripts/publish_minute_beta.mjs';

test('owner SQL rendering quotes payload strings and cannot inject a second statement',()=>{
  assert.equal(sqlLiteral("a'b"),"'a''b'");
  assert.equal(boundSql('SELECT ? AS x',["';DROP TABLE test;--"]),"SELECT ''';DROP TABLE test;--' AS x;");
  assert.throws(()=>sqlLiteral('a\0b'));assert.throws(()=>boundSql('SELECT ?,?',['a']));
});
test('Wrangler progress before SQL-file JSON is accepted, non-JSON failure is rejected',()=>{
  assert.deepEqual(wranglerJson('├ Checking if file needs uploading\n│\n[\n{"success":true}\n]\n'),[{success:true}]);
  assert.deepEqual(wranglerJson('[\n{"success":true}\n]'),[{success:true}]);
  assert.throws(()=>wranglerJson('error: unauthorized'));
});
// Optional workspace integration: the files are real source-audited historical
// outputs, not public fixtures or fabricated market observations.
const auditUrl=new URL('../../../outputs/minute_public_results/cloud-deployment-20261006/remote-audit.json',import.meta.url);
let audit;
try {audit=JSON.parse(readFileSync(auditUrl,'utf8'));} catch {}
for(const file of ['603190-20260929','603190-20260930','301090-20260930'])
  test(`actual frozen ${file} passes the same Beta public validator`,{skip:!audit},async()=>{
    const url=new URL(`../../../outputs/minute_public_results/gateway-20261006/${file}.registration.json`,import.meta.url);
    const r=await sourceBoundRegistration(url,audit);
    const p=await prepareBetaPublication({version:'minute-beta-direct.v1',channel:'beta',publication_id:`beta-test-${file}`,
      code:r.code,business_date:r.business_date,generated_at:r.generated_at,packs:r.packs,expected_previous_publication_id:'',
      edition_scopes:['standard_pro'],expires_at:'2026-10-12T23:59:59',min_client_version:'0.3.0',display_only:true,
      normal_daily_acceptance_passed:false},'test-owner',new Date('2026-10-06T05:00:00Z'));
    assert.equal(p.envelope.packs.length,2);
    assert.equal(p.publicationHash,await digest(canonical({envelope:p.envelope,policy:JSON.parse(p.policy),generated_at:r.generated_at.replace(' ','T')})));
    await assert.rejects(sourceBoundRegistration(url,{historical_verification:{samples:[]}}),/real historical source/);
  });
