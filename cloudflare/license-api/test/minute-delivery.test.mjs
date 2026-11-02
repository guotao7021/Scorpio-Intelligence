import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHmac, randomBytes} from 'node:crypto';
import worker from '../src/worker.js';
import {authorizeStockRead} from '../src/mobile-stock-access.mjs';
import {canonical, digest, registerCandidate, approveCandidate, publishApproved, revokePublication, readPublication, shanghaiTime, validatePacks} from '../src/minute-delivery.mjs';

const now = new Date('2026-10-06T04:00:00Z');
const request = {code:'603190', businessDate:'2026-09-30', editionScopes:['pro','standard_pro','standard'], clientVersion:'0.3.0-beta.20'};
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0026_minute_result_delivery.sql',import.meta.url),'utf8'));
  const env = {DB:{prepare(sql) {return {bind(...args) {return {
    first:async()=>db.prepare(sql).get(...args) || null, all:async()=>({results:db.prepare(sql).all(...args)}),
    run:async()=>({meta:{changes:Number(db.prepare(sql).run(...args).changes)}}),
  };}};}}};
  return {db, env};
}
async function candidate(n=1) {
  const pack = {schema_version:'stock-minute-explanation.v1',code:request.code,business_date:request.businessDate,scope:'context',
    interval_minutes:5,price_basis:'unadjusted',available_at:`2026-10-05T12:00:0${n}`,observed_through:'2026-09-30 09:40:00',historical:true,
    status:'available',reason_code:'',reason_text:'',explanation_mode:'local_knowledge',knowledge_binding:{version:'knowledge.v1',content_hash:'a'.repeat(64)},
    conclusion:{headline:`已观测结果${n}`,label:'本地知识解读',status:'available',boundary:'不是交易指令',evidence:['实际闭柱'],counter_evidence:[],limitations:['没有盘口数据'],follow_up_questions:[]},
    indicator_cards:[], charts:{price_vwap:[{clock:'09:35',bar_time:'2026-09-30 09:35:00',segment:'morning',ordinal:0,close:10,vwap:10,volume_ratio:0},
      {clock:'09:40',bar_time:'2026-09-30 09:40:00',segment:'morning',ordinal:1,close:10.1,vwap:10,volume_ratio:null}],
      price_volume_states:[],return_amplitude:[],breakout_events:[]},tables:[],coverage:{classification_label:'',membership_missing:false},
    display_only:true,formal_use_allowed:false,order_authorized:false,model_called:false,observation_binding_hash:'b'.repeat(64)};
  const payload_json = canonical(pack);
  return {candidate_id:`candidate-${n}`,version:'minute-explanation-candidate.v1',code:request.code,business_date:request.businessDate,
    generated_at:`2026-10-05T13:00:0${n}`,purpose:'historical_frozen_result_qa',publication_status:'candidate',publishable:false,normal_daily_acceptance_passed:false,
    packs:[{payload_json,content_hash:await digest(payload_json)}]};
}
function approval(c, hash, n=1, previous='') {
  return {version:'minute-delivery-approval.v1',approval_id:`approval-${n}`,publication_id:`publication-${n}`,candidate_id:c.candidate_id,candidate_hash:hash,
    expected_previous_publication_id:previous,decision:'approved',acceptance:{receipt_id:`historical-receipt-${n}`,content_hash:'c'.repeat(64),kind:'historical_verified',status:'passed'},
    allowed_scopes:['context'],edition_scopes:['pro'],knowledge_hashes:['a'.repeat(64)],expires_at:'2026-10-07T12:00:00',min_client_version:'0.3.0',display_only:true};
}
async function release(env,n=1,previous='',edit=x=>x) {
  const c=await candidate(n), registered=await registerCandidate(env,c,'test-admin',now), manifest=edit(approval(c,registered.candidate_hash,n,previous));
  const approved=await approveCandidate(env,manifest,'test-admin',now);
  await publishApproved(env,{approval_id:approved.approval_id,approval_hash:approved.approval_hash},'test-admin',now);
  return {c,approved,manifest};
}

