import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createReader,decodeMemory,publicSnapshot} from '../lib/telemetry.js';
const current=1790307000000;
const frontier={status:{tick:100,version:'test',rooms:[{name:'W21N26'}]},telemetry:{capturedAt:current,rooms:{W21N26:{energy:550,history:[],roleCounts:{miner:2}}}},energy:{version:1,capturedAt:current,tick:100,rooms:{W21N26:{windows:{300:{G:15,eta:.75,coverage:1}}}}},token:'do-not-publish',rooms:{unowned:{plan:'do not publish'}}};
test('compressed memory and public schema retain real metric and exclude private planning/token',()=>{
  assert.deepEqual(decodeMemory('gz:'+gzipSync(JSON.stringify(frontier)).toString('base64')),frontier);
  const out=publicSnapshot(frontier,new Date(current).toISOString(),'SENTINEL');
  assert.equal(out.rooms.W21N26.energy.windows[300].G,15);assert.equal(out.rooms.W21N26.spawnEnergy,550);assert.equal(out.stale,false);
  assert(!JSON.stringify(out).includes('do-not-publish'));assert(!JSON.stringify(out).includes('do not publish'));
});
test('missing capture time and stopped game are stale even if HTTP fetch is new',()=>{
  assert.equal(publicSnapshot(frontier,new Date(current+301000).toISOString()).stale,true);
  assert.equal(publicSnapshot({status:{tick:2}},new Date(current).toISOString()).stale,true);
});
test('CPU attribution is public but secret or internal fields remain excluded',()=>{
  const out=publicSnapshot({...frontier,performance:{samples:20,mean:4.2,memoryBytes:180000,stages:{memory:{perTick:.8}},_debug:'hidden',authToken:'SENTINEL'}},new Date(current).toISOString(),'SENTINEL');
  assert.equal(out.cpu.performance.mean,4.2);assert.equal(out.cpu.performance.stages.memory.perTick,.8);
  assert(!JSON.stringify(out).includes('SENTINEL'));assert(!JSON.stringify(out).includes('hidden'));
});
test('fetch targets only fixed Screeps endpoint, deduplicates requests, caches, rejects redirects',async()=>{
  let calls=0,clock=current;const read=createReader({now:()=>clock,token:()=> 'SENTINEL',fetchImpl:async(url,options)=>{
    calls++;assert.equal(url,'https://screeps.com/api/user/memory?shard=shard1&path=frontier');assert.equal(options.redirect,'error');assert.equal(options.headers['X-Token'],'SENTINEL');
    return {ok:true,status:200,text:async()=>JSON.stringify({ok:1,data:frontier})};
  }});
  await Promise.all([read(),read(),read()]);assert.equal(calls,1);clock+=119000;await read();assert.equal(calls,1);clock+=2000;await read();assert.equal(calls,2);
});
test('auth failures never return token or raw upstream body and are throttled',async()=>{
  let calls=0;const read=createReader({now:()=>current,token:()=> 'SENTINEL',fetchImpl:async()=>{calls++;return {ok:false,status:401,text:async()=> 'SENTINEL'};}});
  await assert.rejects(read(),e=>e.code==='AUTH_REQUIRED'&&!e.message.includes('SENTINEL'));await assert.rejects(read());assert.equal(calls,1);
});
test('upstream failure retains cached data with explicit stale warning',async()=>{
  let clock=current,calls=0;const read=createReader({now:()=>clock,token:()=> 'SENTINEL',fetchImpl:async()=>{
    if(++calls>1)throw new Error('SENTINEL');return {ok:true,status:200,text:async()=>JSON.stringify({ok:1,data:frontier})};
  }});const first=await read();clock+=121000;const stale=await read();assert.equal(stale.stale,true);assert.equal(stale.fetchedAt,first.fetchedAt);assert(!JSON.stringify(stale).includes('SENTINEL'));
});
test('cached snapshot becomes stale as wall clock advances',async()=>{
  let clock=current+299000;
  const read=createReader({now:()=>clock,token:()=> 'test',fetchImpl:async()=>({ok:true,status:200,text:async()=>JSON.stringify({ok:1,data:frontier})})});
  assert.equal((await read()).stale,false);clock+=2000;assert.equal((await read()).stale,true);
});
test('429 respects Retry-After longer than the default backoff',async()=>{
  let clock=current,calls=0;
  const read=createReader({now:()=>clock,token:()=> 'test',fetchImpl:async()=>{calls++;return {status:429,headers:{get:()=> '900'}};}});
  await assert.rejects(read(),e=>e.code==='RATE_LIMITED');clock+=301000;await assert.rejects(read());assert.equal(calls,1);
  clock+=600000;await assert.rejects(read());assert.equal(calls,2);
});
