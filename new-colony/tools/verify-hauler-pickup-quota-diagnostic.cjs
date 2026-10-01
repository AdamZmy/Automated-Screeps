'use strict';
// Known-fault diagnostic; update the quota assertions after a production fix.
// resizeAtArrival is a sandbox-only counterfactual, never a live mutation.
// Isolated diagnostic: reads production modules and the existing multi-tick
// fixture, never changes production source, Memory, game state, or APIs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const base=path.resolve(__dirname,'..'),testFile=path.join(base,'verify-logistics.cjs');
const req=createRequire(testFile),testSource=fs.readFileSync(testFile,'utf8');
const prefix=testSource.slice(0,testSource.indexOf('\n{\n const f=fixture()'));
assert(prefix.length>1000);
const fixture=new Function('require',prefix+'\nreturn fixture;')(req);
const {constants:C}=req('./test-support/runtime.cjs');
const result={scope:'production logistics in existing engine-constant fixture; deterministic open terrain; physical stores settle next tick; no live throughput claim',cases:[]};
function growthCase({name,peer=false,growth=10,resizeAtArrival=false}){
 const f=fixture(),dest=f.station('demand',18,5,300),src=f.box('mine',5,5,peer?99:9),a=f.creep('a',15,5,0,450);
 const b=peer?f.creep('b',16,6,0,450):null;
 if(b)f.task(b,dest,src.id,90);
 f.logistics.prepare(f.room);assert.equal(a.memory.haul.task.amount,9);
 const rows=[];let settled=null;
 for(let i=0;i<14;i++){
  f.logistics.prepare(f.room);
  const t=a.memory.haul.task,otherPickup=b?.memory.haul.task?.pickupAmount||0;
  const free=f.runtime.availableEnergy(src)-otherPickup;
  const otherDelivery=b?.memory.haul.task?.amount||0;
  const feasible=Math.min(a.store.getFreeCapacity(),free,dest.store.getFreeCapacity()-otherDelivery);
  const adjacent=a.pos.getRangeTo(src)<=1;
  if(resizeAtArrival&&adjacent){t.amount=feasible;t.pickupAmount=feasible;}
  rows.push({tick:f.ctx.Game.time,x:a.pos.x,y:a.pos.y,source:f.value(src),amount:t.amount,otherPickup,free,feasible,adjacent});
  f.logistics.haul(a);
  const intent=a.memory.haul.task?.intent;
  f.settle();
  if(intent?.kind==='pickup'){
   settled={tick:f.ctx.Game.time,cargo:f.value(a),source:f.value(src),peerAmount:b?.memory.haul.task?.amount||0,actualIntent:intent.amount,feasibleAtPickup:feasible};
   f.logistics.prepare(f.room);settled.nextState=a.memory.haul.state;
   break;
  }
  src.store[C.RESOURCE_ENERGY]+=growth;
 }
 assert(settled,'pickup must actually settle');
 assert.equal(settled.cargo,resizeAtArrival?settled.feasibleAtPickup:9);
 if(peer)assert.equal(settled.peerAmount,90,'counterfactual must protect existing peer promise');
 result.cases.push({name,growth,peer,resizeAtArrival,rows,settled});
}
growthCase({name:'one-car-growing-source'});
growthCase({name:'one-car-growing-source-resize-oracle',resizeAtArrival:true});
growthCase({name:'peer-claim-growing-source',peer:true});
growthCase({name:'peer-claim-growing-source-resize-oracle',peer:true,resizeAtArrival:true});
growthCase({name:'peer-claim-scarce-source-control',peer:true,growth:0});
{
 const f=fixture(),src=f.box('full-mine',5,5,1000),c=f.creep('extension-courier',6,5,0,450);
 const destinations=[0,1,2].map(i=>f.node(C.STRUCTURE_EXTENSION,'extension-'+i,12+i,5,0,50));
 f.logistics.prepare(f.room);
 const assigned={target:c.memory.haul.task.id,amount:c.memory.haul.task.amount,priority:c.memory.haul.task.priority,totalDemand:150};
 f.logistics.haul(c);f.settle();assert.equal(f.value(c),50);
 result.cases.push({name:'individual-extension-demand',assigned,settledCargo:f.value(c),sourceRemaining:f.value(src),destinations:destinations.length});
}
{
 const f=fixture(),dest=f.station('demand',18,5,300),src=f.box('mine',5,5,500);
 const a=f.creep('a',6,5,0,450),b=f.creep('b',6,6,0,450);
 f.logistics.prepare(f.room);const assignments=[a,b].map(c=>({name:c.name,amount:c.memory.haul.task.amount}));
 for(const c of[a,b])f.logistics.haul(c);f.settle();
 assert.equal(f.value(a)+f.value(b),500);assert.equal(f.value(a),450);assert.equal(f.value(b),50);
 result.cases.push({name:'legitimate-source-sharing',sourceInitial:500,assignments,settled:[f.value(a),f.value(b)]});
}
{
 const f=fixture(),dest=f.station('demand',18,5,300),src=f.box('mine',5,5,9),a=f.creep('only-car',6,5,0,450);
 f.logistics.prepare(f.room);f.logistics.haul(a);f.settle();assert.equal(f.value(a),9);assert.equal(f.value(src),0);
 result.cases.push({name:'legitimate-source-scarcity',sourceInitial:9,capacity:450,settledCargo:f.value(a),sourceRemaining:f.value(src)});
}
{
 const f=fixture(),dest=f.station('demand',18,5,300),src=f.box('mine',5,5,1000),a=f.creep('new-trip',17,5,9,450);
 f.task(a,dest,src.id,9,'deliver');f.logistics.prepare(f.room);f.logistics.haul(a);f.settle();
 assert.equal(f.value(a),0);f.logistics.prepare(f.room);assert.equal(a.memory.haul.task.amount,450);
 result.cases.push({name:'L008-cross-trip-control',oldAmount:9,nextTripAmount:a.memory.haul.task.amount});
}
console.log(JSON.stringify(result.cases.map(({rows,...c})=>c),null,2));