test('candidate and approval are invisible; only explicit publication serves a public whitelist',async()=>{
  const {db,env}=fixture();try{
    const c=await candidate(),r=await registerCandidate(env,c,'admin',now);
    assert.equal((await readPublication(env,request,now)).status,'missing');
    const a=await approveCandidate(env,approval(c,r.candidate_hash),'admin',now);
    assert.equal((await readPublication(env,request,now)).status,'missing');
    await publishApproved(env,{approval_id:a.approval_id,approval_hash:a.approval_hash},'admin',now);
    const result=await readPublication(env,request,now);
    assert.equal(result.status,'published');assert.equal(result.packs[0].payload_json,c.packs[0].payload_json);
    assert.equal(JSON.parse(result.packs[0].payload_json).charts.price_vwap[0].volume_ratio,0);
    assert.doesNotMatch(JSON.stringify(result),/registered_by|approved_by|receipt_id|manifest_json|candidate_id|source_bindings/);
    assert.equal(result.published_at,shanghaiTime(now));
  }finally{db.close();}
});
test('same day only latest; stale approval cannot overwrite a newer head',async()=>{
  const {db,env}=fixture();try{
    await release(env);await release(env,2,'publication-1');
    assert.equal((await readPublication(env,request,now)).publication_id,'publication-2');
    await assert.rejects(release(env,3,''),/head_changed/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM minute_delivery_publications').get().n,2);
  }finally{db.close();}
});
test('concurrent approved writers compare-and-set one head rather than overwrite each other',async()=>{
  const {db,env}=fixture();try{
    const approvals=[];
    for (const n of [1,2]) {
      const c=await candidate(n),r=await registerCandidate(env,c,'admin',now);
      approvals.push(await approveCandidate(env,approval(c,r.candidate_hash,n),'admin',now));
    }
    const attempts=await Promise.allSettled(approvals.map(a=>publishApproved(env,{approval_id:a.approval_id,approval_hash:a.approval_hash},'admin',now)));
    assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(attempts.filter(x=>x.status==='rejected').length,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM minute_delivery_publications').get().n,1);
  }finally{db.close();}
});
test('withdrawal during payload verification is rechecked before returning data',async()=>{
  const {db,env}=fixture();try{
    await release(env);let injected=false;
    const racing={DB:{prepare(sql){const statement=env.DB.prepare(sql);return {bind(...args){const bound=statement.bind(...args);return {
      ...bound,first:async()=>{const row=await bound.first();if (!injected && sql.includes('SELECT p.*, r.publication_id')) {
        injected=true;await revokePublication(env,{publication_id:'publication-1',reason:'concurrent withdrawal'},'admin',now);
      }return row;}
    };}};}}};
    const result=await readPublication(racing,request,now);
    assert.equal(result.status,'withdrawn');assert.deepEqual(result.packs,[]);
  }finally{db.close();}
});
test('withdrawn latest never uncovers previous published result; retry cannot resurrect it',async()=>{
  const {db,env}=fixture();try{
    await release(env);const r=await release(env,2,'publication-1');
    await revokePublication(env,{publication_id:'publication-2',reason:'来源更正'},'admin',now);
    await revokePublication(env,{publication_id:'publication-2',reason:'retry'},'admin',now);
    await publishApproved(env,{approval_id:r.approved.approval_id,approval_hash:r.approved.approval_hash},'admin',now);
    assert.deepEqual((await readPublication(env,request,now)).packs,[]);
    assert.equal((await readPublication(env,request,now)).status,'withdrawn');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM minute_delivery_revocations').get().n,1);
  }finally{db.close();}
});
test('expiry is Shanghai wall time; exact expiry clears latest with no earlier fallback',async()=>{
  const {db,env}=fixture();try{
    await release(env,1,'',x=>({...x,expires_at:'2026-10-08T12:00:00'}));await release(env,2,'publication-1');
    assert.equal((await readPublication(env,request,new Date('2026-10-07T03:59:59Z'))).status,'published');
    assert.equal((await readPublication(env,request,new Date('2026-10-07T04:00:00Z'))).status,'expired');
  }finally{db.close();}
});
test('damaged newest payload clears whole result rather than returning the older valid release',async()=>{
  const {db,env}=fixture();try{
    await release(env);await release(env,2,'publication-1');
    db.exec('DROP TRIGGER minute_publications_no_update'); // emulate out-of-band storage corruption only
    db.prepare("UPDATE minute_delivery_publications SET envelope_json='broken' WHERE publication_id='publication-2'").run();
    const result=await readPublication(env,request,now);assert.equal(result.status,'unavailable');assert.deepEqual(result.packs,[]);
  }finally{db.close();}
});
test('new restricted edition or higher client capability does not leak older accessible data',async()=>{
  const {db,env}=fixture();try{
    await release(env);await release(env,2,'publication-1',x=>({...x,edition_scopes:['internal']}));
    assert.equal((await readPublication(env,request,now)).status,'not_entitled');
    assert.equal((await readPublication(env,{...request,editionScopes:['internal'],clientVersion:'0.2.9'},now)).status,'client_update_required');
    assert.equal((await readPublication(env,{...request,editionScopes:['internal']},now)).status,'published');
  }finally{db.close();}
});
test('other stock/day and staging stay missing, no cross-date fallback',async()=>{
  const {db,env}=fixture();try{
    await release(env);await registerCandidate(env,await candidate(2),'admin',now);
    assert.equal((await readPublication(env,{...request,code:'000001'},now)).status,'missing');
    assert.equal((await readPublication(env,{...request,businessDate:'2026-09-29'},now)).status,'missing');
    assert.equal((await readPublication(env,request,now)).publication_id,'publication-1');
    await assert.rejects(readPublication(env,{...request,businessDate:'2026-02-30'},now));
  }finally{db.close();}
});
test('immutable candidates, approvals, publications and revocations cannot be overwritten or deleted',async()=>{
  const {db,env}=fixture();try{
    await release(env);await revokePublication(env,{publication_id:'publication-1',reason:'withdraw'},'admin',now);
    for(const table of ['candidates','approvals','publications','revocations']) {
      assert.throws(()=>db.exec(`DELETE FROM minute_delivery_${table}`),/immutable/);
    }
    const c=await candidate();await registerCandidate(env,c,'admin',now);
    await assert.rejects(registerCandidate(env,{...c,generated_at:'2026-10-05T13:00:02'},'admin',now),/conflict/);
  }finally{db.close();}
});
test('approval requires exact candidate, knowledge, scope, receipt and explicit read-only permission',async()=>{
  const {db,env}=fixture();try{
    const c=await candidate(),r=await registerCandidate(env,c,'admin',now),a=approval(c,r.candidate_hash);
    for(const bad of [{candidate_hash:'f'.repeat(64)},{knowledge_hashes:[]},{allowed_scopes:['market']},{display_only:false},
      {acceptance:{...a.acceptance,status:'pending'}},{acceptance:{...a.acceptance,kind:'normal_daily'}},{expires_at:'2026-10-06T12:00:00'}])
      await assert.rejects(approveCandidate(env,{...a,...bad},'admin',now));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM minute_delivery_approvals').get().n,0);
  }finally{db.close();}
});
test('private keys, bad hash, five-minute clock, duplicates and trading flags rejected before storage',async()=>{
  const {db,env}=fixture();try{
    const c=await candidate();await assert.rejects(registerCandidate(env,{...c,source_bindings:[{path:'private'}]},'admin',now));
    for(const transform of [p=>({...p,order_authorized:true}),p=>({...p,token:'private'}),p=>({...p,interval_minutes:60}),
      p=>({...p,observed_through:'2026-09-30 15:00:00'}),p=>({...p,observation_binding_hash:null}),
      p=>({...p,charts:{...p.charts,price_vwap:[{...p.charts.price_vwap[0],clock:'10:95',bar_time:'2026-09-30 10:95:00'}]}})]) {
      const payload_json=canonical(transform(JSON.parse(c.packs[0].payload_json)));
      await assert.rejects(registerCandidate(env,{...c,packs:[{payload_json,content_hash:await digest(payload_json)}]},'admin',now));
    }
    await assert.rejects(validatePacks([...c.packs,...c.packs],c.code,c.business_date,c.generated_at));
    await assert.rejects(registerCandidate(env,{...c,packs:[{...c.packs[0],content_hash:'0'.repeat(64)}]},'admin',now));
    await assert.rejects(registerCandidate(env,{...c,packs:[{payload_json:'broken',content_hash:await digest('broken')}]},'admin',now),error=>error.status===400);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM minute_delivery_candidates').get().n,0);
  }finally{db.close();}
});

function setupAuth(db,env) {
  db.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../migrations/0008_production_uploads.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../migrations/0017_mobile_device_bindings.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../migrations/0020_mobile_daily_analysis_usage.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../migrations/0027_mobile_stock_read_grants.sql',import.meta.url),'utf8'));
  db.exec("INSERT INTO production_upload_batches(batch_id,module,status,created_at,updated_at) VALUES('sample-fixture','target_research','committed','now','now')");
  db.prepare(`INSERT INTO production_table_rows(table_name,row_key,row_hash,row_json,data_date,edition_scope,module,batch_id,updated_at)
    VALUES('score_history','sample-stock','fixture',?,'2026-09-30','pro','target_research','sample-fixture','now')`).run(JSON.stringify({code:request.code,asset_type:'stock'}));
  db.exec('CREATE TABLE analysis_replay_nonces(user_id INTEGER,nonce TEXT,request_hash TEXT,expires_at TEXT,created_at TEXT,PRIMARY KEY(user_id,nonce))');
  db.exec("INSERT INTO users VALUES(1,'mobile@example.invalid','mobile','unused',1,'local','now'); INSERT INTO users VALUES(2,'other@example.invalid','other','unused',1,'local','now')");
  db.exec("INSERT INTO licenses(user_id,license_id,edition,signed_payload,signature,issued_at,expires_at,created_at) VALUES(1,'test-license','personal_pro','','','now','2099-01-01','now')");
  db.exec("INSERT INTO mobile_device_bindings(user_id,license_id,machine_fingerprint,created_at,last_seen_at) VALUES(1,'test-license','test-device','now','now')");
  Object.assign(env,{JWT_SECRET:'isolated-contract-secret',ADMIN_API_TOKEN:'isolated-contract-admin',ANALYSIS_RATE_LIMIT_PER_MINUTE:'-1',ANALYSIS_REQUIRE_REQUEST_SIGNATURE:'true'});
}
function jwt(user=1) {
  const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const p=Buffer.from(JSON.stringify({user_id:user,type:'access',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  return `${h}.${p}.${createHmac('sha256','isolated-contract-secret').update(`${h}.${p}`).digest('base64url')}`;
}
async function signed(body,token=jwt(),path='/v1/mobile/minute-explanations') {
  const timestamp=String(Math.floor(Date.now()/1000)),nonce=randomBytes(12).toString('hex');
  const base=`POST\n${path}\n${timestamp}\n${nonce}\n${await digest(canonical(body))}`;
  return new Request('https://local.invalid'+path,{method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json',Authorization:`Bearer ${token}`,
    'X-Scorpio-Timestamp':timestamp,'X-Scorpio-Nonce':nonce,'X-Scorpio-Signature':createHmac('sha256',token).update(base).digest('hex')}});
}
test('real Worker route enforces JWT, account/device/license, signature and replay before data access',async()=>{
  const {db,env}=fixture();try{
    setupAuth(db,env);
    const body={code:request.code,data_date:request.businessDate,license_id:'test-license',machine_fingerprint:'test-device',client_version:'0.3.0-beta.20'};
    const valid=await signed(body),response=await worker.fetch(valid.clone(),env);
    assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
    assert.equal((await response.json()).minute_explanations.status,'missing');
    assert.equal((await worker.fetch(valid.clone(),env)).status,409);
    assert.equal((await worker.fetch(await signed(body,jwt(2)),env)).status,403);
    assert.equal((await worker.fetch(await signed({...body,machine_fingerprint:'other'}),env)).status,403);
    const unsigned=new Request('https://local.invalid/v1/mobile/minute-explanations',{method:'POST',body:JSON.stringify(body),headers:{Authorization:`Bearer ${jwt()}`}});
    assert.equal((await worker.fetch(unsigned,env)).status,400);
    const noJwt=await signed(body);noJwt.headers.delete('Authorization');assert.equal((await worker.fetch(noJwt,env)).status,401);
    const damagedJwt=await signed(body,jwt()+'x');assert.equal((await worker.fetch(damagedJwt,env)).status,401);
    const damagedSignature=await signed(body);damagedSignature.headers.set('X-Scorpio-Signature','0'.repeat(64));
    assert.equal((await worker.fetch(damagedSignature,env)).status,401);
    db.exec("UPDATE licenses SET expires_at='2000-01-01'");assert.equal((await worker.fetch(await signed(body),env)).status,403);
    db.exec("UPDATE licenses SET expires_at='2099-01-01'");
    db.exec("UPDATE licenses SET revoked=1");assert.equal((await worker.fetch(await signed(body),env)).status,403);
    const admin=new Request('https://local.invalid/v1/scorpio_v1_admin/minute-results/candidates',{method:'POST',body:JSON.stringify(await candidate()),headers:{Authorization:`Bearer ${jwt()}`}});
    assert.equal((await worker.fetch(admin,env)).status,403);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM minute_delivery_candidates').get().n,0);
  }finally{db.close();}
});

function stockAccess(overrides={}) {
  return {user:{id:1},license:{license_id:'test-license'},code:'000001',businessDate:'2026-09-30',editionScopes:['pro'],
    usageDate:'2026-10-06',quotaLimit:5,grantedAt:'2026-10-06T04:00:00Z',...overrides};
}
test('desktop published sample membership is free; stale, uncommitted, other edition and client flags are not membership',async()=>{
  const {db,env}=fixture();try{
    setupAuth(db,env);
    assert.equal((await authorizeStockRead(env,stockAccess({code:request.code}))).kind,'sample_pool');
    assert.equal((await authorizeStockRead(env,stockAccess({code:request.code,businessDate:''}))).kind,'sample_pool');
    for (const opts of [{code:request.code,businessDate:'2026-09-29'},{code:request.code,editionScopes:['internal']},{code:'603191',sample:true}])
      await assert.rejects(authorizeStockRead(env,stockAccess(opts)),/access_required/);
    db.exec("UPDATE production_upload_batches SET status='created'");
    await assert.rejects(authorizeStockRead(env,stockAccess({code:request.code})),/access_required/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_daily_analysis_usage').get().n,0);
  }finally{db.close();}
});
test('non-sample detail claims once; read-only refresh never claims and stays account/day/stock specific',async()=>{
  const {db,env}=fixture();try{
    setupAuth(db,env);
    await assert.rejects(authorizeStockRead(env,stockAccess()),/access_required/);
    assert.equal((await authorizeStockRead(env,stockAccess({allowClaim:true}))).charged,true);
    for(let i=0;i<30;i++) assert.equal((await authorizeStockRead(env,stockAccess())).charged,false);
    assert.equal((await authorizeStockRead(env,stockAccess({allowClaim:true}))).charged,false);
    for(const opts of [{user:{id:2}},{usageDate:'2026-10-07'},{code:'000002'}])
      await assert.rejects(authorizeStockRead(env,stockAccess(opts)),/access_required/);
    assert.equal(db.prepare('SELECT used_count FROM mobile_daily_analysis_usage').get().used_count,1);
  }finally{db.close();}
});
test('concurrent unique detailed queries cannot exceed quota; retries keep existing access at limit',async()=>{
  const {db,env}=fixture();try{
    setupAuth(db,env);
    const results=await Promise.allSettled(Array.from({length:10},(_,i)=>authorizeStockRead(env,stockAccess({code:String(i+1).padStart(6,'0'),allowClaim:true}))));
    assert.equal(results.filter(x=>x.status==='fulfilled').length,5);
    assert.equal(results.filter(x=>x.status==='rejected' && x.reason.status===429).length,5);
    assert.equal(db.prepare('SELECT used_count FROM mobile_daily_analysis_usage').get().used_count,5);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_stock_read_grants').get().n,5);
    assert.equal((await authorizeStockRead(env,stockAccess())).kind,'daily_query');
  }finally{db.close();}
});
test('same-stock races charge once and detailed query shares prior deep-refresh usage',async()=>{
  const {db,env}=fixture();try{
    setupAuth(db,env);db.exec("INSERT INTO mobile_daily_analysis_usage VALUES(1,'2026-10-06',4,'now')");
    const results=await Promise.all(Array.from({length:10},()=>authorizeStockRead(env,stockAccess({allowClaim:true}))));
    assert.equal(results.filter(x=>x.charged).length,1);
    assert.equal(db.prepare('SELECT used_count FROM mobile_daily_analysis_usage').get().used_count,5);
    await assert.rejects(authorizeStockRead(env,stockAccess({code:'000002',allowClaim:true})),/limit_reached/);
  }finally{db.close();}
});
test('server-authorized test users bypass sample and query limits without writing grants',async()=>{
  const {db,env}=fixture();try{
    setupAuth(db,env);
    for(let i=0;i<10;i++) assert.equal((await authorizeStockRead(env,stockAccess({code:String(i+1).padStart(6,'0'),unlimited:true}))).kind,'test_unlimited');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_stock_read_grants').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_daily_analysis_usage').get().n,0);
  }finally{db.close();}
});
test('actual minute route cannot bypass detailed-query quota; sample refresh and server test allowlist are free',async()=>{
  const {db,env}=fixture();try{
    setupAuth(db,env);
    const body={code:'000001',data_date:request.businessDate,license_id:'test-license',machine_fingerprint:'test-device',client_version:request.clientVersion,sample:true,unlimited:true};
    let response=await worker.fetch(await signed(body),env);assert.equal(response.status,403);
    assert.equal((await response.json()).error,'mobile_stock_read_access_required');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_daily_analysis_usage').get().n,0);
    // Non-sample is first opened through the actual detailed-research endpoint.
    response=await worker.fetch(await signed(body,jwt(),'/v1/mobile/stock/research'),env);assert.equal(response.status,200);
    assert.equal((await response.json()).quota.used,1);
    for(let i=0;i<3;i++) assert.equal((await worker.fetch(await signed(body),env)).status,200);
    assert.equal(db.prepare('SELECT used_count FROM mobile_daily_analysis_usage').get().used_count,1);
    assert.equal((await worker.fetch(await signed({...body,code:request.code}),env)).status,200);
    db.exec('UPDATE mobile_daily_analysis_usage SET used_count=5');
    assert.equal((await worker.fetch(await signed(body,jwt(),'/v1/mobile/stock/detail'),env)).status,429);
    assert.equal((await worker.fetch(await signed({...body,code:'000002'},jwt(),'/v1/mobile/stock/research'),env)).status,429);
    assert.equal((await worker.fetch(await signed({...body,code:request.code},jwt(),'/v1/mobile/stock/research'),env)).status,200);
    assert.equal((await worker.fetch(await signed(body),env)).status,200);
    env.MOBILE_ANALYSIS_UNLIMITED_EMAILS='mobile@example.invalid';
    assert.equal((await worker.fetch(await signed({...body,code:'000002'}),env)).status,200);
    assert.equal(db.prepare('SELECT used_count FROM mobile_daily_analysis_usage').get().used_count,5);
  }finally{db.close();}
});
test('actual admin routes register, approve, publish, serve, revoke and retain audit records',async()=>{
  const {db,env}=fixture();try{
    setupAuth(db,env);const current=new Date(),c=await candidate();
    async function admin(path,body) {
      const res=await worker.fetch(new Request('https://local.invalid/v1/scorpio_v1_admin/minute-results/'+path,{method:'POST',body:JSON.stringify(body),headers:{'X-Admin-Token':env.ADMIN_API_TOKEN}}),env);
      assert.equal(res.status,200);return res.json();
    }
    const r=await admin('candidates',c),manifest=approval(c,r.candidate_hash);manifest.expires_at=shanghaiTime(new Date(current.getTime()+3600000));
    const a=await admin('approvals',manifest);await admin('publish',{approval_id:a.approval_id,approval_hash:a.approval_hash});
    const body={code:request.code,data_date:request.businessDate,license_id:'test-license',machine_fingerprint:'test-device',client_version:request.clientVersion};
    let res=await worker.fetch(await signed(body),env);assert.equal((await res.json()).minute_explanations.status,'published');
    await admin('revoke',{publication_id:manifest.publication_id,reason:'source revised'});
    res=await worker.fetch(await signed(body),env);assert.equal((await res.json()).minute_explanations.status,'withdrawn');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM admin_audit_events WHERE action='admin_request_authorized'").get().n,4);
  }finally{db.close();}
});
