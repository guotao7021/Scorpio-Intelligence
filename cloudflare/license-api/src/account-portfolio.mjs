import {canonical,digest} from './minute-delivery.mjs';
import {normalizePortfolioInput,analyzeAccountPortfolio,previewAccountScenario,requirePortfolio as check} from './account-portfolio-model.mjs';

export async function accountPortfolioId(userId){return 'map-'+(await digest('mobile-account|'+userId)).slice(0,24);}
export async function loadAccountInput(env,userId,now=new Date()) {
  const row=await env.DB.prepare('SELECT * FROM mobile_account_portfolios WHERE user_id=?').bind(userId).first();
  const pid=await accountPortfolioId(userId);
  if(row&&row.revision>0)return {portfolio_id:pid,revision:row.revision,input:JSON.parse(row.input_json),input_hash:row.input_hash,recorded_at:row.updated_at};
  const old=await env.DB.prepare('SELECT positions_json,updated_at FROM mobile_portfolio_snapshots WHERE user_id=?').bind(userId).first();
  const raw=old?.positions_json||'[]',positions=JSON.parse(raw);
  let input,warnings=[];
  try{input=normalizePortfolioInput({positions,currency:'CNY'},now,{legacy:true});}
  catch{check(Array.isArray(positions),'portfolio_legacy_input_invalid',409);
    check(positions.length<=200,'portfolio_legacy_limit_requires_review',409);
    // Preserve the old store; never silently discard an invalid legacy row.
    throw Object.assign(new Error('portfolio_legacy_input_requires_review'),{status:409,publicMessage:'portfolio_legacy_input_requires_review'});}
  if(positions.length)warnings=['旧持仓时间和现金尚未确认；保存前请核对，旧价格未作为当前行情使用。'];
  return {portfolio_id:pid,revision:0,input,input_hash:'sha256:'+await digest(canonical(input)),legacy_hash:'sha256:'+await digest(raw),
    legacy_raw:raw,recorded_at:old?.updated_at??null,warnings};
}
function ownership(state,body){check(!body.portfolio_id||body.portfolio_id===state.portfolio_id,'portfolio_not_found',404);}
export async function saveAccountInput(env,userId,body,now=new Date()) {
  const state=await loadAccountInput(env,userId,now);ownership(state,body);
  check(Number.isSafeInteger(body.expected_revision)&&body.expected_revision>=0,'portfolio_expected_revision_required');
  check(typeof body.idempotency_key==='string'&&/^[A-Za-z0-9_-]{16,96}$/.test(body.idempotency_key),'portfolio_idempotency_required');
  const input=normalizePortfolioInput(body.input,now),text=canonical(input),hash='sha256:'+await digest(text),stamp=new Date(now).toISOString();
  const prior=await env.DB.prepare('SELECT revision,input_hash FROM mobile_account_portfolio_revisions WHERE user_id=? AND request_key=?').bind(userId,body.idempotency_key).first();
  if(prior){check(prior.input_hash===hash,'portfolio_idempotency_conflict',409);return {...await loadAccountInput(env,userId,now),saved_revision:prior.revision,idempotent:true};}
  check(state.revision===body.expected_revision,'portfolio_revision_conflict',409);
  if(state.revision===0)check(body.legacy_hash===state.legacy_hash,'portfolio_legacy_changed',409);
  const revision=state.revision+1;
  const results=await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO mobile_account_portfolios(user_id,portfolio_id,updated_at) VALUES(?,?,?)").bind(userId,state.portfolio_id,stamp),
    env.DB.prepare(`UPDATE mobile_account_portfolios SET revision=?,input_json=?,input_hash=?,request_key=?,updated_at=?
      WHERE user_id=? AND revision=? AND (?<>0 OR COALESCE((SELECT positions_json FROM mobile_portfolio_snapshots WHERE user_id=?),'[]')=?)`)
      .bind(revision,text,hash,body.idempotency_key,stamp,userId,state.revision,state.revision,userId,state.legacy_raw||'[]'),
    env.DB.prepare(`INSERT OR IGNORE INTO mobile_account_portfolio_revisions(user_id,revision,request_key,input_json,input_hash,recorded_at)
      SELECT user_id,revision,request_key,input_json,input_hash,updated_at FROM mobile_account_portfolios
      WHERE user_id=? AND revision=? AND input_hash=? AND request_key=?`).bind(userId,revision,hash,body.idempotency_key),
  ]);
  const saved=await env.DB.prepare('SELECT revision,input_hash FROM mobile_account_portfolio_revisions WHERE user_id=? AND request_key=?').bind(userId,body.idempotency_key).first();
  check(saved&&saved.input_hash===hash,'portfolio_revision_conflict',409);
  return {...await loadAccountInput(env,userId,now),saved_revision:saved.revision,idempotent:Number(results[1]?.meta?.changes??results[1]?.changes??0)===0};
}
export async function assertLegacyPortfolioWritable(env,userId){
  // Before migration deployment legacy clients keep their existing behavior.
  const table=await env.DB.prepare("SELECT 1 AS n FROM sqlite_master WHERE type='table' AND name='mobile_account_portfolios'").first();
  if(!table)return;
  const active=await env.DB.prepare('SELECT revision FROM mobile_account_portfolios WHERE user_id=?').bind(userId).first();
  check(!active||active.revision===0,'portfolio_upgrade_required',409);
}
export async function saveLegacyPortfolioInput(env,userId,positions,stamp){
  const table=await env.DB.prepare("SELECT 1 AS n FROM sqlite_master WHERE type='table' AND name='mobile_account_portfolios'").first();
  // The conditional write closes the race between a legacy request's precheck and first v2 save.
  const guard=table?'NOT EXISTS(SELECT 1 FROM mobile_account_portfolios WHERE user_id=? AND revision>0)':'1';
  const sql=`INSERT INTO mobile_portfolio_snapshots(user_id,positions_json,updated_at) SELECT ?,?,? WHERE ${guard}
    ON CONFLICT(user_id) DO UPDATE SET positions_json=excluded.positions_json,updated_at=excluded.updated_at WHERE ${guard}`;
  const args=[userId,JSON.stringify(positions||[]),stamp];if(table)args.push(userId,userId);
  const result=await env.DB.prepare(sql).bind(...args).run();
  check(Number(result?.meta?.changes??result?.changes??0)>0,'portfolio_upgrade_required',409);
}
export function registerAccountPortfolioRoutes({route,readJson,json,authorize,resolveFacts,clock=()=>new Date()}) {
  const query=async(ctx,user,license,body)=>{
    const state=await loadAccountInput(ctx.env,user.id,clock());ownership(state,body);
    const facts=await resolveFacts(ctx,license,state.input.positions);
    return analyzeAccountPortfolio(state,facts,clock());
  };
  for(const action of ['query','snapshot','scenario','plans','history']){
    const path='/v2/mobile/portfolio/'+action;
    route(action==='snapshot'?'PUT':'POST',path,async ctx=>{
      const body=await readJson(ctx.request),{user,license}=await authorize(ctx,body,path);
      if(action==='snapshot'){
        // Validate values and the quote-dependent amount bounds before committing input.
        const input=normalizePortfolioInput(body.input,clock()),facts=await resolveFacts(ctx,license,input.positions);
        await analyzeAccountPortfolio({portfolio_id:await accountPortfolioId(user.id),revision:body.expected_revision,
          input,input_hash:'preflight'},facts,clock());
        const state=await saveAccountInput(ctx.env,user.id,body,clock());
        // A retried old operation can return a newer head: resolve that head's facts too.
        const currentFacts=state.input_hash==='sha256:'+await digest(canonical(input))?facts:await resolveFacts(ctx,license,state.input.positions);
        return json({ok:true,portfolio:await analyzeAccountPortfolio(state,currentFacts,clock()),saved_revision:state.saved_revision,idempotent:state.idempotent});
      }
      if(action==='query')return json({ok:true,portfolio:await query(ctx,user,license,body)});
      const state=await loadAccountInput(ctx.env,user.id,clock());ownership(state,body);
      if(action==='history'){
        const rows=await ctx.env.DB.prepare('SELECT revision,input_hash,recorded_at FROM mobile_account_portfolio_revisions WHERE user_id=? ORDER BY revision DESC LIMIT 30').bind(user.id).all();
        const plans=await ctx.env.DB.prepare('SELECT plan_id,revision,analysis_key,scenario_json,recorded_at FROM mobile_account_portfolio_plans WHERE user_id=? ORDER BY recorded_at DESC LIMIT 20').bind(user.id).all();
        const current=plans.results?.length?await query(ctx,user,license,body):null;
        return json({ok:true,revisions:rows.results,plans:(plans.results||[]).map(({scenario_json,...p})=>({...p,
          scenario:JSON.parse(scenario_json),state:p.revision!==state.revision?'superseded':p.analysis_key!==current?.analysis_key?'expired':'reference'}))});
      }
      const analysis=await query(ctx,user,license,body),scenario=await previewAccountScenario(analysis,body);
      if(action==='scenario')return json({ok:true,scenario});
      check(typeof body.plan_id==='string'&&/^[A-Za-z0-9_-]{16,96}$/.test(body.plan_id),'portfolio_plan_id_required');
      const serialized=canonical(scenario);
      const prior=await ctx.env.DB.prepare('SELECT scenario_json FROM mobile_account_portfolio_plans WHERE user_id=? AND plan_id=?').bind(user.id,body.plan_id).first();
      if(prior)check(prior.scenario_json===serialized,'portfolio_plan_idempotency_conflict',409);
      await ctx.env.DB.prepare(`INSERT OR IGNORE INTO mobile_account_portfolio_plans(user_id,plan_id,revision,analysis_key,scenario_json,recorded_at)
        SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM mobile_account_portfolios WHERE user_id=? AND revision=?)`)
        .bind(user.id,body.plan_id,analysis.revision,analysis.analysis_key,serialized,new Date(clock()).toISOString(),user.id,analysis.revision).run();
      const saved=await ctx.env.DB.prepare('SELECT revision FROM mobile_account_portfolio_plans WHERE user_id=? AND plan_id=?').bind(user.id,body.plan_id).first();
      check(saved,'portfolio_revision_conflict',409);
      return json({ok:true,plan_id:body.plan_id,state:scenario.state,orders_authorized:false,scenario});
    });
  }
}
