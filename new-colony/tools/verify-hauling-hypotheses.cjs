'use strict';
// Bounded, read-only diagnosis. Loads current policy and pinned engine snippets;
// never calls Screeps, writes Memory outside this VM, or changes game source.
// BFS proves tile connectivity only; this is not a complete movement simulator.
// The multi-port oracle requires correct behavior: it intentionally fails .12.
// Other candidate mechanisms are printed with their evidence limitations.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {constants:C,enginePath:engine,readSource}=require('../test-support/runtime.cjs');
const lodash=require(require.resolve('lodash',{paths:[engine]}));
const utility={};
function fragment(file,startText,endText){
 const source=fs.readFileSync(engine+'/src/'+file,'utf8'),start=source.indexOf(startText),end=source.indexOf(endText,start)+endText.length;
 assert(start>=0&&end>start,'pinned engine fragment exists: '+file);return source.slice(start,end);
}
vm.runInNewContext(fragment('utils.js','exports.fetchXYArguments = function(','\n};'),{exports:utility,_:lodash});
class Position{constructor(x,y,roomName='W21N26'){Object.assign(this,{x,y,roomName});}}
vm.runInNewContext(fragment('game/rooms.js','RoomPosition.prototype.getRangeTo = register.wrapFn(','\n    });'),
 {RoomPosition:Position,register:{wrapFn:f=>f},utils:utility,globals:{RoomPosition:Position},max:Math.max,abs:Math.abs});
