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
  calcResources:o=>Object.values(o.store||{}).reduce((n,v)=>n+v,0),
  checkTerrain:(terrain,x,y,mask)=>!!(Number(terrain[y*50+x])&mask)};
 vm.runInNewContext(fs.readFileSync(engine+'/src/processor/intents/'+relative+'.js','utf8'),
  {module:mod,console,require:id=>{if(id==='lodash')return lodash;if(id==='../../../utils')return utils;if(id==='../../../config')return {};throw Error(id);}});
 return mod.exports;
}
const transfer=engineProcessor('creeps/transfer'),pickup=engineProcessor('creeps/pickup'),decay=engineProcessor('energy/tick');
const context={...C,module:{exports:{}},console,RoomPosition:Position,Game:{},Memory:{},global:{}};
vm.createContext(context);vm.runInContext(readSource('main.js')+'\nmodule.exports.review={VERSION,range,walkable,controllerStation,deliverHaul,haulTarget,collectHaul,body,workforceDemand,deliveryNeeds,work,developmentPlan,finishDevelopment,upgrade};',context);
const policy=context.module.exports.review;
const reviewed=JSON.parse(readSource('fixtures/layout-plan-reviewed.json'));
const world=JSON.parse(readSource('fixtures/layout-world-before.json'));
const key=p=>p.x+','+p.y,cost=b=>b.reduce((n,p)=>n+C.BODYPART_COST[p],0);
function fixture(){
 context.Game={time:73931363,creeps:{},rooms:{}};
 context.Memory={frontier:{rooms:{W21N26:{plan:structuredClone(reviewed)}},intel:{}}};
 const room={name:'W21N26',energyAvailable:800,energyCapacityAvailable:800,objects:[],sites:[],
  getTerrain:()=>({get:(x,y)=>Number(world.terrain[y*50+x])}),
  lookForAt(type,x,y){return this.objects.filter(o=>o.structureType&&o.pos.x===x&&o.pos.y===y);},
  find(type,options){let result=type===C.FIND_SOURCES?this.objects.filter(o=>o.source):
   type===C.FIND_MY_CREEPS?Object.values(context.Game.creeps).filter(c=>c.room.name===this.name):type===C.FIND_STRUCTURES?this.objects.filter(o=>o.structureType):
   type===C.FIND_MY_STRUCTURES?this.objects.filter(o=>o.my&&o.structureType):
   type===C.FIND_MY_SPAWNS?this.objects.filter(o=>o.structureType===C.STRUCTURE_SPAWN):
   type===C.FIND_DROPPED_RESOURCES?this.objects.filter(o=>o.resourceType):type===C.FIND_MY_CONSTRUCTION_SITES?this.sites:[];
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
   withdraw(t,resource,amount){this.actions.push(['withdraw',t.id,amount]);return this.pos.getRangeTo(t)<=1?C.OK:C.ERR_NOT_IN_RANGE;},
   upgradeController(t){const result=!this.getActiveBodyparts(C.WORK)?C.ERR_NO_BODYPART:!this.store.energy?C.ERR_NOT_ENOUGH_RESOURCES:
    this.pos.getRangeTo(t)>3?C.ERR_NOT_IN_RANGE:t.upgradeBlocked?C.ERR_INVALID_TARGET:C.OK;
    this.actions.push(['upgrade',result,Math.min(this.getActiveBodyparts(C.WORK),this.store.energy)]);return result;},
   harvest(t){this.actions.push(['harvest',t.id]);return this.pos.getRangeTo(t)<=1?C.OK:C.ERR_NOT_IN_RANGE;},
   build(t){const result=this.pos.getRangeTo(t)<=3?C.OK:C.ERR_NOT_IN_RANGE;this.actions.push(['build',t.id,result]);return result;},
   repair(t){this.actions.push(['repair',t.id]);return this.pos.getRangeTo(t)<=3?C.OK:C.ERR_NOT_IN_RANGE;}};
  context.Game.creeps[name]=c;return c;
 }
 const box=room.objects.find(o=>o.id==='6ab59a7329a7d77d2cb18ca2');box.store.energy=27;
 function delivery(c,amount=c.store.energy){c.memory.haulDelivery={id:box.id,room:room.name,amount,priority:2,expires:context.Game.time+200,position:key(c.pos),progress:context.Game.time};}
 return {room,pos,store,creep,box,path,occupied,delivery};
}
// Roles/promises are derived from public API tick73931921 evidence. Under the
// user's new physical-capacity policy, stock1469/cap2000 keeps a tight531 gap.
// The historical online case was stock349/cap2000/policy-high880 (see report).
function loadedReservationFixture(options={}){
 const f=fixture();context.Game.time=73931921;f.box.store=f.store(options.stock??1469,options.capacity??2000);
 if(options.link){f.box.structureType=C.STRUCTURE_LINK;f.box.my=true;f.box.pos=f.pos(17,23);}
 const m=context.Memory.frontier.rooms[f.room.name];m.economyControl={at:context.Game.time,baseMode:'growth',mode:'growth',target:14,
  developmentBudget:options.rate??14,usefulTarget:14,routes:[{roundTrip:22},{roundTrip:40}]};
 const station=policy.controllerStation(f.room);
 const workerPositions=options.link?[{x:16,y:23},{x:15,y:23},{x:15,y:22},{x:16,y:22}]:station.seats;
 for(const [i,n] of [4,4,1,4].entries()){const p=workerPositions[i];f.creep('worker'+i,'upgrader',p.x,p.y,40,100,[...Array(n).fill(C.WORK),C.CARRY,C.CARRY,C.MOVE]);}
 f.creep('overflow','upgrader',16,39,0,50,[C.WORK,C.CARRY,C.MOVE]);
 for(const source of f.room.objects.filter(o=>o.source)){const p=reviewed.sourcePlans.find(p=>p.id===source.id),c=f.creep('miner'+source.id,'miner',p.x,p.y,10,50,[...Array(5).fill(C.WORK),C.CARRY,C.MOVE]);c.memory.source=source.id;}
 const incumbent=f.creep('incumbent','hauler',23,27,250,250),far=f.creep('far-loaded','hauler',16,40,100,100);
 const emptyA=f.creep('empty-a','hauler',24,26,0,100),emptyB=f.creep('empty-b','hauler',16,32,0,100);
 const near=f.creep('near-loaded','hauler',20,27,200,200),blocked=f.creep('blocked-loaded','hauler',17,40,100,100);
 for(const [c,amount,phase,port] of [[incumbent,231,'deliver',{x:17,y:24}],[far,100,'deliver',{x:16,y:24}],[emptyA,100,'pickup'],[emptyB,100,'pickup']]){
  f.delivery(c,amount);Object.assign(c.memory.haulDelivery,{phase,priority:4});if(port)c.memory.haulDelivery.port=port;
 }
 blocked.memory.haulBlocked={[f.box.id]:context.Game.time+6};
 const need=policy.deliveryNeeds(f.room).find(n=>n.node.id===f.box.id);if(!options.link)assert.equal(need.high,options.capacity??2000,'Container dispatch uses physical capacity');
 return {...f,incumbent,far,emptyA,emptyB,near,blocked,high:need.high};
}
function activeUpgradeFixture(works=[6,4,4,4],budget=15){
 const f=loadedReservationFixture({stock:1000});
 for(const [name,c] of Object.entries(context.Game.creeps))if(c.memory.role!=='miner')delete context.Game.creeps[name];
 const m=context.Memory.frontier.rooms[f.room.name];Object.assign(m.economyControl,{target:budget,developmentBudget:budget,buildEnergyTarget:0});
 const station=policy.controllerStation(f.room),workers=works.map((n,i)=>{
  const p=station.seats[i]||{x:14,y:21},c=f.creep('active-worker'+i,'upgrader',p.x,p.y,100,100,[...Array(n).fill(C.WORK),C.CARRY,C.CARRY,C.MOVE]);
  if(station.seats[i])c.memory.upgradeSeat={id:f.box.id,...p};return c;
 });
 return {...f,workers,m,step(){for(const c of workers)c.actions=[];policy.developmentPlan(f.room);for(const c of workers)policy.work(c);policy.finishDevelopment(f.room);}};
}
const report={version:policy.VERSION,checks:[],limitations:[],planning:[]},regressions=[];
const promisedEnergy=f=>Object.values(context.Game.creeps).reduce((sum,c)=>{
 const t=c.memory.haulDelivery;return sum+(t&&t.id===f.box.id&&t.expires>context.Game.time&&t.amount>0?t.amount:0);
},0);
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
{
 const f=loadedReservationFixture(),target=policy.haulTarget(f.near),initialTarget=target?.id||null;
 const initialAmount=f.near.memory.haulDelivery?.amount||0;
 // Counterfactual changes only the two empty carriers' future delivery promises.
 delete f.emptyA.memory.haulDelivery;delete f.emptyB.memory.haulDelivery;
 const withoutEmpty=policy.haulTarget(f.near),counterfactualAmount=f.near.memory.haulDelivery?.amount||0;
 assert.equal(withoutEmpty?.id,f.box.id,'the same stocked consumer and near cargo can match when empty promises are removed');
 report.limitations.push({case:'future-quantity-promises-preempt-ready-cargo',evidenceTick:73931921,fixture:'physical-capacity tight gap',boxEnergy:f.box.store.energy,high:f.high,
  priorPromises:{loaded:331,empty:200},nearCargo:200,initialTarget,initialAmount,withoutEmptyTarget:withoutEmpty?.id||null,counterfactualAmount});
 if(initialTarget!==f.box.id||initialAmount<200)regressions.push('L003: near loaded cargo must displace future empty pickup promises without exceeding the consumer high watermark.');
}
{
 const f=loadedReservationFixture();delete f.emptyA.memory.haulDelivery;delete f.emptyB.memory.haulDelivery;
 assert.equal(policy.haulTarget(f.near)?.id,f.box.id);
 const beforeTask=f.near.memory.haulDelivery,initialAccepted=policy.deliverHaul(f.near,f.box),initialMoves=f.near.actions.filter(a=>a[0]==='move');
 const cooldown=f.near.memory.haulBlocked?.[f.box.id]-context.Game.time||0;
 // Second counterfactual retains cargo, quantity promises and all positions;
 // remove only the far carriers' endpoint claims, then restore this task.
 delete f.incumbent.memory.haulDelivery.port;delete f.far.memory.haulDelivery.port;
 f.near.memory.haulDelivery=beforeTask;delete f.near.memory.haulBlocked;f.near.actions=[];
 const withoutRemotePorts=policy.deliverHaul(f.near,f.box),counterfactualMoves=f.near.actions.filter(a=>a[0]==='move');
 assert(withoutRemotePorts&&counterfactualMoves.length,'available exact endpoint paths exist when distant promises are removed');
 report.limitations.push({case:'distant-endpoint-promises-preempt-near-cargo',evidenceTick:73931921,initialAccepted,
  initialMove:initialMoves.at(-1)||null,cooldown,withoutRemotePorts,counterfactualMove:counterfactualMoves.at(-1)||null});
 if(!initialAccepted||!initialMoves.length||cooldown)regressions.push('L004: distant endpoint promises must not blacklist a reachable consumer for a nearer ready carrier.');
}
{
 const f=loadedReservationFixture();f.emptyA.store.energy=40;
 policy.haulTarget(f.near);assert.equal(f.near.memory.haulDelivery?.amount,160,'only 60+100 uncollected energy can be reclaimed');
 assert.equal(f.emptyA.memory.haulDelivery?.amount,40,'partial existing cargo keeps its exact funded amount');
 assert.equal(promisedEnergy(f),f.high-f.box.store.energy);
 report.checks.push('Reclaim protects partial physical cargo and keeps all outstanding quantity promises within the same high watermark.');
}
for(const action of ['withdraw','pickup']){
 const f=loadedReservationFixture(),source=f.room.objects.find(o=>o.id==='6ab589f9bb1b523b9796e6d4');
 if(action==='pickup')f.room.objects.push({id:'pending-drop',resourceType:C.RESOURCE_ENERGY,amount:200,pos:f.pos(25,25)});
 const id=action==='pickup'?'pending-drop':source.id;
 f.emptyA.memory.haulPickup={id,room:f.room.name,position:key(f.emptyA.pos),progress:context.Game.time};
 assert(policy.collectHaul(f.emptyA));assert.equal(f.emptyA.actions[0][0],action);assert.equal(f.emptyA.store.energy,0,'Store has not resolved the accepted intent');
 policy.haulTarget(f.near);assert.equal(f.near.memory.haulDelivery?.amount,100,'ready courier may reclaim only the other empty promise');
 assert.equal(f.emptyA.memory.haulDelivery?.amount,100,'same-tick accepted collection remains funded');
 assert(promisedEnergy(f)<=f.high-f.box.store.energy);
 // Next tick, accepted energy is visible in Store; the intent annotation must
 // not be needed to preserve cargo, or be counted for a second collection.
 context.Game.time++;f.emptyA.store.energy=100;policy.haulTarget(f.emptyA);
 assert.equal(f.emptyA.memory.haulDelivery?.amount,100);assert(promisedEnergy(f)<=f.high-f.box.store.energy);
}
report.checks.push('Accepted withdraw and pickup are protected before Store resolves, then transition to physical cargo without double reservation.');
{
 const f=loadedReservationFixture();f.emptyA.memory.haulDelivery.phase='deliver';f.emptyA.memory.haulDelivery.sent=context.Game.time;
 policy.haulTarget(f.near);assert.equal(f.near.memory.haulDelivery?.amount,100);
 assert.equal(f.emptyA.memory.haulDelivery.amount,100);assert.equal(f.emptyA.memory.haulDelivery.sent,context.Game.time);
 assert(promisedEnergy(f)<=f.high-f.box.store.energy);
 report.checks.push('Same-tick sent transfers remain firm and cannot be reclaimed as empty cargo.');
}
for(const order of [['near','emptyA','emptyB','incumbent','far'],['emptyB','emptyA','far','incumbent','near']]){
 const f=loadedReservationFixture();
 for(const name of order){policy.haulTarget(f[name]);assert(promisedEnergy(f)<=f.high-f.box.store.energy,'role order cannot overbook quantity');}
 assert.equal(f.near.memory.haulDelivery?.amount,200,'merely running empty planners first must not defeat ready cargo');
}
for(const order of [['near','second'],['second','near']]){
 const f=loadedReservationFixture();f.second=f.creep('second-ready','hauler',19,27,100,100);
 for(const name of order){policy.haulTarget(f[name]);assert(promisedEnergy(f)<=f.high-f.box.store.energy,'multiple ready claimants reclaim atomically');}
 assert.equal((f.near.memory.haulDelivery?.amount||0)+(f.second.memory.haulDelivery?.amount||0),200);
 assert.equal(f.incumbent.memory.haulDelivery.amount,231);assert.equal(f.far.memory.haulDelivery.amount,100);
}
report.checks.push('Both planner orders and both ready-courier orders preserve funded deliveries and never multiply the 200 reclaimable energy.');
{
 const f=loadedReservationFixture();f.near.store.energy=0;f.near.memory.loaded=false;
 assert.equal(policy.haulTarget(f.near),null);assert.equal(f.emptyA.memory.haulDelivery.amount,100);assert.equal(f.emptyB.memory.haulDelivery.amount,100);
 report.checks.push('An empty planner cannot steal another future pickup promise.');
}
{
 const f=fixture(),c=f.creep('waiting-near','hauler',20,27);f.delivery(c);
 f.creep('occupant-a','hauler',17,24);f.creep('occupant-b','hauler',16,24);
 assert(policy.deliverHaul(c,f.box),'temporarily occupied endpoints wait before classifying the node as failed');
 assert(c.memory.haulDelivery);assert(!c.memory.haulBlocked?.[f.box.id]);
 delete context.Game.creeps['occupant-a'];context.Game.time++;c.actions=[];
 assert(policy.deliverHaul(c,f.box));assert(c.actions.some(a=>a[0]==='move'&&a[1]===17&&a[2]===24));
 report.checks.push('Temporary endpoint contention retains the amount task and resumes when a tile clears.');
}
{
 const f=loadedReservationFixture({link:true,capacity:800,stock:349,rate:10.67});
 const high=policy.deliveryNeeds(f.room).find(n=>n.node.id===f.box.id).high,gap=Math.floor(high-f.box.store.energy);
 assert(!Number.isInteger(high),'fixture deliberately exercises a fractional consumption-derived high watermark');
 policy.haulTarget(f.near);
 const amounts=Object.values(context.Game.creeps).map(c=>c.memory.haulDelivery).filter(t=>t&&t.id===f.box.id).map(t=>t.amount);
 report.limitations.push({case:'fractional-high-watermark',high,integerGap:gap,amounts,total:promisedEnergy(f)});
 if(!amounts.every(n=>Number.isInteger(n)&&n>=1)||promisedEnergy(f)>gap)
  regressions.push('L003 integer boundary: fractional high watermarks must leave only positive integer tasks within floor(high-stock).');
 // Repeated callers must preserve this invariant; no residual fraction may be
 // recreated when soft promises shrink, disappear, or are requested again.
 for(const c of [f.emptyA,f.emptyB,f.far,f.incumbent,f.near])policy.haulTarget(c);
 const after=Object.values(context.Game.creeps).map(c=>c.memory.haulDelivery).filter(t=>t&&t.id===f.box.id).map(t=>t.amount);
 if(!after.every(n=>Number.isInteger(n)&&n>=1)||promisedEnergy(f)>gap)
  regressions.push('L003 integer boundary: repeated role planning must preserve integer quantities and the floored high watermark.');
}
for(const previousAmount of [0.14999999999997726,60.14999999999998]){
 const f=loadedReservationFixture();f.emptyA.memory.haulDelivery.amount=previousAmount;
 const legacy=f.emptyA.memory.haulDelivery;policy.haulTarget(f.emptyA);
 const current=f.emptyA.memory.haulDelivery;
 if(current===legacy||current&&(!Number.isInteger(current.amount)||current.amount<1))
  regressions.push('L003 integer boundary: a legacy fractional delivery task must be discarded or replaced by a valid integer task.');
 report.limitations.push({case:'legacy-fractional-task',before:previousAmount,after:current?.amount??null,replaced:current!==legacy});
}
for(const free of [200,40]){
 const f=fixture();f.box.store.energy=2000-free;const c=f.creep('full-unload','hauler',17,24,100,100);f.delivery(c,75);
 assert(policy.deliverHaul(c,f.box));const intent=c.actions.find(a=>a[0]==='transfer'),requested=Math.min(100,free);
 assert.equal(intent[2],requested,'Container delivery ignores the smaller scheduling lease');
 assert.equal(c.memory.haulDelivery.amount,requested);assert.equal(c.memory.haulDelivery.sent,context.Game.time);
 assert.equal(c.store.energy,100,'accepted intent must not masquerade as an already-mutated Store');
 const truck={_id:'truck',x:17,y:24,store:{energy:100},storeCapacity:100};
 const box={_id:'box',type:'container',x:16,y:23,store:{energy:2000-free},storeCapacity:2000},events=[];
 transfer(truck,{id:'box',resourceType:C.RESOURCE_ENERGY,amount:intent[2]},{roomObjects:{box},bulk:{update(){}},eventLog:events});
 assert.equal(events[0].data.amount,requested);assert.equal(truck.store.energy,100-requested);
}
report.checks.push('Container lease75/cargo100 unloads100 when space permits, or exactly40 with free40; sent records accepted intent and engine events prove actual receipt.');
{
 const observations=[];
 for(const kind of [C.STRUCTURE_SPAWN,C.STRUCTURE_EXTENSION,C.STRUCTURE_STORAGE,C.STRUCTURE_LINK,C.STRUCTURE_TOWER,'creep']){
  const f=fixture(),target=kind==='creep'?f.creep('receiving-builder','builder',16,24,0,200):f.box;
  if(kind!=='creep'){target.structureType=kind;target.my=true;target.store=f.store(0,kind===C.STRUCTURE_EXTENSION?50:200);}
  const c=f.creep('unload-'+kind,'hauler',17,24,100,100);f.delivery(c,25);c.memory.haulDelivery.id=target.id;
  assert(policy.deliverHaul(c,target));const amount=c.actions.find(a=>a[0]==='transfer')[2],expected=Math.min(100,target.store.getFreeCapacity());
  observations.push({target:kind,lease:25,requested:amount,expected});
  if(amount!==expected)regressions.push('Full unloading applies to '+kind+' too; trip reservations must not truncate physically accepted cargo.');
  assert.equal(c.memory.haulDelivery.amount,amount);assert.equal(c.memory.haulDelivery.sent,context.Game.time);
 }
 report.limitations.push({case:'all-target-full-unload',observations});
}
{
 const f=loadedReservationFixture({stock:1000});
 context.Memory.frontier.rooms[f.room.name].controllerSupply={id:f.box.id,active:false};
 const request=policy.deliveryNeeds(f.room).find(n=>n.node.id===f.box.id);assert.equal(request.high,2000);
 assert.equal(policy.haulTarget(f.near)?.id,f.box.id);assert.equal(f.near.memory.haulDelivery.amount,200);
 assert.equal(f.emptyA.memory.haulDelivery.amount,100);assert.equal(f.emptyB.memory.haulDelivery.amount,100);
 report.checks.push('Controller Container above the old880 watermark still requests physical capacity2000, overriding a stale inactive latch.');
}
{
 const f=fixture();f.box.store.energy=1850;
 const a=f.creep('simultaneous-a','hauler',17,24,100,100),b=f.creep('simultaneous-b','hauler',16,24,100,100);
 f.delivery(a,75);f.delivery(b,75);assert(policy.deliverHaul(a,f.box));
 assert.equal(a.memory.haulDelivery.amount,100,'later planners see the full accepted first intent');
 assert.equal(policy.haulTarget(b)?.id,f.box.id);assert.equal(b.memory.haulDelivery.amount,50,'dispatch subtracts the already accepted100 from remaining physical150');
 assert(policy.deliverHaul(b,f.box));
 const intentA=a.actions.find(x=>x[0]==='transfer')[2],intentB=b.actions.find(x=>x[0]==='transfer')[2];
 assert.equal(intentA,100);assert.equal(intentB,100,'each arrival requests the full cargo allowed by its unchanged physical Store snapshot');
 const box={_id:'box',type:'container',x:16,y:23,store:{energy:1850},storeCapacity:2000},events=[];
 const trucks=[{_id:'a',x:17,y:24,store:{energy:100},storeCapacity:100},{_id:'b',x:16,y:24,store:{energy:100},storeCapacity:100}];
 for(const [i,truck] of trucks.entries())transfer(truck,{id:'box',resourceType:C.RESOURCE_ENERGY,amount:[intentA,intentB][i]},
  {roomObjects:{box},bulk:{update(){}},eventLog:events});
 assert.deepEqual(events.map(e=>e.data.amount),[100,50]);assert.equal(box.store.energy,2000);assert.equal(trucks[1].store.energy,50);
 context.Game.time++;f.box.store.energy=box.store.energy;a.store.energy=trucks[0].store.energy;b.store.energy=trucks[1].store.energy;
 assert.equal(policy.haulTarget(a),null);assert.equal(policy.haulTarget(b),null);assert.equal(a.memory.haulDelivery,undefined);assert.equal(b.memory.haulDelivery,undefined);
 report.limitations.push({case:'simultaneous-container-unload',snapshotFree:150,intents:[intentA,intentB],engineReceived:[100,50],
  nextTickTasksCleared:true,interpretation:'Both API intents can be OK. Engine capacity clips the later actual transfer; pending sent amounts are conservative claims, not measured throughput.'});
}
{
 const f=activeUpgradeFixture(),observations=[];
 for(let tick=0;tick<3;tick++){
  f.step();const calls=f.workers.map(c=>c.actions.filter(a=>a[0]==='upgrade'&&a[1]===C.OK).length);
  observations.push({tick:context.Game.time,calls,requestedWork:f.workers.reduce((n,c)=>n+c.actions.filter(a=>a[0]==='upgrade'&&a[1]===C.OK).reduce((s,a)=>s+a[2],0),0)});
  if(!calls.every(n=>n===1))regressions.push('U001: every fueled in-range primary upgrader must issue exactly one upgrade per tick despite the smaller planning budget.');
  context.Game.time++;
 }
 report.limitations.push({case:'fueled-upgrader-duty-cycling',readyWork:18,planningBudget:15,observations});
}
{
 const f=activeUpgradeFixture([6]),c=f.workers[0];c.pos=f.pos(17,24);c.store.energy=3;c.memory.loaded=false;
 f.step();assert.equal(c.actions.filter(a=>a[0]==='upgrade'&&a[1]===C.OK).length,1);
 assert(c.actions.some(a=>a[0]==='withdraw'));assert(c.actions.some(a=>a[0]==='move'),'working does not prevent seat routing');
 policy.finishDevelopment(f.room);policy.work(c);policy.upgrade(c);
 assert.equal(c.actions.filter(a=>a[0]==='upgrade').length,1,'work/finish/helper repeats cannot overwrite the same-tick upgrade intent');
 report.checks.push('A partly fueled worker upgrades while withdrawing and moving to its seat; repeated work/finish calls issue no second upgrade.');
}
{
 const f=activeUpgradeFixture([4]),c=f.workers[0];f.room.objects=f.room.objects.filter(o=>o!==f.box);delete c.memory.upgradeSeat;
 c.store.energy=1;c.memory.loaded=false;f.step();assert.equal(c.actions.filter(a=>a[0]==='upgrade'&&a[1]===C.OK).length,1);
 report.checks.push('A mobile upgrader with only1 initial energy works before its refill path returns, despite loaded=false.');
}
{
 const f=activeUpgradeFixture(),c=f.creep('overflow-low-work','upgrader',17,24,1,50,[C.WORK,C.CARRY,C.MOVE]);
 c.memory.loaded=false;f.workers.push(c);f.step();
 assert.equal(c.actions.filter(a=>a[0]==='upgrade'&&a[1]===C.OK).length,1);assert(c.actions.some(a=>a[0]==='move'));
 report.checks.push('An overflow worker performs its legal upgrade while clearing the delivery port.');
}
for(const condition of ['zero-energy','out-of-range','no-work','upgrade-blocked']){
 const f=activeUpgradeFixture(condition==='no-work'?[0]:[4]),c=f.workers[0];
 if(condition==='zero-energy'){c.store.energy=0;c.memory.loaded=false;}
 if(condition==='out-of-range')c.pos=f.pos(20,27);
 if(condition==='upgrade-blocked')f.room.controller.upgradeBlocked=10;
 f.step();assert.equal(c.actions.filter(a=>a[0]==='upgrade'&&a[1]===C.OK).length,0,condition+' cannot fabricate successful upgrade work');
 if(condition==='zero-energy'){assert(c.actions.some(a=>a[0]==='withdraw'));assert.equal(c.actions.filter(a=>a[0]==='upgrade').length,0,'same-tick withdrawal is not initial energy');}
 if(condition==='out-of-range')assert(c.actions.some(a=>a[0]==='move'));
}
report.checks.push('Initial zero energy, travel outside range3, zero active WORK and controller blocking remain nonproductive; refill does not fabricate same-tick starting energy.');
{
 const f=activeUpgradeFixture();Object.assign(f.m.economyControl,{target:10,buildEnergyTarget:5,developmentBudget:15});
 f.m.developmentCredit={tick:context.Game.time-1,credit:-100,build:-100,upgrade:-100};
 const site={id:'planned-service-road',structureType:C.STRUCTURE_ROAD,pos:f.pos(16,24),progress:0,progressTotal:1000};f.room.sites.push(site);
 const b=f.creep('regular-builder','builder',17,25,100,100,[C.WORK,C.CARRY,C.CARRY,C.MOVE]);
 for(let i=0;i<3;i++){
  for(const c of [...f.workers,b])c.actions=[];policy.developmentPlan(f.room);
  for(const c of i%2?[b,...f.workers]:[...f.workers,b])policy.work(c);policy.finishDevelopment(f.room);
  assert.equal(b.actions.filter(a=>a[0]==='build'&&a[2]===C.OK).length,1,'ordinary builder executes its1WORK despite upgrade output exceeding the planning budget');
  assert.equal(f.m.development.upgradeIntentEnergy,18);assert.equal(f.m.development.buildIntentEnergy,5);
  if(f.m.developmentCredit)assert(f.m.developmentCredit.credit>=0,'work intents create no construction credit debt');
  context.Game.time++;
 }
 report.checks.push('An ordinary1WORK builder uses5 energy while upgrades request18 under plan15; obsolete negative credit is cleared and execution order does not starve construction.');
}
{
 const cases=[
  {name:'normal',reason:'sustainable-upgrade',build:true},
  {name:'fresh-full-source-container',build:true},
  {name:'fresh-source-drop',empty:true,drop:'source',build:true},
  {name:'stale-backlog',age:100,build:true},
  {name:'cleared-source-inventory',empty:true,build:true},
  {name:'unrelated-distant-drop',empty:true,drop:'controller',build:true},
  {name:'partly-fueled-builder',energy:3,loaded:false,build:true},
  {name:'zero-starting-energy',energy:0,loaded:false,build:false},
  {name:'zero-active-work',work:0,build:false},
  {name:'construction-outside-range',far:true,build:false},
  {name:'already-completed-job',completed:true,build:false},
  {name:'no-construction-job',noSite:true,build:false}
 ],observations=[];
 for(const test of cases){
  const f=activeUpgradeFixture();Object.assign(f.m.economyControl,{target:14,buildEnergyTarget:1,developmentBudget:15,
   reason:test.reason||'sustained-source-backlog',at:context.Game.time-(test.age||0)});
  const sourceBoxes=f.room.objects.filter(o=>o.structureType===C.STRUCTURE_CONTAINER&&f.room.objects.some(s=>s.source&&policy.range(s,o)<=1));
  assert(sourceBoxes.length>0);for(const box of sourceBoxes)box.store.energy=test.empty?0:2000;
  if(test.drop){const location=test.drop==='source'?f.room.objects.find(o=>o.source).pos:f.room.controller.pos;
   f.room.objects.push({id:'pressure-drop',pos:f.pos(location.x+1,location.y),resourceType:C.RESOURCE_ENERGY,amount:200});}
  if(!test.noSite)f.room.sites.push({id:'useful-planned-road',structureType:C.STRUCTURE_ROAD,pos:f.pos(16,24),progress:test.completed?1000:0,progressTotal:1000});
  const b=f.creep('useful-builder','builder',test.far?23:17,test.far?28:25,test.energy??100,100,[...Array(test.work??4).fill(C.WORK),C.CARRY,C.CARRY,C.MOVE]);
  if(test.loaded!==undefined)b.memory.loaded=test.loaded;
  policy.developmentPlan(f.room);for(const c of [...f.workers,b])policy.work(c);policy.finishDevelopment(f.room);
  const calls=b.actions.filter(a=>a[0]==='build'&&a[2]===C.OK).length;
  observations.push({case:test.name,calls,buildBudget:f.m.development.buildBudget,buildIntentEnergy:f.m.development.buildIntentEnergy,
   surplusBuild:f.m.development.surplusBuild});
  if(calls!==Number(test.build))regressions.push('Continuous useful building: '+test.name+' must produce '+Number(test.build)+' valid construction intent.');
  if(test.build&&calls)assert.equal(f.m.development.buildIntentEnergy,Math.min(20,test.energy??100),'construction uses only held energy on existing useful work');
  if(f.m.developmentCredit)assert(f.m.developmentCredit.credit>=0);assert.equal(f.m.development.upgradeIntentEnergy,18);
  policy.finishDevelopment(f.room);policy.work(b);
  assert.equal(b.actions.filter(a=>a[0]==='build'&&a[2]===C.OK).length,calls,'same-tick retries cannot overwrite a construction intent');
 }
 report.limitations.push({case:'continuous-useful-building',planningBudget:15,plannedBuildShare:1,observations,
  interpretation:'Ready builders consume held energy on useful work independently of economic backlog markers. Inventory drawdown and accepted intents are not sustainable-income or actual-spending measurements.'});
}
{
 const f=activeUpgradeFixture();Object.assign(f.m.economyControl,{target:14,buildEnergyTarget:1,developmentBudget:15});
 f.room.sites.push({id:'nearly-complete-road',structureType:C.STRUCTURE_ROAD,pos:f.pos(16,24),progress:995,progressTotal:1000});
 const builders=[f.creep('completion-a','builder',17,25,100,100,[C.WORK,C.WORK,C.CARRY,C.MOVE]),
  f.creep('completion-b','builder',16,25,100,100,[C.WORK,C.WORK,C.CARRY,C.MOVE])];
 policy.developmentPlan(f.room);for(const c of [...f.workers,...builders])policy.work(c);policy.finishDevelopment(f.room);
 const calls=builders.reduce((n,c)=>n+c.actions.filter(a=>a[0]==='build'&&a[2]===C.OK).length,0);
 if(calls!==1)regressions.push('Useful construction must allocate the final5 progress once, independently of the smaller planning budget.');
 if(calls)assert.equal(f.m.development.buildIntentEnergy,5);
 policy.finishDevelopment(f.room);for(const c of builders)policy.work(c);
 assert.equal(builders.reduce((n,c)=>n+c.actions.filter(a=>a[0]==='build'&&a[2]===C.OK).length,0),calls);
 report.checks.push('Two ready builders share the final5 progress without duplicate same-tick completion intents or overstated useful construction.');
}
{
 const build=engineProcessor('creeps/build');
 for(const [initialEnergy,progress,expected] of [[3,0,3],[100,995,5]]){
  const site={_id:'road-site',type:'constructionSite',structureType:C.STRUCTURE_ROAD,x:16,y:24,progress,progressTotal:1000},events=[];
  const object={_id:'engine-builder',type:'creep',x:17,y:25,user:'owner',store:{energy:initialEnergy},body:Array.from({length:4},()=>({type:C.WORK,hits:100})),actionLog:{}};
  const scope={roomObjects:{[site._id]:site},roomTerrain:world.terrain,bulk:{update(){},remove(){},insert(){}},stats:{inc(){}},gameTime:context.Game.time,eventLog:events};
  build(object,{id:site._id},scope);assert.equal(events[0].data.amount,expected);assert.equal(object.store.energy,initialEnergy-expected);
  if(progress){build(object,{id:site._id},scope);assert.equal(events.length,1,'completed sites cannot produce another actual build event');}
 }
 report.checks.push('Official build processor spends the available3 energy or final5 progress exactly; a completed site cannot consume again.');
}
{
 const runUpgrade=engineProcessor('creeps/upgradeController'),f=activeUpgradeFixture([6,6,6]);f.room.controller.level=8;f.step();
 assert(f.workers.every(c=>c.actions.filter(a=>a[0]==='upgrade'&&a[1]===C.OK).length===1));
 const controller={_id:'controller',type:'controller',x:16,y:21,user:'owner',level:8,progress:0,effects:[],downgradeTime:context.Game.time+100000},events=[];
 for(const [i,c] of f.workers.entries()){
  const object={_id:'u'+i,type:'creep',x:c.pos.x,y:c.pos.y,user:'owner',store:{energy:100},body:Array.from({length:6},()=>({type:C.WORK,hits:100})),actionLog:{}};
  runUpgrade(object,{id:controller._id},{roomObjects:{[controller._id]:controller},bulk:{update(){}},bulkUsers:{},stats:{inc(){}},gameTime:context.Game.time,eventLog:events});
 }
 assert.equal(events.reduce((n,e)=>n+e.data.energySpent,0),15);
 report.limitations.push({case:'rcl8-native-cap',requestedWork:18,actualEngineEnergy:15,interpretation:'All fueled workers issue an intent; unboosted RCL8 capacity is enforced by the official processor, not inferred from API OK.'});
}
console.log(JSON.stringify(report,null,2));
assert.deepEqual(regressions,[],'Required behavior regressions: '+regressions.join(' '));
console.log('PASS: hauling hypotheses checked against current policy, pinned engine processors and real room terrain.');
