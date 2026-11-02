import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {__monitoringSecurityTest} from '../src/worker.js';
import {registerMonitoringRoutes} from '../src/monitoring-bridge.mjs';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0023_monitoring_bridge.sql', import.meta.url), 'utf8'));
  const DB = {prepare(query) { return {bind(...args) {
    const statement = sql.prepare(query);
    return {first: async () => statement.get(...args) || null,
      all: async () => ({results: statement.all(...args)}),
      run: async () => ({meta: {changes: Number(statement.run(...args).changes)}})};
  }};}, async batch(queries) {
    sql.exec('BEGIN');
    try { const out=[]; for(const query of queries) out.push(await query.run()); sql.exec('COMMIT'); return out; }
    catch(e) { sql.exec('ROLLBACK'); throw e; }
  }};
  const routes = new Map(), revoked = new Set();
  const fail = (status, message) => {throw Object.assign(new Error(message), {status});};
  registerMonitoringRoutes({route: (method,path,fn) => routes.set(path,fn),
    requireUser: async ctx => {if (!ctx.user) fail(401,'jwt'); return {id:ctx.user};},
    readJson: async request => request.json(), json: (data,status,headers) => new Response(JSON.stringify(data), {status,headers}), throwHttp:fail,
    verifyAnalysisLicense: async (env,user,license,fp) => {
      if (!license) return null;
      if(license !== 'desktop-'+user.id || fp !== 'pc-'+user.id || revoked.has(license)) fail(403,'desktop_license');
      return {license_id:license};
    },
    verifyMobileLicense: async (env,user,license,fp) => {
      if(license !== 'mobile-'+user.id || !['phone-'+user.id,'second-'+user.id].includes(fp) || revoked.has(license)) fail(403,'mobile_license');
      return {license_id:license};
    },
    applyAnalysisSecurity: async(ctx) => {
      assert.equal(ctx.env.ANALYSIS_REQUIRE_REQUEST_SIGNATURE,'true');
      if(!ctx.signed) fail(401,'signature');
    }, sha256Hex: async s => createHash('sha256').update(s).digest('hex')});
  async function request(action, data={}, {user=1,mobile=false,signed=true}={}) {
    const prefix=mobile?'/v1/mobile/monitoring/':'/v1/monitoring/desktop/';
    return routes.get(prefix+action)({user,signed,env:{DB},request:new Request('https://test.invalid'+prefix+action,{method:'POST',body:JSON.stringify({license_id:(mobile?'mobile-':'desktop-')+user,machine_fingerprint:(mobile?'phone-':'pc-')+user,instance_id:'installation',...data})})});
  }
  const call = async(...args)=>(await request(...args)).json();
  async function pair(scope='paper') {return call('pair',{account_scope:scope,consent:true});}
  async function linked(scope='paper') {const link=await pair(scope); await call('claim',{pair_code:link.pair_code},{mobile:true});return link;}
  const event = (id,scope='paper') => ({event_id:id,account_scope:scope,transition:'triggered',occurred_at:new Date().toISOString(),message:'观察条件命中',code:'600001',positions:[{secret:'never send'}]});
  return {sql,call,request,pair,linked,event,revoked};
}

test('JWT, signature, license and explicit account consent required',async()=>{
  const f=fixture();
  for(const options of [{user:0},{signed:false}]) await assert.rejects(f.call('pair',{consent:true,account_scope:'paper'},options));
  for(const data of [{consent:false,account_scope:'paper'},{consent:true,account_scope:'all'},{consent:true,account_scope:'paper',license_id:''}]) await assert.rejects(f.call('pair',data));
  const response=await f.request('pair',{consent:true,account_scope:'paper'});
  assert.equal(response.headers.get('cache-control'),'no-store');
  const link=await response.json();
  assert(!JSON.stringify(f.sql.prepare('SELECT * FROM monitoring_links').all()).includes(link.pair_code));
});

test('pairing is single mobile device, same owner, expiring and idempotent',async()=>{
  const f=fixture(),link=await f.pair();
  await assert.rejects(f.call('claim',{pair_code:link.pair_code},{mobile:true,user:2}));
  await f.call('claim',{pair_code:link.pair_code},{mobile:true});
  await f.call('claim',{pair_code:link.pair_code},{mobile:true});
  await assert.rejects(f.call('claim',{pair_code:link.pair_code,machine_fingerprint:'second-1'},{mobile:true}));
  f.sql.prepare('UPDATE monitoring_links SET code_expires=?').run('2000-01-01T00:00:00Z');
  await assert.rejects(f.call('claim',{pair_code:link.pair_code},{mobile:true}));
});

test('no upload before claim; exact owner, license, instance and scope on every request',async()=>{
  const f=fixture(),link=await f.pair();
  assert.equal((await f.call('sync',{link_id:link.link_id,events:[f.event('e')]})).state,'awaiting_claim');
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM monitoring_cloud_events').get().n,0);
  await f.call('claim',{pair_code:link.pair_code},{mobile:true});
  for(const data of [{instance_id:'other'},{machine_fingerprint:'other'},{events:[f.event('e','live')]},{events:[{...f.event('e'),occurred_at:'2020-01-01T00:00:00Z'}]}]) await assert.rejects(f.call('sync',{link_id:link.link_id,...data}));
  await assert.rejects(f.call('sync',{link_id:link.link_id},{user:2}));
  await assert.rejects(f.call('events',{link_id:link.link_id},{mobile:true,user:2}));
  await assert.rejects(f.call('events',{link_id:link.link_id,machine_fingerprint:'second-1'},{mobile:true}));
});

