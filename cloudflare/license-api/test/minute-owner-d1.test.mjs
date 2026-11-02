import test from 'node:test';
import assert from 'node:assert/strict';
import {boundBatches,ownerD1} from '../../../scripts/minute_owner_d1.mjs';

test('large public payload stays in parameters and batches respect UTF-8 byte/count budgets',()=>{
  const statements=Array.from({length:11},()=>({sql:'INSERT INTO test VALUES (?)',params:['中文'.repeat(18000)]}));
  const batches=boundBatches(statements,{maxBytes:220000,maxStatements:3});
  assert.equal(batches.flat().length,11);
  assert.ok(batches.every(b=>Buffer.byteLength(JSON.stringify({batch:b}))<=220000 && b.length<=3));
  assert.ok(batches.flat().every(s=>s.sql.length<50 && !s.sql.includes('中文')));
  assert.throws(()=>boundBatches(statements,{maxBytes:100}),/budget/);
});

test('bound API retry repeats identical request; safe errors do not echo credentials or raw response',async()=>{
  const calls=[];
  const client=ownerD1('SECRET',{retryDelay:async()=>{},fetchImpl:async(url,options)=>{
    calls.push({url,options});
    return calls.length===1?{status:503,ok:false}:{status:200,ok:true,json:async()=>({success:true,
      result:[{success:true,results:[],meta:{rows_written:1}}]})};
  }});
  const batch=[{sql:'INSERT INTO test VALUES (?)',params:['a'.repeat(200000)]}];
  assert.equal((await client.execute(batch))[0].meta.rows_written,1);
  assert.equal(calls.length,2);
  assert.equal(calls[0].options.body,calls[1].options.body);
  assert.equal(calls[0].options.redirect,'error');
  assert.match(calls[0].url,/\/d1\/database\/44338085-38a1-4283-b6c9-91fb0d78e0ac\/query$/);
  const denied=ownerD1('SECRET',{fetchImpl:async()=>({ok:false,status:403,json:async()=>({error:'SECRET'})})});
  await assert.rejects(()=>denied.execute(batch),e=>e.message.includes('403') && !e.message.includes('SECRET'));
});

test('read helper rejects mutation and validates rows_written even for SELECT',async()=>{
  const client=ownerD1('test',{fetchImpl:async()=>({ok:true,status:200,json:async()=>({success:true,
    result:[{success:true,results:[],meta:{rows_written:1}}]})})});
  await assert.rejects(()=>client.select('DELETE FROM test'),/SELECT/);
  await assert.rejects(()=>client.select('SELECT 1'),/mutated/);
});
