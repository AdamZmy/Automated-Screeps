'use strict';
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'inspect-transport-run.js'),'utf8'),clear=fs.readFileSync(path.join(__dirname,'clear-transport-probe.js'),'utf8');
for(const s of [source,clear])assert(JSON.stringify(s).length<=1024);
let calls=0;const original=()=>calls++,monitor={tick:original};
const room={getEventLog:()=>[{event:12,objectId:'box',data:{targetId:'courier',amount:100,resourceType:'energy'}},{event:1,data:{}}],controller:{progress:10}};
const courier={id:'courier',memory:{role:'hauler',haulPickup:{id:'box'}},room,pos:{x:10,y:11},store:{energy:100},fatigue:0,getActiveBodyparts:()=>0};
const ctx={require:()=>monitor,Memory:{frontier:{}},Game:{time:100,rooms:{W21N26:room},creeps:{courier}},WORK:'work',EVENT_TRANSFER:12};vm.createContext(ctx);
vm.runInContext(source,ctx);assert.throws(()=>vm.runInContext(source,ctx),/probe active/);
for(let t=101;t<=280;t++){ctx.Game.time=t;ctx.Memory={frontier:{}};monitor.tick([]);}
const result=ctx.Memory.frontier.transportProbe;assert.equal(calls,180);assert.equal(result.rows.length,180);assert.equal(result.done,280);assert.equal(monitor.tick,original);assert.equal(monitor.__probe,undefined);
assert.equal(result.rows[0][1][0][0],'courier');assert.equal(result.rows[0][2].length,1);assert.equal(result.rows[0][2][0][2],100);
vm.runInContext(clear,ctx);assert.equal(ctx.Memory.frontier.transportProbe,undefined);
vm.runInContext(source,ctx);room.getEventLog=()=>{throw Error('fixture')};ctx.Game.time++;monitor.tick([]);assert.equal(monitor.tick,original);assert.match(ctx.Memory.frontier.transportProbe.error,/fixture/);
vm.runInContext(source,ctx);vm.runInContext(clear,ctx);assert.equal(monitor.tick,original);assert.equal(monitor.__probe,undefined);
console.log('PASS: console limits, observed transfer tuples, fresh Memory attachment, bounded expiry, duplicate guard, error restoration and explicit cleanup');