test('immutable retry-safe events, payload allowlist, separate explicit read origins',async()=>{
  const f=fixture(),link=await f.linked(),e=f.event('e');
  const request={link_id:link.link_id,events:[e]};
  await f.call('sync',request);await f.call('sync',request);
  await assert.rejects(f.call('sync',{...request,events:[{...e,message:'mutated'}]}));
  let page=await f.call('events',{link_id:link.link_id},{mobile:true});
  assert.equal(page.events.length,1);assert.deepEqual(page.events[0].receipts,[]);assert.equal(page.events[0].positions,undefined);
  await f.call('sync',{link_id:link.link_id,reads:[{event_id:'e',change_id:9}]});
  assert.equal((await f.call('sync',{link_id:link.link_id})).receipts.length,0);
  await f.call('read',{link_id:link.link_id,event_id:'e'},{mobile:true});
  await f.call('read',{link_id:link.link_id,event_id:'e'},{mobile:true});
  const receipts=await f.call('sync',{link_id:link.link_id});
  assert.equal(receipts.receipts.length,1);assert.equal(receipts.receipts[0].origin,'mobile');
  assert.equal((await f.call('sync',{link_id:link.link_id,receipt_cursor:receipts.receipt_cursor})).receipts.length,0);
  page=await f.call('events',{link_id:link.link_id},{mobile:true});assert.equal(page.events[0].receipts.length,2);
  await assert.rejects(f.call('read',{link_id:link.link_id,event_id:'missing'},{mobile:true}));
});

test('pagination never skips equal timestamps; revoked bindings and licenses block access',async()=>{
  const f=fixture(),link=await f.linked();
  await f.call('sync',{link_id:link.link_id,events:Array.from({length:60},(_,i)=>f.event('e'+i))});
  const page=await f.call('events',{link_id:link.link_id},{mobile:true});assert.equal(page.events.length,50);assert(page.has_more);
  assert.equal(page.events[0].event_id,'e59');
  const more=await f.call('events',{link_id:link.link_id,cursor:page.next_cursor},{mobile:true});assert.equal(more.events.length,10);
  f.revoked.add('desktop-1');
  assert.equal((await f.call('links',{}, {mobile:true})).links.length,0);
  await assert.rejects(f.call('events',{link_id:link.link_id},{mobile:true}));
  f.revoked.clear();f.revoked.add('mobile-1');await assert.rejects(f.call('sync',{link_id:link.link_id}));f.revoked.clear();
  await f.call('revoke',{link_id:link.link_id},{mobile:true});
  await f.call('revoke',{link_id:link.link_id},{mobile:true}); // lost response retry
  await assert.rejects(f.call('sync',{link_id:link.link_id}));
  await assert.rejects(f.call('events',{link_id:link.link_id},{mobile:true}));
  await assert.rejects(f.call('read',{link_id:link.link_id,event_id:'e1'},{mobile:true}));
});

test('replacement revokes only same owner, installation and scope',async()=>{
  const f=fixture(),paper=await f.linked(),live=await f.linked('live');
  await f.pair();
  await assert.rejects(f.call('sync',{link_id:paper.link_id}));
  assert.equal((await f.call('sync',{link_id:live.link_id})).state,'synced');
});

test('production HMAC verification rejects tampering, stale clocks and replay',async()=>{
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE analysis_replay_nonces(user_id INTEGER,nonce TEXT,request_hash TEXT,expires_at TEXT,created_at TEXT,UNIQUE(user_id,nonce))');
  const DB={prepare:q=>({bind:(...args)=>({run:async()=>db.prepare(q).run(...args)})})};
  const token='fixture-token', timestamp=String(Math.floor(Date.now()/1000)), nonce=randomUUID();
  const body={events:[]}, hash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const path='/v1/monitoring/desktop/sync';
  const signature=createHmac('sha256',token).update(`POST\n${path}\n${timestamp}\n${nonce}\n${hash}`).digest('hex');
  const verify=(data=body,changes={})=>__monitoringSecurityTest.verifyAnalysisRequestSignature({env:{DB,ANALYSIS_REQUIRE_REQUEST_SIGNATURE:'true'},request:new Request('https://test.invalid'+path,{method:'POST',headers:{Authorization:'Bearer '+token,'X-Scorpio-Timestamp':timestamp,'X-Scorpio-Nonce':nonce,'X-Scorpio-Signature':signature,...changes}})},{user:{id:1},requestBody:data});
  await assert.rejects(verify({events:['tampered']}),/signature_invalid/);
  await assert.rejects(verify(body,{'X-Scorpio-Timestamp':'1'}),/signature_expired/);
  await assert.rejects(verify(body,{'X-Scorpio-Signature':''}),/signature_incomplete/);
  await verify();
  await assert.rejects(verify(),/replay_detected/);
});