function engineProcessor(relative){
 const mod={exports:{}},utils={getDriver:()=>({constants:C}),capacityForResource:o=>o.storeCapacity,
  calcResources:o=>Object.values(o.store||{}).reduce((n,v)=>n+v,0)};
 vm.runInNewContext(fs.readFileSync(engine+'/src/processor/intents/'+relative+'.js','utf8'),
  {module:mod,console,require:id=>{if(id==='lodash')return lodash;if(id==='../../../utils')return utils;throw Error(id);}});
 return mod.exports;
}
const transfer=engineProcessor('creeps/transfer'),pickup=engineProcessor('creeps/pickup'),decay=engineProcessor('energy/tick');
const context={...C,module:{exports:{}},console,RoomPosition:Position,Game:{},Memory:{},global:{}};
vm.createContext(context);vm.runInContext(readSource('main.js')+'\nmodule.exports.review={VERSION,range,walkable,controllerStation,deliverHaul,haulTarget,collectHaul,body,workforceDemand};',context);
const policy=context.module.exports.review;
const reviewed=JSON.parse(readSource('fixtures/layout-plan-reviewed.json'));
const world=JSON.parse(readSource('fixtures/layout-world-before.json'));
const key=p=>p.x+','+p.y,cost=b=>b.reduce((n,p)=>n+C.BODYPART_COST[p],0);
function fixture(){
 context.Game={time:73931363,creeps:{},rooms:{}};
 context.Memory={frontier:{rooms:{W21N26:{plan:structuredClone(reviewed)}},intel:{}}};
 const room={name:'W21N26',energyAvailable:800,energyCapacityAvailable:800,objects:[],
  getTerrain:()=>({get:(x,y)=>Number(world.terrain[y*50+x])}),
  lookForAt(type,x,y){return this.objects.filter(o=>o.structureType&&o.pos.x===x&&o.pos.y===y);},
  find(type,options){let result=type===C.FIND_SOURCES?this.objects.filter(o=>o.source):
   type===C.FIND_MY_CREEPS?Object.values(context.Game.creeps).filter(c=>c.room.name===this.name):type===C.FIND_STRUCTURES?this.objects.filter(o=>o.structureType):
   type===C.FIND_MY_STRUCTURES?this.objects.filter(o=>o.my&&o.structureType):
   type===C.FIND_MY_SPAWNS?this.objects.filter(o=>o.structureType===C.STRUCTURE_SPAWN):
   type===C.FIND_DROPPED_RESOURCES?this.objects.filter(o=>o.resourceType):[];
   return options&&options.filter?result.filter(options.filter):result;
  }};
 const pos=(x,y)=>new Position(x,y,room.name),store=(energy,capacity)=>({energy,getFreeCapacity(){return capacity-this.energy;}});
 for(const s of world.objects.sources)room.objects.push({...s,pos:pos(s.x,s.y),source:true,energyCapacity:3000,energy:3000});
 room.controller={my:true,level:3,ticksToDowngrade:20000,pos:pos(world.objects.controller.x,world.objects.controller.y)};
 for(const s of world.structures)room.objects.push({id:s.id,structureType:s.type,my:s.type!==C.STRUCTURE_CONTAINER,pos:pos(s.x,s.y),
  store:store(s.type===C.STRUCTURE_CONTAINER?2000:s.type===C.STRUCTURE_SPAWN?300:s.type===C.STRUCTURE_EXTENSION?50:480,
   s.type===C.STRUCTURE_CONTAINER?2000:s.type===C.STRUCTURE_SPAWN?300:s.type===C.STRUCTURE_EXTENSION?50:1000)});
 context.Game.rooms[room.name]=room;context.Game.getObjectById=id=>room.objects.find(o=>o.id===id)||Object.values(context.Game.creeps).find(o=>o.id===id);
 Position.prototype.findClosestByPath=function(choices){return choices.filter(t=>path(this,t.pos||t,1)).sort((a,b)=>this.getRangeTo(a)-this.getRangeTo(b))[0]||null;};
 Position.prototype.findClosestByRange=Position.prototype.findClosestByPath;
 Position.prototype.findPathTo=function(target,options={}){
  const self=Object.values(context.Game.creeps).find(c=>c.pos===this);
  const blocked=new Set();if(options.costCallback)options.costCallback(room.name,{set:(x,y,value)=>{if(value>=255)blocked.add(x+','+y);}});
  const route=path(this,target.pos||target,options.range??0,self&&self.name,blocked);
  return route?route.slice(1).map(p=>({x:p.x,y:p.y})):[];
 };
 function occupied(p,ignore){return Object.values(context.Game.creeps).some(c=>c.name!==ignore&&key(c.pos)===key(p));}
 function path(from,to,range=0,ignore,blocked=new Set()){
  const queue=[[from]],seen=new Set([key(from)]);
  for(let i=0;i<queue.length;i++){
   const route=queue[i],last=route.at(-1);if(policy.range(last,to)<=range)return route;
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const p={x:last.x+dx,y:last.y+dy};if(seen.has(key(p))||blocked.has(key(p))||!policy.walkable(room,p)||occupied(p,ignore))continue;
    seen.add(key(p));queue.push(route.concat(p));
   }
  }return null;
 }
 function creep(name,role,x,y,energy=100,capacity=100,parts=[C.CARRY,C.CARRY,C.MOVE,C.MOVE]){
  const c={name,id:name,room,pos:pos(x,y),memory:{role,home:room.name,loaded:energy>0},store:store(energy,capacity),body:parts,
   ticksToLive:1000,fatigue:0,actions:[],getActiveBodyparts:p=>parts.filter(part=>part===p).length,
   transfer(t,resource,amount){const result=this.pos.getRangeTo(t)<=1?C.OK:C.ERR_NOT_IN_RANGE;this.actions.push(['transfer',t.id,amount,result]);return result;},
   moveTo(t,options){this.actions.push(['move',t.x,t.y,options.range]);return C.OK;},
   pickup(t){this.actions.push(['pickup',t.id]);return this.pos.getRangeTo(t)<=1?C.OK:C.ERR_NOT_IN_RANGE;},
   withdraw(t,resource,amount){this.actions.push(['withdraw',t.id,amount]);return this.pos.getRangeTo(t)<=1?C.OK:C.ERR_NOT_IN_RANGE;}};
  context.Game.creeps[name]=c;return c;
 }
 const box=room.objects.find(o=>o.id==='6ab59a7329a7d77d2cb18ca2');box.store.energy=27;
 function delivery(c,amount=c.store.energy){c.memory.haulDelivery={id:box.id,room:room.name,amount,priority:2,expires:context.Game.time+200,position:key(c.pos),progress:context.Game.time};}
 return {room,pos,store,creep,box,path,occupied,delivery};
}
const report={version:policy.VERSION,checks:[],limitations:[],planning:[]},regressions=[];
{
 const f=fixture(),p=f.pos(16,21);
 assert(Number.isNaN(p.getRangeTo({x:16,y:23})));assert.equal(p.getRangeTo(16,23),2);
 assert.equal(policy.range(p,{x:16,y:23}),2);assert.equal(p.getRangeTo(new Position(16,23,'W22N26')),Infinity);
 const station=policy.controllerStation(f.room);assert.equal(station.seats.length,4);assert.deepEqual([station.port.x,station.port.y],[17,24]);
 report.checks.push('Official coordinate overload rejects plain objects; normalized current station has four seats.');
}
{
 const f=fixture(),station=policy.controllerStation(f.room);
 for(let i=0;i<station.seats.length;i++){const p=station.seats[i];f.creep('seat'+i,'upgrader',p.x,p.y,30,50,[C.WORK,C.CARRY,C.MOVE]);}
 f.creep('port-blocker','upgrader',17,24,50,50,[C.WORK,C.CARRY,C.MOVE]);
 const c=f.creep('courier','hauler',17,25);f.delivery(c);
 const alternatives=[];
 for(let y=f.box.pos.y-1;y<=f.box.pos.y+1;y++)for(let x=f.box.pos.x-1;x<=f.box.pos.x+1;x++){
  const p={x,y};if(policy.walkable(f.room,p)&&!f.occupied(p)&&f.path(c.pos,p,0,c.name))alternatives.push(p);
 }
 assert(alternatives.length>0,'actual terrain retains reachable legal transfer tiles with port occupied');
 policy.deliverHaul(c,f.box);const move=c.actions.find(a=>a[0]==='move');
 assert(move,'out-of-range courier asks to move');
 const forcedPort=move[1]===station.port.x&&move[2]===station.port.y&&move[3]===0;
 const chosen={x:move[1],y:move[2]},legalAlternative=move[3]===0&&policy.range(chosen,f.box)<=1&&
  !f.occupied(chosen,c.name)&&!station.seats.some(p=>key(p)===key(chosen))&&!!f.path(c.pos,chosen,0,c.name);
 if(forcedPort||!legalAlternative)regressions.push('L002: occupied preferred port must route to an unoccupied, reachable adjacent non-worker tile.');
 for(let n=0;n<4;n++){context.Game.time++;policy.deliverHaul(c,f.box);}
 report.limitations.push({case:'occupied-preferred-port',reachableAlternatives:alternatives.map(key),forcedPort,
  targetCooldown:c.memory.haulBlocked?.[f.box.id]-context.Game.time||0,
  evidence:'Actual policy intents plus terrain/occupancy BFS. Movement resolution is not simulated.'});
 for(const p of alternatives){
  c.pos=f.pos(p.x,p.y);c.actions=[];f.delivery(c);assert.equal(policy.deliverHaul(c,f.box),true);
  assert.equal(c.actions[0][0],'transfer');assert.equal(c.actions[0][3],C.OK);
  const truck={_id:'truck',x:p.x,y:p.y,store:{energy:100},storeCapacity:100};
  const box={_id:'box',x:f.box.pos.x,y:f.box.pos.y,type:'container',store:{energy:27},storeCapacity:2000};
  const events=[];transfer(truck,{id:'box',resourceType:C.RESOURCE_ENERGY,amount:100},{roomObjects:{box},bulk:{update(){}},eventLog:events});
  assert.equal(box.store.energy,127);assert.equal(events[0].data.amount,100);
 }
 report.checks.push('Every reachable alternative adjacent tile accepts a transfer in both policy and official transfer processor.');
}
{
 const f=fixture(),a=f.creep('first','hauler',17,25),b=f.creep('second','hauler',18,25);
 f.delivery(a);f.delivery(b);policy.deliverHaul(a,f.box);policy.deliverHaul(b,f.box);
 assert(a.memory.haulDelivery?.port&&b.memory.haulDelivery?.port,'two reachable endpoints produce separate spatial claims');
 assert.notEqual(key(a.memory.haulDelivery.port),key(b.memory.haulDelivery.port),'same-tick active claims must be exclusive');
 a.pos=f.pos(a.memory.haulDelivery.port.x,a.memory.haulDelivery.port.y);a.actions=[];policy.deliverHaul(a,f.box);
 assert.equal(a.memory.haulDelivery.sent,context.Game.time);assert.equal(a.memory.haulDelivery.amount,100);
 assert.equal(a.memory.haulDelivery.port,undefined,'transfer releases spatial claim while amount remains reserved until next tick');
 report.checks.push('Same-tick couriers use distinct endpoints; delivered cargo retains amount lease but releases spatial claim.');
}
for(const invalidation of ['death','expiry','target-destroyed','already-sent']){
 const f=fixture(),station=policy.controllerStation(f.room),waiting=f.creep('waiting','hauler',17,25),peer=f.creep('peer','hauler',20,27);
 f.delivery(waiting);f.delivery(peer);Object.assign(peer.memory.haulDelivery,{phase:'deliver',port:{...station.port}});
 if(invalidation==='death')delete context.Game.creeps.peer;
 if(invalidation==='expiry')peer.memory.haulDelivery.expires=context.Game.time;
 if(invalidation==='target-destroyed')peer.memory.haulDelivery.id='missing-node';
 if(invalidation==='already-sent')peer.memory.haulDelivery.sent=context.Game.time;
 policy.deliverHaul(waiting,f.box);assert.equal(key(waiting.memory.haulDelivery.port),key(station.port),invalidation+' must release preferred endpoint');
}
report.checks.push('Dead, expired, destroyed-target and already-sent spatial claims do not block another courier.');
{
 const f=fixture(),c=f.creep('fatigued','hauler',17,25);f.delivery(c);policy.deliverHaul(c,f.box);
 const saved=JSON.stringify(c.memory.haulDelivery.port),moves=c.actions.filter(a=>a[0]==='move').length;
 c.fatigue=5;context.Game.time+=8;policy.deliverHaul(c,f.box);
 assert.equal(JSON.stringify(c.memory.haulDelivery.port),saved);assert.equal(c.actions.filter(a=>a[0]==='move').length,moves);
 assert(!c.memory.haulBlocked?.[f.box.id]);assert.equal(c.memory.haulDelivery.progress,context.Game.time);
 c.fatigue=0;context.Game.time++;policy.deliverHaul(c,f.box);assert(c.memory.haulDelivery);
 report.checks.push('Fatigue retains the endpoint without movement, false failure or node cooldown; recovery receives fresh progress.');
}
{
 const f=fixture(),station=policy.controllerStation(f.room),c=f.creep('local','hauler',17,25),peer=f.creep('foreign','hauler',20,27);
 f.delivery(c);peer.room={name:'W22N26'};peer.pos=new Position(20,27,'W22N26');
 const remote={id:'remote-node',structureType:C.STRUCTURE_CONTAINER,pos:new Position(16,23,'W22N26'),store:f.store(0,2000)};
 const prior=context.Game.getObjectById;context.Game.getObjectById=id=>id===remote.id?remote:prior(id);
 peer.memory.haulDelivery={id:remote.id,room:'W22N26',amount:100,phase:'deliver',expires:context.Game.time+100,port:{...station.port}};
 policy.deliverHaul(c,f.box);assert.equal(key(c.memory.haulDelivery.port),key(station.port),'a foreign-room claim must not reserve local coordinates');
 report.checks.push('Spatial reservations are room scoped, even when foreign endpoints have the same x/y.');
}
{
 const f=fixture(),s=f.room.objects.filter(o=>o.source);
 const makeDrop=(id,source,amount)=>{const p=reviewed.sourcePlans.find(p=>p.id===source.id);const d={id,resourceType:C.RESOURCE_ENERGY,amount,pos:f.pos(p.x,p.y)};f.room.objects.push(d);return d;};
 const a=makeDrop('drop-a',s[0],3000),b=makeDrop('drop-b',s[1],3000);
 const c=f.creep('pickup-a','hauler',20,30,0),d=f.creep('pickup-b','hauler',21,30,0);
 assert(policy.walkable(f.room,c.pos)&&policy.walkable(f.room,d.pos));
 policy.collectHaul(c);policy.collectHaul(d);
 const selected=c.memory.haulPickup.id;
 const sameTargetForTwoPeers=d.memory.haulPickup.id===selected;
 const other=selected===a.id?b:a;other.amount=99999;context.Game.time++;
 c.pos=f.pos(20,29);assert(policy.walkable(f.room,c.pos));policy.collectHaul(c);assert.equal(c.memory.haulPickup.id,selected,'valid pickup remains sticky despite other source pressure');
 report.checks.push('Active pickup is sticky: global search does not mean selecting a different source every tick.');
 report.limitations.push({case:'unreserved-pickup-stock',sameTargetForTwoPeers,liveFailureConfirmed:false});
}
{
 const f=fixture(),c=f.creep('leased','hauler',25,26,0,200);f.delivery(c,95);assert(policy.walkable(f.room,c.pos));
 const drop={id:'spill',resourceType:C.RESOURCE_ENERGY,amount:200,pos:f.pos(25,25)};f.room.objects.push(drop);
 c.memory.haulPickup={id:drop.id,room:f.room.name,position:key(c.pos),progress:context.Game.time};policy.collectHaul(c);
 const policyAction=c.actions[0]?.[0]||null;
 const engineCreep={_id:'c',x:25,y:26,store:{energy:0},storeCapacity:200};
 const pile={_id:'spill',x:25,y:25,type:'energy',energy:200};
 pickup(engineCreep,{id:'spill'},{roomObjects:{spill:pile},bulk:{update(){},remove(){}}});assert.equal(engineCreep.store.energy,200);
 report.limitations.push({case:'pickup-exceeds-delivery-lease',lease:95,policyAction,enginePickup:200,
  implication:'Extra 105 energy is cargo, not another guaranteed sink. Existing policy may reassign it later.'});
}
{
 const rawNeed=10*22+10*40,currentCarry=17,currentCapacity=50*currentCarry;
 const desired=Math.ceil(rawNeed*1.2/50)+2;
 assert.equal(desired,17);assert(currentCapacity>=rawNeed*1.2);
 report.planning.push({case:'aggregate-carry',rawNeed,currentCapacity,desiredCarry:desired,
  caveat:'Cycle estimates exclude observed congestion and are not measured capacity.'});
 for(const budget of [200,400,550,800])for(const role of ['hauler','upgrader','builder']){
  const b=policy.body(role,budget,{stationary:role==='upgrader'});assert(cost(b)<=budget);
  report.planning.push({role,budget,cost:cost(b),work:b.filter(p=>p===C.WORK).length,carry:b.filter(p=>p===C.CARRY).length,move:b.filter(p=>p===C.MOVE).length});
 }
}
{
 const losses=[3031,972].map((amount,i)=>{const o={_id:'d'+i,type:'energy',energy:amount};decay(o,{roomObjects:{[o._id]:o},bulk:{update(){},remove(){}}});return amount-o.energy;});
 assert.deepEqual(losses,[4,1]);
 report.checks.push('Official drop decay: piles 3031 and 972 lose 4+1 energy/tick in isolation.');
 report.limitations.push({case:'unexplained-residual',observedResidual:5,isolatedDecay:losses.reduce((a,b)=>a+b,0),
  interpretation:'Compatible with observed one-tick loss, not a full-window attribution without consecutive pre/post inventories.'});
}
console.log(JSON.stringify(report,null,2));
assert.deepEqual(regressions,[],'Required behavior regressions: '+regressions.join(' '));
console.log('PASS: hauling hypotheses checked against current policy, pinned engine processors and real room terrain.');
