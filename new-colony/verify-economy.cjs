const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {constants:C,enginePath:engine,readSource}=require('./test-support/runtime.cjs');
const ctx={...C,module:{exports:{}},console,Game:{time:1,creeps:{}},Memory:{},global:{}};
vm.createContext(ctx);vm.runInContext(readSource('main.js')+'\nmodule.exports.test={body,spawnRoom,miningSpots,refuel,mine,haul,haulTarget,work,upgradePolicy,upgradeAllowed,minerReplacement,upgraderAssignment,constructionJobs,updateEconomy,routeTravel,minerRenewal,buildAllowed,near,go,controllerStation,stationUpgrade,deliveryNeeds,workerSupply,links,linkNetwork,range,developmentPlan,recordDevelopment,finishDevelopment,workforceDemand,workerDuty};',ctx);
const {body,spawnRoom,miningSpots,refuel,mine,haul,haulTarget,work,upgradePolicy,upgradeAllowed,minerReplacement,upgraderAssignment,constructionJobs,updateEconomy,routeTravel,minerRenewal,buildAllowed,near,go,controllerStation,stationUpgrade,deliveryNeeds,workerSupply,links,linkNetwork,range,developmentPlan,recordDevelopment,finishDevelopment,workforceDemand,workerDuty}=ctx.module.exports.test;
for(const role of ['miner','hauler','upgrader','bootstrap','builder'])for(const budget of [200,300,400,550,800,1000,1300]){
 const b=body(role,budget);assert(b.length>0&&b.length<=50);assert(b.reduce((s,p)=>s+C.BODYPART_COST[p],0)<=budget,role+' exceeds budget');assert(b.includes(C.MOVE));
}
function recovery(roles,available){let requested;const roomName='W21N26';
 ctx.Game.creeps=Object.fromEntries(roles.map((role,i)=>['c'+i,{memory:{role,home:roomName},body:[C.WORK,C.CARRY,C.MOVE],ticksToLive:1000,getActiveBodyparts:()=>1}]));
 const sp={spawnCreep:(body,name,options)=>{requested={body,name,...options};return C.OK;}};
 const room={name:roomName,energyAvailable:available,energyCapacityAvailable:1300,controller:{level:4},find(type){if(type===C.FIND_MY_SPAWNS)return[sp];return[];},getTerrain:()=>({get:()=>0})};
 spawnRoom(room);return requested;
}
const bootstrap=recovery(['builder','upgrader'],200);assert.equal(bootstrap.memory.role,'bootstrap');assert.equal(bootstrap.body.reduce((s,p)=>s+C.BODYPART_COST[p],0),200);
const haulRecovery=recovery(['miner','builder','upgrader'],100);assert.equal(haulRecovery.memory.role,'hauler');assert.equal(haulRecovery.body.reduce((s,p)=>s+C.BODYPART_COST[p],0),100);
console.log('PASS: body costs, 200-energy mining recovery, 100-energy hauling recovery');
function fixture(){
 ctx.Game.time++;ctx.Game.creeps={};ctx.Memory.frontier={rooms:{},intel:{}};
 const room={name:'W21N26',energyAvailable:300,energyCapacityAvailable:300,objects:[],sites:[],walls:new Set(),visual:{text(){}},
  getTerrain(){return{get:(x,y)=>this.walls.has(x+','+y)?C.TERRAIN_MASK_WALL:0};},
  lookForAt(type,x,y){return this.objects.filter(o=>o.structureType&&o.pos.x===x&&o.pos.y===y);},
  find(type,opt){let a=type===C.FIND_SOURCES?this.objects.filter(o=>o.isSource):type===C.FIND_DROPPED_RESOURCES?this.objects.filter(o=>o.resourceType):type===C.FIND_MY_CREEPS?Object.values(ctx.Game.creeps):type===C.FIND_MY_CONSTRUCTION_SITES?this.sites:type===C.FIND_STRUCTURES?this.objects.filter(o=>o.structureType):type===C.FIND_MY_STRUCTURES?this.objects.filter(o=>o.structureType&&o.my):type===C.FIND_MY_SPAWNS?this.objects.filter(o=>o.structureType===C.STRUCTURE_SPAWN&&o.my):[];return opt&&opt.filter?a.filter(opt.filter):a;}};
 // Match the engine's accepted overloads: plain coordinate objects are not
 // RoomPosition instances and getRangeTo(plain) must return NaN.
 class Position {
  constructor(x,y,roomName=room.name){this.x=x;this.y=y;this.roomName=roomName;}
  getRangeTo(first,second){
   let x,y,roomName;
   if(typeof second==='number'){x=first;y=second;}
   else {const p=first instanceof Position?first:first&&first.pos instanceof Position?first.pos:null;if(p)({x,y,roomName}=p);}
   if(roomName&&roomName!==this.roomName)return Infinity;
   return Math.max(Math.abs(this.x-x),Math.abs(this.y-y));
  }
  findClosestByPath(a){return a.slice().sort((a,b)=>this.getRangeTo(a)-this.getRangeTo(b))[0]||null;}
  findClosestByRange(a,opt){return this.findClosestByPath(Array.isArray(a)?a:room.find(a,opt));}
  findInRange(type,r,opt){return room.find(type,opt).filter(o=>this.getRangeTo(o)<=r);}
 }
 const pos=(x,y,roomName)=>new Position(x,y,roomName);
 ctx.RoomPosition=Position;
 function store(n,capacity){return{[C.RESOURCE_ENERGY]:n,getFreeCapacity(){return capacity-this[C.RESOURCE_ENERGY];}};}
 function source(id,x,y){const s={id,isSource:true,pos:pos(x,y),energy:3000};room.objects.push(s);return s;}
 function structure(type,id,x,y,n=0,capacity=2000){const s={id,structureType:type,my:true,pos:pos(x,y),store:store(n,capacity),hits:250000,hitsMax:250000};room.objects.push(s);if(type===C.STRUCTURE_STORAGE)room.storage=s;return s;}
 function creep(name,role,x,y,n=0,capacity=50,parts=[C.WORK,C.CARRY,C.MOVE]){
  const actions=[];const c={name,room,pos:pos(x,y),memory:{role,home:room.name},store:store(n,capacity),body:parts,ticksToLive:1000,actions,getActiveBodyparts(p){return parts.filter(q=>q===p).length;},
   harvest(t){actions.push(['harvest',t.id]);return this.pos.getRangeTo(t)>1?C.ERR_NOT_IN_RANGE:C.OK;},
   moveTo(t,opt){actions.push(['move',t.x,t.y,opt.range]);return C.OK;},
   withdraw(t){actions.push(['withdraw',t.id]);return C.OK;},pickup(t){actions.push(['pickup',t.id]);return C.OK;},transfer(t){actions.push(['transfer',t.id||t.name]);return C.OK;},drop(){actions.push(['drop']);return C.OK;},
   repair(t){actions.push(['repair',t.id]);return C.OK;},build(t){actions.push(['build',t.id]);return C.OK;},upgradeController(){actions.push(['upgrade']);return C.OK;}};
  ctx.Game.creeps[name]=c;return c;
 }
 room.controller={my:true,level:2,ticksToDowngrade:10000,pos:pos(16,21)};
 ctx.Game.rooms={[room.name]:room};ctx.Game.getObjectById=id=>room.objects.find(o=>o.id===id);
 return{room,pos,store,source,structure,creep};
}
{
 const f=fixture(),a=f.pos(16,21),b=f.pos(17,23),plain={x:17,y:23},far=f.pos(17,23,'W22N26');
 assert(Number.isNaN(a.getRangeTo(plain)),'fixture rejects plain-object overloads like the official engine');
 assert.equal(a.getRangeTo(b),2);assert.equal(a.getRangeTo(17,23),2);assert.equal(a.getRangeTo(far),Infinity);
 for(const left of [a,{pos:a},{x:16,y:21}])for(const right of [b,{pos:b},plain])assert.equal(range(left,right),2,'internal range accepts structures, RoomPositions and local plan coordinates symmetrically');
 for(const [left,right] of [[a,far],[{pos:a},{pos:far}],[{x:16,y:21,roomName:'W21N26'},far],[far,a]])assert.equal(range(left,right),Infinity,'known different rooms retain Infinity semantics');
}
function singleSource(f){const s=f.source('single',24,24);for(let y=23;y<=25;y++)for(let x=23;x<=25;x++)if(!(x===24&&y===24||x===25&&y===25))f.room.walls.add(x+','+y);return s;}
{
 const f=fixture(),s=singleSource(f),other=f.source('open',16,42);
 assert.equal(miningSpots(f.room,s).length,1,'source itself is not a mining tile');
 f.creep('occupant','bootstrap',25,25);const waiting=f.creep('waiting','bootstrap',24,26);
 refuel(waiting);assert.equal(waiting.actions[0][1],other.id,'worker must leave occupied single-slot source');
 const miner=f.creep('miner','miner',24,26);miner.memory.source=s.id;miner.memory.spot={x:24,y:24};mine(miner);
 assert.deepEqual(miner.actions[0],['move',25,25,0],'invalid persisted source-center mining spot must recover');
}
{
 const f=fixture(),s=f.source('open',20,20),box=f.structure(C.STRUCTURE_CONTAINER,'box',21,21);
 const miner=f.creep('miner','miner',19,19);miner.memory.source=s.id;miner.memory.spot={x:19,y:19};mine(miner);
 assert.deepEqual(miner.actions[0],['move',21,21,0],'miner must adopt newly available source container');
}
{
 const f=fixture(),s=singleSource(f),other=f.source('open',16,42);let requested;
 const sp=f.structure(C.STRUCTURE_SPAWN,'spawn',21,28,300,300);sp.spawnCreep=(b,n,o)=>{requested=o.memory;return C.OK;};
 f.creep('bootstrap1','bootstrap',21,27);f.creep('bootstrap2','bootstrap',22,27);f.creep('up','upgrader',16,22);
 const m=f.creep('miner1','miner',25,25,0,50,[C.WORK,C.WORK,C.CARRY,C.MOVE]);m.memory.source=s.id;
 f.creep('haul','hauler',21,29,0,600,Array(12).fill(C.CARRY).concat(C.MOVE));
 spawnRoom(f.room);assert.equal(requested.source,other.id,'spawn must cover the idle second source');
 const m2=f.creep('miner2','miner',17,42,0,50,Array(5).fill(C.WORK).concat(C.CARRY,C.MOVE));m2.memory.source=other.id;
 requested=null;spawnRoom(f.room);assert.notEqual(requested&&requested.role,'miner','single source tile must not be double staffed');
}
{
 const f=fixture();f.structure(C.STRUCTURE_STORAGE,'storage',20,20,1000,1000000);
 const c=f.creep('haul','hauler',21,20,0,100,[C.CARRY,C.MOVE]);haul(c);
 assert.equal(c.actions.length,0,'idle hauler must not withdraw storage just to return it');
 const builder=f.creep('builder','builder',21,21);work(builder);assert.equal(builder.actions.length,0,'idle builder must not recycle storage energy');
 delete ctx.Game.creeps.builder;
 const sp=f.structure(C.STRUCTURE_SPAWN,'spawn',22,20,0,300);haul(c);assert.deepEqual(c.actions.pop(),['withdraw','storage']);
 c.store[C.RESOURCE_ENERGY]=100;sp.store[C.RESOURCE_ENERGY]=300;haul(c);
 assert.equal(c.actions.length,0,'hauler must not return storage withdrawal after its target fills');
}
{
 const f=fixture();f.room.controller.pos=f.pos(10,10);f.source('source',12,12);f.structure(C.STRUCTURE_CONTAINER,'source-box',11,11,400);
 f.structure(C.STRUCTURE_STORAGE,'storage',18,18,0,1000000);const c=f.creep('haul','hauler',11,10,100,100,[C.CARRY,C.MOVE]);haul(c);
 assert.deepEqual(c.actions[0],['transfer','storage'],'source container near controller must not receive its own collected energy');
}
{
 const f=fixture(),s=singleSource(f);f.creep('occupied','miner',25,25);const c=f.creep('upgrader','upgrader',23,26,20,50);work(c);
 assert.deepEqual(c.actions[0],['upgrade'],'partly filled worker should work if all mining spots are occupied');
 const st=f.structure(C.STRUCTURE_STORAGE,'storage',20,20,1000,1000000);
 delete ctx.Game.creeps.upgrader;const a=f.creep('a','upgrader',16,22,50,50,Array(4).fill(C.WORK));const b=f.creep('b','upgrader',17,22,50,50,Array(6).fill(C.WORK));
 let used=0;for(let tick=0;tick<10;tick++){ctx.Game.time=tick;for(const c of [a,b])if(upgradeAllowed(c))used+=c.getActiveBodyparts(C.WORK);}
 assert.equal(used/10,6,'existing 10 WORK cohort must average 6 WORK while rebuilding reserve');
 st.store[C.RESOURCE_ENERGY]=16000;assert.equal(upgradePolicy(f.room).target,10);
 st.store[C.RESOURCE_ENERGY]=31000;assert.equal(upgradePolicy(f.room).target,16);
 ctx.Memory.frontier.expansion={home:f.room.name,state:'stabilizing'};assert.equal(upgradePolicy(f.room).target,6);
 f.room.controller.ticksToDowngrade=100;a.memory.loaded=true;work(a);assert.deepEqual(a.actions.pop(),['upgrade'],'downgrade emergency overrides reserve budget');
}
{
 const f=fixture();ctx.Game.time=101;let spawned=0;const sp=f.structure(C.STRUCTURE_SPAWN,'spawn',21,28,300,300);sp.spawnCreep=()=>{spawned++;return C.OK;};
 ctx.require=name=>name==='planner'?{run(){throw Error('expected planning failure');}}:{tick(){},spawn(){}};
 const logs=[];ctx.console={log:t=>logs.push(t)};ctx.module.exports.loop();ctx.console=console;
 assert.equal(spawned,1);assert(logs.some(s=>s.includes('expected planning failure')),'planner error must be reported and isolated');
}
console.log('PASS: occupied-source rerouting, legal miner slots, container migration, source coverage, storage loop prevention, partial loads, live upgrade reserve budget, planner fault isolation');
{
 const f=fixture(),s=singleSource(f),other=f.source('open',16,42);f.room.energyAvailable=f.room.energyCapacityAvailable=550;
 const sp=f.structure(C.STRUCTURE_SPAWN,'spawn',21,28,300,300);let spawned;
 sp.spawnCreep=(body,name,options)=>{spawned={body,name,memory:options.memory};return C.OK;};
 const old=f.creep('old','miner',25,25,20,50,[C.WORK,C.WORK,C.CARRY,C.MOVE]);old.memory.source=s.id;old.memory.spot={x:25,y:25};
 const second=f.creep('second','miner',17,42,0,50,Array(5).fill(C.WORK).concat(C.CARRY,C.MOVE));second.memory.source=other.id;
 f.creep('hauler','hauler',22,28,0,600,Array(12).fill(C.CARRY).concat(C.MOVE));f.creep('upgrader','upgrader',16,22);
 const all=()=>Object.values(ctx.Game.creeps);
 assert.equal(minerReplacement(f.room,all(),sp).replaces,'old');
 old.ticksToLive=150;assert.equal(minerReplacement(f.room,all(),sp),null,'do not pay for an upgrade that cannot repay before natural replacement');old.ticksToLive=1000;
 f.room.energyAvailable=300;assert.equal(minerReplacement(f.room,all(),sp),null,'replacement must be fully affordable');f.room.energyAvailable=550;
 spawnRoom(f.room);assert.equal(spawned.memory.replaces,'old');assert.equal(spawned.body.filter(p=>p===C.WORK).length,4);
 const next=f.creep(spawned.name,'miner',21,29,0,50,spawned.body);Object.assign(next.memory,spawned.memory);next.spawning=true;
 assert.equal(minerReplacement(f.room,all(),sp),null,'never spawn duplicate replacements');next.spawning=false;
 mine(next);assert.equal(old.memory.role,'miner','old miner must remain active during replacement travel');
 mine(old);assert(old.actions.some(a=>a[0]==='harvest'),'old miner continues harvesting until handover');
 next.pos=f.pos(25,26);next.fatigue=1;mine(next);assert.equal(old.memory.role,'miner','wait for the replacement to regain movement');next.fatigue=0;
 mine(next);assert.equal(old.memory.role,'builder');assert.equal(old.memory.yieldSource,s.id);assert.equal(next.memory.replaces,undefined);
 const before=old.actions.length;work(old);assert.equal(old.actions[before][0],'move','retired miner must leave the only source tile before doing other work');
 assert.equal(next.memory.spot.x,25);assert.equal(next.memory.spot.y,25);
 old.pos=f.pos(24,26);work(old);assert.equal(old.memory.yieldSource,undefined,'release handover state once the tile is clear');
}
{
 const f=fixture(),s=singleSource(f);const next=f.creep('replacement','miner',25,26);next.memory.source=s.id;next.memory.replaces='dead-miner';mine(next);
 assert.equal(next.memory.replaces,undefined);assert.equal(next.memory.spot.x,25,'replacement must recover if the old miner dies en route');
}
console.log('PASS: single-slot miner upgrade economics, affordability, duplicate suppression, uninterrupted travel phase, fatigue-aware handover, forced tile release, predecessor death');
{
 const f=fixture();singleSource(f);const far=f.source('far',16,42);
 for(let y=41;y<=43;y++)for(let x=15;x<=17;x++)if(!(x===16&&y===42||x===17&&y===41))f.room.walls.add(x+','+y);
 const miner=f.creep('miner','miner',25,25);miner.memory.spot={x:25,y:25};
 const c=f.creep('traveller','bootstrap',21,30);refuel(c);assert.equal(c.memory.refuelTarget.id,far.id);
 const waiting=f.creep('waiting','bootstrap',22,30);assert.equal(refuel(waiting),false,'a second worker must not join a reserved one-tile source');
 const drop={id:'new-small-drop',resourceType:C.RESOURCE_ENERGY,amount:24,pos:f.pos(25,25)};f.room.objects.push(drop);
 ctx.Game.time++;c.pos=f.pos(20,31);c.actions.length=0;refuel(c);
 assert.equal(c.memory.refuelTarget.id,far.id,'new nearby drops must not interrupt travel to the selected source');
 assert.deepEqual(c.actions.at(-1),['move',17,41,0]);
 const up=f.creep('partial-upgrader','upgrader',19,32,30,50);up.memory.loaded=false;up.memory.refuelTarget={...c.memory.refuelTarget};work(up);
 assert.deepEqual(up.actions[0],['upgrade'],'a 30/50 upgrader must work instead of travelling for its final 20 energy');assert.equal(up.memory.refuelTarget,undefined);
 far.energy=0;c.actions.length=0;refuel(c);assert.equal(c.memory.refuelTarget.id,drop.id,'depleted persistent source must release and choose usable energy');
}
{
 const f=fixture(),s=singleSource(f);const c=f.creep('traveller','bootstrap',23,27);refuel(c);assert.equal(c.memory.refuelTarget.id,s.id);
 f.creep('arrived-first','miner',25,25);c.actions.length=0;assert.equal(refuel(c),false);assert.equal(c.memory.refuelTarget,undefined,'occupied source destination must be released immediately');
}
{
 const f=fixture(),box=f.structure(C.STRUCTURE_CONTAINER,'chosen-box',20,20,100);const c=f.creep('worker','builder',12,12);
 c.withdraw=function(t){this.actions.push(['withdraw',t.id]);return this.pos.getRangeTo(t)>1?C.ERR_NOT_IN_RANGE:C.OK;};refuel(c);
 f.room.objects.push({id:'closer-drop',resourceType:C.RESOURCE_ENERGY,amount:25,pos:f.pos(13,13)});ctx.Game.time++;refuel(c);
 assert.equal(c.memory.refuelTarget.id,box.id,'a valid selected collection target must remain stable across ticks');
 box.store[C.RESOURCE_ENERGY]=0;refuel(c);assert.equal(c.memory.refuelTarget.id,'closer-drop');
}
{
 const f=fixture(),blocked=f.source('blocked',15,15),reachable=f.source('reachable',30,30),c=f.creep('worker','bootstrap',12,12);
 const move=c.moveTo;c.moveTo=()=>C.ERR_NO_PATH;assert.equal(refuel(c),false);assert.equal(c.memory.refuelTarget,undefined);assert.equal(c.memory.refuelAvoid.id,blocked.id);
 c.moveTo=move;ctx.Game.time++;assert.equal(refuel(c),true);assert.equal(c.memory.refuelTarget.id,reachable.id,'no-path target must not be immediately selected again');
}
{
 const f=fixture();f.source('source',15,15);const c=f.creep('worker','bootstrap',12,12);refuel(c);ctx.Game.time+=16;
 assert.equal(refuel(c),false);assert.equal(c.memory.refuelTarget,undefined,'a target with prolonged zero progress must be released');
}
console.log('PASS: stable multi-tick refuel targets, single-tile reservations, 30/50 upgrader starts work, depleted/occupied/no-path/stalled target recovery');
for(const role of ['bootstrap','builder','upgrader'])for(const carried of [0,30]){
 const f=fixture(),s=singleSource(f);f.structure(C.STRUCTURE_SPAWN,'spawn',21,28,300,300);
 const blocker=f.creep('blocker',role,25,25,carried);blocker.memory.refuelTarget={id:'reserved-far-source',kind:'harvest',x:17,y:41,room:f.room.name,progress:ctx.Game.time};
 const miner=f.creep('arriving','miner',21,28);miner.memory.source=s.id;
 mine(miner);assert.equal(blocker.memory.yieldSource,undefined,'distant miner must not evict a working occupant');assert(blocker.memory.refuelTarget);
 miner.pos=f.pos(24,26);miner.fatigue=1;mine(miner);assert.equal(blocker.memory.yieldSource,undefined,'fatigued miner must wait before requesting the tile');miner.fatigue=0;
 mine(miner);assert.equal(blocker.memory.yieldSource,s.id);assert.equal(blocker.memory.refuelTarget,undefined,'yielding worker must release its former resource reservation');
 work(blocker);assert.deepEqual(blocker.actions[0],['move',21,28,1],role+' with '+carried+' energy must yield before attempting refuel or work');
 blocker.pos=f.pos(24,26);miner.pos=f.pos(25,25);miner.actions.length=0;mine(miner);assert.deepEqual(miner.actions[0],['harvest',s.id],'miner must harvest after the occupant leaves');
 work(blocker);assert.equal(blocker.memory.yieldSource,undefined,'yield request must clear outside mining range');
}
{
 const f=fixture(),s=singleSource(f),miner=f.creep('arriving','miner',24,26);miner.memory.source=s.id;
 const other=f.creep('other-miner','miner',25,25);other.memory.source='another-source';mine(miner);
 assert.equal(other.memory.yieldSource,undefined,'never evict another miner through worker-yield logic');
 delete ctx.Game.creeps['other-miner'];const distant=f.creep('another-room','bootstrap',25,25);distant.room={name:'W22N26'};mine(miner);
 assert.equal(distant.memory.yieldSource,undefined,'identical coordinates in another room must not receive a yield request');
}
console.log('PASS: adjacent miner requests worker yield, empty and partial-load blockers leave, resource reservations release, harvesting resumes, distant/fatigued miners and other miners/rooms protected');
{
 const f=fixture(),nearSource=singleSource(f),farSource=f.source('far',16,42);
 for(let y=41;y<=43;y++)for(let x=15;x<=17;x++)if(!(x===16&&y===42||x===17&&y===41))f.room.walls.add(x+','+y);
 const nearParts=[C.WORK,C.WORK,C.CARRY,C.MOVE],farParts=nearParts.slice();
 const nearMiner=f.creep('near-miner','miner',25,25,0,50,nearParts);nearMiner.memory.source=nearSource.id;
 const farMiner=f.creep('far-miner','miner',17,41,0,50,farParts);farMiner.memory.source=farSource.id;
 f.creep('bootstrap1','bootstrap',21,28);f.creep('bootstrap2','bootstrap',22,28);f.creep('builder','builder',20,28);f.creep('scout','scout',21,27,0,0,[C.MOVE]);
 for(let i=0;i<2;i++)f.creep('hauler'+i,'hauler',22,29,0,150,[C.CARRY,C.CARRY,C.CARRY,C.MOVE,C.MOVE,C.MOVE]);
 const ups=Array.from({length:6},(_,i)=>f.creep('up'+i,'upgrader',17+i,23,50));
 const sp=f.structure(C.STRUCTURE_SPAWN,'spawn',21,28,300,300);let requested;sp.spawnCreep=(b,n,o)=>{requested=o.memory;return C.OK;};
 f.room.sites=[{id:'started-extension',structureType:C.STRUCTURE_EXTENSION,pos:f.pos(17,28),progress:61},{id:'closer-empty-extension',structureType:C.STRUCTURE_EXTENSION,pos:f.pos(22,24),progress:0},{id:'source-container',structureType:C.STRUCTURE_CONTAINER,pos:f.pos(25,25),progress:100}];
 assert.equal(upgradePolicy(f.room).target,2);assert.equal(upgradePolicy(f.room).mode,'infrastructure');
 spawnRoom(f.room);assert.equal(requested.role,'hauler','a long source route may require more than six CARRY even during infrastructure work');
 delete ctx.Memory.frontier.rooms[f.room.name].economyControl; // The following assertions isolate legacy job ordering from the tested rate budget.
 assert.deepEqual(Array.from(upgraderAssignment(f.room).primary,c=>c.name),['up0','up1']);
 for(const c of ups.slice(2))c.pos=f.pos(22,25);
 for(const c of ups)work(c);
 assert.deepEqual(ups[0].actions[0],['upgrade']);assert.deepEqual(ups[1].actions[0],['upgrade']);
 for(const c of ups.slice(2))assert.deepEqual(c.actions[0],['build','source-container'],'source containers take priority over road and extension work');
 f.room.sites=f.room.sites.filter(s=>s.structureType!==C.STRUCTURE_CONTAINER);
 for(const c of ups.slice(2))c.pos=f.pos(20,27);
 for(const c of ups.slice(2)){c.actions.length=0;work(c);assert.deepEqual(c.actions[0],['build','started-extension'],'same-type work must finish the started extension first');}
 ups[0].pos=f.pos(40,40);ups[5].pos=f.pos(16,22);ctx.Game.time++;
 assert.deepEqual(Array.from(upgraderAssignment(f.room).primary,c=>c.name),['up0','up1'],'movement must not reshuffle controller versus construction duties');
 f.room.sites=[];sp.store[C.RESOURCE_ENERGY]=0;ups[2].actions.length=0;work(ups[2]);assert.deepEqual(ups[2].actions[0],['transfer','spawn'],'support workers must fund miner replacement after core sites finish');
 sp.store[C.RESOURCE_ENERGY]=300;ups[2].actions.length=0;work(ups[2]);assert.deepEqual(ups[2].actions[0],['upgrade'],'without a construction or refill job, support workers may upgrade while miners travel');
 f.room.energyCapacityAvailable=550;
 nearParts.splice(0,nearParts.length,...Array(6).fill(C.WORK),C.CARRY,C.MOVE);
 assert.equal(upgradePolicy(f.room).mode,'infrastructure','eight total mining WORK must not hide an under-equipped second source');
 nearParts.splice(0,nearParts.length,...Array(4).fill(C.WORK),C.CARRY,C.MOVE);farParts.splice(0,farParts.length,...Array(4).fill(C.WORK),C.CARRY,C.MOVE);
 farMiner.spawning=true;assert.equal(upgradePolicy(f.room).mode,'infrastructure');farMiner.spawning=false;
 farMiner.pos=f.pos(20,38);assert.equal(upgradePolicy(f.room).mode,'infrastructure','replacement must reach the source before the phase ends');farMiner.pos=f.pos(17,41);
 assert.equal(upgradePolicy(f.room).mode,'growth');assert.equal(upgradePolicy(f.room).target,10);
 ups[2].actions.length=0;work(ups[2]);assert.deepEqual(ups[2].actions[0],['upgrade']);assert.equal(ups[2].memory.role,'upgrader','temporary builders must retain and resume their original role');
 f.room.controller.level=3;assert.equal(upgradePolicy(f.room).mode,'infrastructure');f.room.energyCapacityAvailable=800;
 nearParts.unshift(C.WORK);farParts.unshift(C.WORK);assert.equal(upgradePolicy(f.room).mode,'growth');
 f.room.controller.level=1;assert.equal(upgradePolicy(f.room).target,2);assert.equal(upgradePolicy(f.room).mode,'bootstrap');
}
console.log('PASS: early capacity/mining stage gates, per-source production checks, no excess small-unit spawning, stable 2 WORK controller duty, temporary construction helpers, focused extension completion, miner-funding fallback, automatic role recovery');
{
 const f=fixture();f.room.sites=[{id:'extension',structureType:C.STRUCTURE_EXTENSION,pos:f.pos(22,28),progress:1803}];
 const haul=f.creep('hauler','hauler',16,25,100,100,[C.CARRY,C.MOVE]);
 const builder=f.creep('builder','builder',23,27,0,100,[C.WORK,C.WORK,C.CARRY,C.CARRY,C.MOVE]);
 const up=f.creep('upgrader','upgrader',15,24,10,100,[C.WORK,C.WORK,C.CARRY,C.CARRY,C.MOVE]);
 assert.equal(haulTarget(haul),null,'workers are never moving delivery endpoints, including an empty builder without a station');
 const src=f.source('source',25,25),box=f.structure(C.STRUCTURE_CONTAINER,'source-box',24,25,500);
 work(builder);assert.equal(builder.memory.workSupply.id,box.id,'builder binds an existing supply building to the current job');
 assert.deepEqual(builder.actions[0],['withdraw',box.id]);
 const closer=f.structure(C.STRUCTURE_CONTAINER,'new-closer-box',23,28,500);ctx.Game.time++;builder.actions.length=0;work(builder);
 assert.equal(builder.memory.workSupply.id,box.id,'worker retains its supply binding during a batch');
 f.room.sites=[{id:'new-job',structureType:C.STRUCTURE_EXTENSION,pos:f.pos(23,29),progress:0}];ctx.Game.time++;work(builder);
 assert.equal(builder.memory.workSupply.id,closer.id,'changing jobs reevaluates the nearest supply node');
 box.store[C.RESOURCE_ENERGY]=0;closer.store[C.RESOURCE_ENERGY]=0;ctx.Game.time++;work(builder);
 assert.equal(builder.memory.refuelTarget.kind,'harvest','empty infrastructure can fall back to legal self-harvest');
}
{
 const f=fixture(),box=f.structure(C.STRUCTURE_CONTAINER,'controller-box',16,23,500),source=f.source('open',24,25);
 f.room.sites=[{id:'extension',structureType:C.STRUCTURE_EXTENSION,pos:f.pos(22,28),progress:0}];
 const builder=f.creep('builder','builder',16,24,0,100),primary=f.creep('up0','upgrader',16,22,20,100,[C.WORK,C.WORK,C.CARRY,C.MOVE]);
 const support=f.creep('up1','upgrader',20,27,0,100);
 for(const worker of [builder,support]){work(worker);assert(worker.actions.some(a=>a[0]==='harvest'),'construction workers retain bootstrap recovery');assert(!worker.actions.some(a=>a[0]==='withdraw'&&a[1]===box.id),'construction does not consume the dedicated controller reserve');}
}
{
 const f=fixture();f.structure(C.STRUCTURE_STORAGE,'storage',17,24,1000,1000000);
 const c=f.creep('hauler','hauler',16,25,0,200,[C.CARRY,C.MOVE]);
 const up=f.creep('upgrader','upgrader',15,24,98,100,[C.WORK,C.WORK,C.CARRY,C.CARRY,C.MOVE]);
 haul(c);assert.equal(c.actions.length,0,'no fixed demand must not cause a storage withdrawal');
 c.store[C.RESOURCE_ENERGY]=89;c.memory.loaded=true;c.memory.withdrawnFrom='storage';haul(c);
 assert.equal(c.actions.length,0,'an existing storage withdrawal may wait without returning energy in a loop');
}
console.log('PASS: no worker delivery endpoints, fixed job supply bindings, job-change/depletion recovery, construction self-harvest and controller reserve protection, no-demand storage safety');
{
 const f=fixture();f.source('near',24,24);f.source('far',16,42);
 const near=f.structure(C.STRUCTURE_CONTAINER,'near-box',25,25,243),far=f.structure(C.STRUCTURE_CONTAINER,'far-box',17,41,2000);
 const drop={id:'far-drop',resourceType:C.RESOURCE_ENERGY,amount:1382,pos:f.pos(17,41)};f.room.objects.push(drop);
 const c=f.creep('hauler','hauler',21,28,0,250,[...Array(5).fill(C.CARRY),...Array(5).fill(C.MOVE)]);
 c.withdraw=c.pickup=function(t){this.actions.push(['collect',t.id]);return this.pos.getRangeTo(t)>1?C.ERR_NOT_IN_RANGE:C.OK;};
 haul(c);assert(['far-box','far-drop'].includes(c.memory.haulPickup.id),'full remote container and overflow must outrank modest nearby stock');
 const selected=c.memory.haulPickup.id;near.store[C.RESOURCE_ENERGY]=2000;ctx.Game.time++;c.pos=f.pos(20,29);haul(c);
 assert.equal(c.memory.haulPickup.id,selected,'new nearby stock must not reverse an established remote pickup trip');
 drop.amount=0;far.store[C.RESOURCE_ENERGY]=0;ctx.Game.time++;haul(c);assert.equal(c.memory.haulPickup.id,'near-box','depleted source must release its committed pickup');
 const worker=f.structure(C.STRUCTURE_SPAWN,'spawn',20,30,0,300);
 c.store[C.RESOURCE_ENERGY]=247;c.memory.loaded=false;c.actions.length=0;haul(c);
 assert.equal(c.memory.loaded,true);assert.equal(c.memory.haulPickup,undefined);assert.deepEqual(c.actions[0],['transfer',worker.id],'247/250 carrier must deliver instead of chasing three energy');
}
{
 const f=fixture();f.source('near',24,24);f.source('far',16,42);f.structure(C.STRUCTURE_CONTAINER,'near-box',25,25,150);f.structure(C.STRUCTURE_CONTAINER,'far-box',17,41,2000);
 const c=f.creep('hauler','hauler',21,28,0,250,[C.CARRY,C.MOVE]);c.withdraw=()=>C.ERR_NOT_IN_RANGE;const move=c.moveTo;c.moveTo=()=>C.ERR_NO_PATH;
 haul(c);assert.equal(c.memory.haulPickup,undefined);assert.equal(c.memory.haulPickupAvoid.id,'far-box');
 c.moveTo=move;ctx.Game.time++;haul(c);assert.equal(c.memory.haulPickup.id,'near-box','unreachable pickup needs a bounded retry cooldown');
 ctx.Game.time+=15;haul(c);assert.equal(c.memory.haulPickup.id,'far-box','a motionless pickup must eventually release and reconsider alternatives');
}
function deliveryFixture(){
 const f=fixture();f.room.controller.pos=f.pos(16,21);const box=f.structure(C.STRUCTURE_CONTAINER,'controller-box',16,23,0);
 f.room.sites=[{id:'extension',structureType:C.STRUCTURE_EXTENSION,pos:f.pos(23,27),progress:0}];
 const builder=f.structure(C.STRUCTURE_CONTAINER,'work-box',23,27,0);
 const worker=f.creep('builder','builder',23,28,0,100);worker.memory.workSupply={id:builder.id,job:'extension',room:f.room.name};
 const c=f.creep('hauler','hauler',16,26,200,250,[C.CARRY,C.MOVE]);c.memory.loaded=true;
 c.transfer=function(t){this.actions.push(['transfer',t.id||t.name]);return this.pos.getRangeTo(t)>1?C.ERR_NOT_IN_RANGE:C.OK;};
 return{...f,box,builder,c};
}
{
 const f=deliveryFixture();const start=ctx.Game.time;
 for(let i=0;i<4;i++){ctx.Game.time=start+i;haul(f.c);assert.equal(f.c.memory.haulDelivery.id,f.box.id);}
 assert.equal(f.c.memory.moveAttempt,ctx.Game.time,'movement telemetry must identify a current move attempt');
 ctx.Game.time=start+4;f.c.actions.length=0;haul(f.c);
 assert.equal(f.c.memory.haulBlocked[f.box.id],ctx.Game.time+15);assert.equal(f.c.memory.haulDelivery.id,f.builder.id);
 assert.deepEqual(f.c.actions.at(-1),['move',23,27,1],'blocked controller access must fall through to another live delivery request');
 ctx.Game.time+=15;assert.equal(haulTarget(f.c),f.box);assert.equal(f.c.memory.haulBlocked[f.box.id],undefined,'delivery exclusion must expire after 15 ticks');
 const previousMove=f.c.memory.moveAttempt;
 f.c.pos=f.pos(16,24);for(let i=0;i<6;i++){ctx.Game.time++;haul(f.c);assert.equal(f.c.memory.haulDelivery.id,f.box.id);assert.equal(f.c.memory.haulBlocked[f.box.id],undefined,'successful transfer must never create a permanent blacklist');assert(f.c.actions.some(a=>a[0]==='transfer'),'successful delivery may clear the station approach while retaining access');}
}
{
 const f=deliveryFixture();haul(f.c);f.c.fatigue=20;
 for(let i=0;i<6;i++){ctx.Game.time++;haul(f.c);assert(!f.c.memory.haulBlocked||!f.c.memory.haulBlocked[f.box.id],'fatigue is not a blocked access failure');}
 f.c.fatigue=0;ctx.Game.time++;haul(f.c);assert.equal(f.c.memory.haulDelivery.id,f.box.id,'movement recovery gets a fresh non-fatigue progress window');
}
{
 const f=deliveryFixture(),move=f.c.moveTo;
 f.c.moveTo=function(p,opts){const result=move.call(this,p,opts);return p.x===controllerStation(f.room).port.x&&p.y===controllerStation(f.room).port.y?C.ERR_NO_PATH:result;};
 haul(f.c);assert.equal(f.c.memory.haulBlocked[f.box.id],ctx.Game.time+15);assert.equal(f.c.memory.haulDelivery.id,f.builder.id,'explicit no-path error must fall back immediately');
}
{
 const f=fixture();const site=(id,type,x,progress=0)=>({id,structureType:type,pos:f.pos(x,28),progress});
 f.room.sites=[site('access-road',C.STRUCTURE_ROAD,18,299),site('extension',C.STRUCTURE_EXTENSION,19,1000),site('plain-road',C.STRUCTURE_ROAD,20,200),site('swamp-road',C.STRUCTURE_ROAD,22),site('container',C.STRUCTURE_CONTAINER,23),site('tower',C.STRUCTURE_TOWER,24)];
 ctx.Memory.frontier.rooms[f.room.name]={plan:{structures:[{type:C.STRUCTURE_ROAD,x:18,y:28,roadClass:'access'},{type:C.STRUCTURE_ROAD,x:20,y:28,roadClass:'economy',roadSwamp:false,roadOrder:1},{type:C.STRUCTURE_ROAD,x:22,y:28,roadClass:'economy',roadSwamp:true,roadOrder:5}]}};
 const builder=f.creep('builder','builder',21,28,100,100,[C.WORK,C.WORK,C.CARRY,C.CARRY,C.MOVE]);
 for(const id of ['tower','container','swamp-road','plain-road','extension','access-road']){builder.actions.length=0;work(builder);assert.deepEqual(builder.actions[0],['build',id]);f.room.sites=f.room.sites.filter(s=>s.id!==id);}
 f.room.sites=[site('plain-road',C.STRUCTURE_ROAD,20),site('extension',C.STRUCTURE_EXTENSION,19,1000)];
 f.creep('up0','upgrader',16,22,100,100,[C.WORK,C.WORK,C.CARRY,C.CARRY,C.MOVE]);const helper=f.creep('up1','upgrader',21,27,100,100,[C.WORK,C.WORK,C.CARRY,C.CARRY,C.MOVE]);work(helper);
 assert.deepEqual(helper.actions[0],['build','plain-road'],'infrastructure support upgraders must recognize economic roads');
}
{
 const f=fixture(),a=singleSource(f),b=f.source('far',16,42);f.room.energyAvailable=f.room.energyCapacityAvailable=550;
 for(const [id,s,x,y] of [['m1',a,25,25],['m2',b,17,41]]){const c=f.creep(id,'miner',x,y,0,50,[...Array(5).fill(C.WORK),C.CARRY,C.MOVE]);c.memory.source=s.id;}
 f.creep('hauler','hauler',21,29,0,1500,[...Array(30).fill(C.CARRY),C.MOVE]);f.creep('upgrader','upgrader',16,23);f.creep('scout','scout',20,28,0,0,[C.MOVE]);
 f.room.sites=[{id:'road',structureType:C.STRUCTURE_ROAD,pos:f.pos(21,29),progress:0}];
 const sp=f.structure(C.STRUCTURE_SPAWN,'spawn',21,28,300,300);let requested;sp.spawnCreep=(b,n,o)=>{requested=o.memory;return C.OK;};spawnRoom(f.room);
 assert.equal(requested.role,'builder','economic road sites must replenish the missing builder before discretionary upgrades');
}
console.log('PASS: source-pressure pickup, stable collection targets, near-full dispatch, pickup failure recovery, target-specific delivery fallback/expiry/fatigue safety, economic swamp road priorities, support builders and builder replacement');
function pipelineFixture(){
 const f=fixture();ctx.Game.time=1000;f.room.controller.level=3;f.room.energyAvailable=f.room.energyCapacityAvailable=600;
 const a=singleSource(f),b=f.source('far',16,42);
 for(let y=41;y<=43;y++)for(let x=15;x<=17;x++)if(!(x===16&&y===42||x===17&&y===41))f.room.walls.add(x+','+y);
 const sp=f.structure(C.STRUCTURE_SPAWN,'spawn',21,28,300,300);sp.spawnCreep=(body,name,options)=>{f.request={body,name,memory:options.memory};return C.OK;};
 for(const [id,s,x,y] of [['m1',a,25,25],['m2',b,17,41]]){const c=f.creep(id,'miner',x,y,0,50,[...Array(4).fill(C.WORK),C.CARRY,C.MOVE,C.MOVE]);c.memory.source=s.id;}
 f.structure(C.STRUCTURE_CONTAINER,'near-box',25,25,1010);f.structure(C.STRUCTURE_CONTAINER,'far-box',17,41,2000);
 f.creep('hauler','hauler',21,29,0,300,[...Array(6).fill(C.CARRY),...Array(6).fill(C.MOVE)]);
 f.creep('upgrader','upgrader',16,23,100,100,[C.WORK,C.WORK,C.CARRY,C.CARRY,C.MOVE,C.MOVE]);
 f.creep('builder','builder',21,28,100,150,[C.WORK,C.WORK,C.WORK,C.CARRY,C.CARRY,C.CARRY,C.MOVE,C.MOVE,C.MOVE]);
 const routes=[['source:'+a.id,5,5,a.id],['source:'+b.id,14,7,b.id],['controller',4,9]];
 ctx.Memory.frontier.rooms[f.room.name]={plan:{roadRoutes:routes.map(([id,n,y,sourceId])=>({id,sourceId,complete:true,tiles:Array.from({length:n},(_,i)=>{const x=30+i;f.structure(C.STRUCTURE_ROAD,'road-'+x+'-'+y,x,y,0,0);return x+50*y;})}))}};
 f.room.sites=[{id:'extension',structureType:C.STRUCTURE_EXTENSION,pos:f.pos(22,28),progress:100,progressTotal:3000}];
 f.backlog=(since=ctx.Game.time-160)=>{ctx.Memory.frontier.telemetry={rooms:{[f.room.name]:{tick:ctx.Game.time,mining:[{id:b.id,backlogSince:since}]}}};};
 f.ledger=metrics=>{ctx.Memory.frontier.energy={rooms:{[f.room.name]:{tick:ctx.Game.time,indicator:{status:'pending'},windows:{'300':{tick:ctx.Game.time,eligible:true,warmingUp:false,coverage:1,observedTicks:300,harvestRate:16,inventoryDelta:0,...metrics}}}}};};
 return Object.assign(f,{a,b,sp});
}
{
 const f=pipelineFixture();f.backlog();const demand=updateEconomy(f.room);
 assert.equal(demand.carry,14,'current 5/14-tile source routes and 4-tile controller route need 12 CARRY plus two for sustained overflow');
 assert.equal(demand.harvestPotential,16);assert.equal(demand.target,2);assert.equal(demand.builderWork,3);
 assert.equal(demand.reason,'sustained-source-backlog');spawnRoom(f.room);
 assert.equal(f.request.memory.role,'hauler','the live one-hauler bottleneck must be repaired before spawning more consumers');
 assert.equal(f.request.body.filter(p=>p===C.CARRY).length,6);
 assert.equal(ctx.Memory.frontier.rooms[f.room.name].economy.carryTarget,14);
 const next=f.creep('second-hauler','hauler',21,28,0,300,f.request.body);next.spawning=true;
 spawnRoom(f.room);assert.equal(f.request.body.filter(p=>p===C.CARRY).length,2,'fill only the remaining carry gap without paying for a third full-size carrier');
 ctx.Game.time+=20;f.backlog(null);assert.equal(updateEconomy(f.room).carry,14,'20-tick fluctuations cannot resize transport');
 ctx.Game.time=1100;f.backlog(null);assert.equal(updateEconomy(f.room).carry,14);
 ctx.Game.time=1300;f.backlog(null);assert.equal(updateEconomy(f.room).carry,14,'wait a full 300-tick lower-demand window');
 ctx.Game.time=1400;f.backlog(null);assert.equal(updateEconomy(f.room).carry,12,'a sustained drop in route demand can reduce future replacements');
 assert(ctx.Game.creeps.hauler&&ctx.Game.creeps['second-hauler'],'target reductions never kill existing haulers');
}
{
 const f=pipelineFixture();f.backlog(ctx.Game.time-20);assert.equal(updateEconomy(f.room).carry,12,'one short backlog observation must not add transport');
 delete ctx.Memory.frontier.rooms[f.room.name].economyControl;
 ctx.Memory.frontier.telemetry.rooms[f.room.name].tick=ctx.Game.time-101;ctx.Memory.frontier.telemetry.rooms[f.room.name].mining[0].backlogSince=1;
 assert.equal(updateEconomy(f.room).carry,12,'stale backlog telemetry must not trigger a correction');
 const plan=ctx.Memory.frontier.rooms[f.room.name].plan,k=plan.roadRoutes[1].tiles[0];
 f.room.objects=f.room.objects.filter(s=>!(s.structureType===C.STRUCTURE_ROAD&&s.pos.x+50*s.pos.y===k));
 const original=f.room.getTerrain;f.room.getTerrain=()=>({get:(x,y)=>x+50*y===k?C.TERRAIN_MASK_SWAMP:original.call(f.room).get(x,y)});
 assert.equal(routeTravel(f.room,f.b),18,'an unpaved swamp needs four extra loaded travel ticks');
}
{
 const f=pipelineFixture();const old=ctx.Game.creeps.m2;old.ticksToLive=90;
 assert(old.ticksToLive>old.body.length*3+35,'scenario must precede the old generic lifetime threshold');
 assert.equal(minerRenewal(f.room,Object.values(ctx.Game.creeps),f.sp).replaces,old.name);
 spawnRoom(f.room);assert.equal(f.request.memory.role,'miner');assert.equal(f.request.memory.replaces,old.name,'deadline renewal must precede noncritical carry growth');
 const next=f.creep('renewal','miner',21,28,0,50,f.request.body);Object.assign(next.memory,f.request.memory);next.spawning=true;
 assert.equal(minerRenewal(f.room,Object.values(ctx.Game.creeps),f.sp),null,'one pending replacement satisfies its deadline demand');
 assert.equal(old.memory.role,'miner','spawning a successor must leave the incumbent producing');
}
{
 const f=pipelineFixture();updateEconomy(f.room);f.room.sites=[];
 for(let i=0;i<6;i++){ctx.Game.time+=100;updateEconomy(f.room);}
 const policy=updateEconomy(f.room);assert(policy.target>2,'no remaining construction must release surplus upgrade demand even before the capacity/miner phase gate ends');
 assert.equal(policy.builderWork,0);assert.equal(policy.buildEnergyTarget,0);
 f.room.sites=[{id:'extension',structureType:C.STRUCTURE_EXTENSION,pos:f.pos(22,28),progress:100,progressTotal:3000}];
 ctx.Game.time+=100;const construction=updateEconomy(f.room);assert.equal(construction.target,policy.target-2,'returning construction demand reduces upgrade consumption in bounded steps');
 assert(construction.builderWork>=1);assert(construction.buildEnergyTarget>0);
 assert(construction.target+construction.buildEnergyTarget<=construction.usefulTarget+.01,'bounded upgrade transition must not double-allocate construction energy');
}
{
 const low=pipelineFixture();low.room.sites=[];low.structure(C.STRUCTURE_STORAGE,'storage',20,20,1000,1000000);
 low.ledger({harvestRate:8});const lowPolicy=updateEconomy(low.room);
 assert.equal(lowPolicy.reason,'measured-sustainable-budget');assert(lowPolicy.target<=4,'measured sustainable income must protect a low reserve');assert.equal(lowPolicy.feedbackTicks,300);
 const lowTarget=lowPolicy.target;ctx.Game.time+=100;low.ledger({harvestRate:8});assert(updateEconomy(low.room).target<=lowTarget);
 const high=pipelineFixture();high.room.sites=[];high.structure(C.STRUCTURE_STORAGE,'storage',20,20,31000,1000000);
 assert.equal(updateEconomy(high.room).target,16,'a well-stocked room can consume a bounded surplus');
 const warm=pipelineFixture();warm.room.sites=[];warm.ledger({warmingUp:true,inventoryDelta:-900,sustainedLow:true});
 assert.equal(updateEconomy(warm.room).feedbackTicks,0,'incomplete ledger windows cannot steer work budgets');
 const stale=pipelineFixture();stale.room.sites=[];stale.ledger({inventoryDelta:-900});ctx.Memory.frontier.energy.rooms[stale.room.name].windows['300'].tick-=101;
 assert.equal(updateEconomy(stale.room).feedbackTicks,0,'old ledger observations cannot steer work budgets');
}
console.log('PASS: live-shaped sustained hauling bottleneck, route/swamp budget, bounded growth and 300-tick decline, backlog freshness, right-sized carry replacement, proactive miner deadlines, construction-to-upgrade release, stock/ledger guardrails');
{
 const f=pipelineFixture();const policy=updateEconomy(f.room),builder=ctx.Game.creeps.builder;builder.memory.loaded=true;let spent=0;
 for(let i=0;i<100;i++){ctx.Game.time=1000+i;builder.actions.length=0;work(builder);work(ctx.Game.creeps.upgrader);finishDevelopment(f.room);if(builder.actions.some(a=>a[0]==='build'))spent+=builder.getActiveBodyparts(C.WORK)*C.BUILD_POWER;}
 assert(spent/100<=policy.buildEnergyTarget+.15,'existing builder cohorts must respect the energy budget across a complete duty cycle');
 assert(spent/100>=policy.buildEnergyTarget-.2,'duty control should use the allocated construction budget when work and supply are available');
 const low=pipelineFixture();low.room.sites=[];low.structure(C.STRUCTURE_STORAGE,'storage',20,20,1000,1000000);
 low.ledger({harvestRate:16});const before=updateEconomy(low.room).target;
 ctx.Game.time+=100;low.ledger({eligible:false,blocked:['stock-drawdown'],inventoryDelta:-900});
 const after=updateEconomy(low.room);assert.equal(after.reason,'measured-reserve-drawdown');assert.equal(after.target,before-2,'a trustworthy full window with only drawdown exclusion must lower unsafe spending');
 const incomplete=pipelineFixture();incomplete.room.sites=[];incomplete.ledger({eligible:false,blocked:['stock-drawdown','scope-change'],inventoryDelta:-900});
 assert.equal(updateEconomy(incomplete.room).feedbackTicks,0,'drawdown cannot override incomplete accounting scope');
 const pending=pipelineFixture();pending.room.sites=[];pending.ledger({sustainedLow:true});
 const p=updateEconomy(pending.room);assert.notEqual(p.reason,'measured-idle-surplus','the 300-tick pending signal cannot trigger demand growth');
 ctx.Game.time+=100;pending.ledger({sustainedLow:true});ctx.Memory.frontier.energy.rooms[pending.room.name].indicator.status='active';
 const active=updateEconomy(pending.room);assert.equal(active.reason,'measured-idle-surplus');assert(active.target<=p.target+2,'even confirmed long-window low efficiency only increases demand in bounded steps');
}
console.log('PASS: real construction duty budget, safe reductions under drawdown-only exclusion, incomplete-scope rejection, pending versus active low-efficiency response');
{
 const f=pipelineFixture();f.room.sites=[];const storage=f.structure(C.STRUCTURE_STORAGE,'storage',20,20,10000,1000000);
 const initial=updateEconomy(f.room);assert.equal(initial.baseMode,'reserve');
 for(const stock of [14999,15001,17999]){ctx.Game.time+=20;storage.store[C.RESOURCE_ENERGY]=stock;const held=updateEconomy(f.room);assert.equal(held.baseMode,'reserve','reserve mode must persist below 18000');assert.equal(held.at,initial.at,'crossing 15000 must not bypass the 100-tick decision interval');}
 storage.store[C.RESOURCE_ENERGY]=18000;assert.equal(updateEconomy(f.room).baseMode,'growth','reserve mode may leave at 18000');
}
{
 const f=pipelineFixture();f.room.sites=[];const storage=f.structure(C.STRUCTURE_STORAGE,'storage',20,20,20000,1000000);
 const initial=updateEconomy(f.room);assert.equal(initial.baseMode,'growth');
 for(const stock of [15001,14999,12000]){ctx.Game.time+=20;storage.store[C.RESOURCE_ENERGY]=stock;const held=updateEconomy(f.room);assert.equal(held.baseMode,'growth','growth must persist until storage falls below 12000');assert.equal(held.at,initial.at,'ordinary stock movements must preserve the decision cadence');}
 storage.store[C.RESOURCE_ENERGY]=11999;assert.equal(updateEconomy(f.room).baseMode,'reserve');
}
{
 const f=pipelineFixture();f.room.sites=[];f.structure(C.STRUCTURE_STORAGE,'storage',20,20,40000,1000000);
 const initial=updateEconomy(f.room);assert.equal(initial.baseMode,'growth');ctx.Game.time++;
 ctx.Memory.frontier.expansion={home:f.room.name,state:'stabilizing'};
 const expanding=updateEconomy(f.room);assert.equal(expanding.baseMode,'reserve','an active home expansion must force reserve mode despite high storage');assert.equal(expanding.at,ctx.Game.time,'an actual expansion transition can recompute policy immediately');assert.equal(expanding.reserveRate,3);
}
console.log('PASS: reserve exit at 18000, growth entry below 12000, 100-tick cadence survives stock crossings, expansion forces reserve');
{
 const f=pipelineFixture();delete ctx.Game.creeps.builder;
 f.room.sites=[{id:'started',structureType:C.STRUCTURE_EXTENSION,pos:f.pos(16,33),progress:605,progressTotal:3000},{id:'next',structureType:C.STRUCTURE_EXTENSION,pos:f.pos(18,33),progress:0,progressTotal:3000}];
 const primary=f.creep('primary','builder',18,30,90,100,[C.WORK,C.WORK,C.CARRY,C.CARRY,C.MOVE,C.MOVE]);
 const helper=f.creep('helper','builder',19,30,35,50,[C.WORK,C.CARRY,C.MOVE]);
 const retired=f.creep('retired','builder',16,39,50,50,[...Array(4).fill(C.WORK),C.CARRY,C.MOVE,C.MOVE]);retired.ticksToLive=27;
 const empty=f.creep('empty','builder',17,32,0,50,[...Array(4).fill(C.WORK),C.CARRY,C.MOVE,C.MOVE]);
 for(const c of [primary,helper,retired,empty])c.memory.loaded=true;
 const control=updateEconomy(f.room);control.buildEnergyTarget=11.93;control.developmentBudget=control.target+11.93;
 let spent=0;
 for(let i=0;i<100;i++){
  ctx.Game.time=1000+i;
  for(const c of [primary,helper]){c.actions.length=0;work(c);if(c.actions.some(a=>a[0]==='build'))spent+=c.getActiveBodyparts(C.WORK)*C.BUILD_POWER;}
  work(ctx.Game.creeps.upgrader);finishDevelopment(f.room);
  retired.actions.length=0;work(retired);assert.deepEqual(retired.actions[0],['move',16,33,3],'retired miner must travel toward the selected construction site on every tick, including duty-off ticks');
 }
 assert(spent/100<=control.buildEnergyTarget,'actionable builders must retain the actual construction spending upper bound');
 assert(spent/100>=11.8,'out-of-range retired and empty workers must not suppress the active three WORK to about five energy/tick');
 // Once the retired miner reaches work range with energy, its WORK shares the same cap.
 retired.pos=f.pos(16,36);let allSpent=0;
 for(let i=0;i<100;i++){ctx.Game.time=1100+i;for(const c of [primary,helper,retired])c.actions.length=0;for(const c of [primary,helper,retired])work(c);work(ctx.Game.creeps.upgrader);finishDevelopment(f.room);for(const c of [primary,helper,retired])if(c.actions.some(a=>a[0]==='build'))allSpent+=c.getActiveBodyparts(C.WORK)*C.BUILD_POWER;}
 assert(allSpent/100<=control.buildEnergyTarget,'arrival of extra workers must not multiply the room construction allowance');
 assert(allSpent/100>=control.buildEnergyTarget-.35,'full-cohort duty allocation should still use the available spending allowance');
}
console.log('PASS: in-range fueled builders retain budget despite retired miner travel and empty peers, unrestricted site travel, arriving extra WORK shares the construction cap');
{
 const f=pipelineFixture();delete ctx.Game.creeps.builder;
 f.room.sites=[{id:'live-extension',structureType:C.STRUCTURE_EXTENSION,pos:f.pos(16,33),progress:2665,progressTotal:3000}];
 const builder=f.creep('builder','builder',18,30,35,100,[C.WORK,C.WORK,C.CARRY,C.CARRY,C.MOVE,C.MOVE]);builder.memory.loaded=true;
 const box=f.structure(C.STRUCTURE_CONTAINER,'controller-box',16,23,760),supply=f.structure(C.STRUCTURE_CONTAINER,'work-box',17,32,0);
 builder.memory.workSupply={id:supply.id,job:'live-extension',room:f.room.name};
 const carrier=f.creep('urgent-carrier','hauler',16,30,100,100,[C.CARRY,C.CARRY,C.MOVE,C.MOVE]);carrier.memory.loaded=true;
 assert.equal(haulTarget(carrier),supply,'active construction uses its fixed supply building before a healthy controller reserve');
 assert.equal(carrier.memory.haulDelivery.amount,100);
 supply.store[C.RESOURCE_ENERGY]=200;box.store[C.RESOURCE_ENERGY]=10;
 assert.equal(haulTarget(carrier),box,'a nearly empty controller reserve retains emergency priority');
 const spawn=f.room.objects.find(o=>o.structureType===C.STRUCTURE_SPAWN);spawn.store[C.RESOURCE_ENERGY]=100;
 assert.equal(haulTarget(carrier),spawn,'spawn replenishment keeps its original priority');
}
{
 const f=pipelineFixture();delete ctx.Game.creeps.builder;
 const site=f.room.sites[0],builder=f.creep('batch-builder','builder',21,28,90,100,[C.WORK,C.WORK,C.CARRY,C.CARRY,C.MOVE,C.MOVE]);
 builder.memory.loaded=false;builder.memory.refuelTarget={id:'far-box',kind:'take',room:f.room.name,position:'21,28',progress:ctx.Game.time};
 const policy=updateEconomy(f.room);policy.buildEnergyTarget=10;policy.developmentBudget=policy.target+10;
 assert.equal(buildAllowed(builder),true,'a 90% batch is ready in construction-budget allocation before worker order is processed');
 work(builder);assert.equal(builder.memory.loaded,true);assert.equal(builder.memory.refuelTarget,undefined);
 assert.deepEqual(builder.actions[0],['build',site.id],'a supplied 90/100 builder must build instead of chasing its final ten energy');
 ctx.Game.time++;builder.memory.loaded=false;builder.store[C.RESOURCE_ENERGY]=89;builder.actions.length=0;
 assert.equal(buildAllowed(builder),false,'a builder below its completed-batch threshold is not counted as work-ready');
 work(builder);assert.equal(builder.actions[0][0],'withdraw','the threshold does not indiscriminately turn partial loads into ready builders');
}
console.log('PASS: fixed construction supply priority, controller emergency/spawn priorities, matching 90% construction readiness');
{
 const f=fixture(),c=f.creep('searcher','hauler',20,20),adjacent=f.structure(C.STRUCTURE_EXTENSION,'adjacent',21,21),blocked=f.structure(C.STRUCTURE_EXTENSION,'blocked',23,23),reachable=f.structure(C.STRUCTURE_EXTENSION,'reachable',27,27);
 let searches=0;c.pos.findClosestByPath=items=>{searches++;assert(items.includes(reachable));return reachable;};
 assert.equal(near(c,[]),null);assert.equal(near(c,[blocked,adjacent]),adjacent);assert.equal(searches,0,'empty and already actionable targets require no path search');
 assert.equal(near(c,[blocked,reachable]),reachable);assert.equal(searches,1,'a closer geometric target must not bypass actual path reachability');
}
{
 const f=fixture();f.room.sites=[{id:'site',structureType:C.STRUCTURE_EXTENSION,pos:f.pos(20,30),progress:0}];
 const first=f.structure(C.STRUCTURE_CONTAINER,'first-node',25,25,0),second=f.structure(C.STRUCTURE_CONTAINER,'second-node',15,25,30);
 for(const node of [first,second]){const worker=f.creep(node.id+'-worker','builder',20,30,0,100);worker.memory.workSupply={id:node.id,job:'site',room:f.room.name};}
 const c=f.creep('courier','hauler',20,20,200,200,[C.CARRY,C.MOVE]);c.memory.loaded=true;
 c.transfer=t=>c.pos.getRangeTo(t)>1?C.ERR_NOT_IN_RANGE:C.OK;
 let searches=0;const locate=c.pos.findClosestByPath;c.pos.findClosestByPath=function(a){searches++;return locate.call(this,a);};
 haul(c);assert.equal(c.memory.haulDelivery.id,first.id);assert.equal(searches,1);
 first.store[C.RESOURCE_ENERGY]=20;second.store[C.RESOURCE_ENERGY]=0;
 ctx.Game.time++;haul(c);assert.equal(c.memory.haulDelivery.id,first.id,'a fluctuating equal-priority gap must not reverse a valid trip');assert.equal(searches,1,'committed delivery reuses its existing route');
 const emergency=f.structure(C.STRUCTURE_SPAWN,'emergency-spawn',19,19,0,300);
 ctx.Game.time++;haul(c);assert.equal(c.memory.haulDelivery.id,emergency.id,'new spawn demand immediately preempts a normal delivery');
 emergency.store[C.RESOURCE_ENERGY]=300;first.store[C.RESOURCE_ENERGY]=200;
 ctx.Game.time++;haul(c);assert.equal(c.memory.haulDelivery.id,second.id,'filled targets release commitments');
 c.memory.haulBlocked={[second.id]:ctx.Game.time+15};first.store[C.RESOURCE_ENERGY]=20;
 assert.equal(haulTarget(c),first,'blocked commitments cannot override target exclusion');
}
{
 const f=fixture(),c=f.creep('mover','hauler',20,20),destination=f.pos(28,28),calls=[];
 c.moveTo=(p,opt)=>{calls.push({hadPath:!!c.memory._move,ignoreCreeps:opt.ignoreCreeps,reusePath:opt.reusePath});return C.OK;};
 c.memory._move={path:'cached'};const start=ctx.Game.time;
 go(c,destination);assert.equal(c.memory.stuck,0);assert.equal(calls.at(-1).hadPath,true);
 ctx.Game.time=start+1;go(c,destination);assert.equal(c.memory.stuck,1);assert.equal(calls.at(-1).hadPath,true);
 ctx.Game.time=start+2;go(c,destination);assert.equal(c.memory.stuck,2);assert.equal(calls.at(-1).hadPath,false,'two failed actual steps invalidate moveTo cache');assert.equal(calls.at(-1).ignoreCreeps,false);assert.equal(calls.at(-1).reusePath,15,'the newly generated detour remains reusable');
 c.memory._move={path:'detour'};ctx.Game.time++;c.pos=f.pos(21,20);go(c,destination);assert.equal(c.memory.stuck,0,'successful movement clears blockage');assert.equal(calls.at(-1).hadPath,true);
 ctx.Game.time+=10;go(c,destination);assert.equal(c.memory.stuck,0,'working in place between trips is not continuous blocked movement');
 const attempted=c.memory.moveAttempt,n=calls.length;ctx.Game.time++;c.fatigue=2;assert.equal(go(c,destination),C.ERR_TIRED);assert.equal(calls.length,n);assert.equal(c.memory.moveAttempt,attempted,'fatigue waiting must not pretend a movement intent occurred');
 ctx.Game.time++;c.fatigue=0;go(c,destination);assert.equal(c.memory.stuck,0,'recovering from fatigue receives a new movement progress window');
 ctx.Game.time++;go(c,f.pos(10,10));assert.equal(c.memory.stuck,0,'a changed destination does not inherit the old blockage count');
}
console.log('PASS: empty/adjacent path fast paths, genuine reachability, stable delivery trips, urgent preemption, completion/blockage invalidation, consecutive movement-only stuck detection and explicit cached-path recovery');
{
 let used=0,memoryTick=-1;const mem={};
 const prof={...C,module:{exports:{}},console,global:{},Game:{time:1,creeps:{},rooms:{},gcl:{},cpu:{bucket:10000,getUsed(){used+=.01;return used;}}},require:()=>({tick(){},run(){}})};
 Object.defineProperty(prof,'Memory',{get(){if(memoryTick!==prof.Game.time){used+=3;memoryTick=prof.Game.time;}return mem;}});
 vm.createContext(prof);vm.runInContext(readSource('main.js'),prof);
 for(let tick=1;tick<=20;tick++){prof.Game.time=tick;used=0;prof.module.exports.loop();}
 const first=mem.frontier.performance;
 assert.equal(first.samples,20);assert.equal(first.from,1);assert.equal(first.tick,20);
 assert(first.stages.memory.mean>=3,'the first lazy Memory parse must be included in its own CPU stage');
 assert(first.mean>=3);assert(first.totals.entry.mean<.1,'entry CPU must precede the lazy Memory read');
 assert(first.stages.monitor.calls===20&&first.max>=first.mean);
 for(let tick=21;tick<=40;tick++){prof.Game.time=tick;used=0;prof.module.exports.loop();}
 assert.equal(mem.frontier.performance.samples,20);assert.equal(mem.frontier.performance.from,21,'CPU counters reset after each bounded summary');
 assert.equal(mem.frontier.performance.tick,40);
 assert(JSON.stringify(mem.frontier.performance).length<2000,'the CPU monitor must not create an unbounded per-creep log');
 prof.RawMemory={get:()=>'{"fixture":true}'};
 for(let tick=41;tick<=1240;tick++){prof.Game.time=tick;used=0;prof.module.exports.loop();}
 assert.equal(mem.frontier.performance.memoryBytes,16);
 assert.equal(mem.frontier.performance.history.length,60,'published CPU history retains only sixty compact samples');
 assert.equal(mem.frontier.performance.history[0].tick,60);assert.equal(mem.frontier.performance.history.at(-1).tick,1240);
 assert(JSON.stringify(mem.frontier.performance).length<12000,'bounded monitoring must not recreate the oversized Memory problem');
}
console.log('PASS: CPU attribution starts before lazy Memory parsing, stage counts, bounded twenty-tick windows and small summaries');
{
 const f=pipelineFixture();f.room.sites=[];f.room.energyAvailable=f.room.energyCapacityAvailable=800;
 for(const name of ['m1','m2'])ctx.Game.creeps[name].body.unshift(C.WORK);
 delete ctx.Game.creeps.builder;
 const builder=f.creep('retired-builder','builder',16,24,100,100,[C.WORK,C.WORK,C.CARRY,C.CARRY,C.MOVE,C.MOVE]);builder.memory.loaded=true;
 for(const [name,parts] of [['up4a',4],['up4b',4],['up6',6]]){const c=f.creep(name,'upgrader',17,23,100,100,[...Array(parts).fill(C.WORK),C.CARRY,C.CARRY,C.MOVE]);c.memory.loaded=true;}
 f.creep('haul-extra','hauler',21,28,0,600,[...Array(12).fill(C.CARRY),...Array(12).fill(C.MOVE)]);
 const control=updateEconomy(f.room);control.target=14;control.developmentBudget=14;
 assert.equal(upgradePolicy(f.room).mode,'growth');
 work(builder);assert.equal(builder.memory.role,'upgrader');assert.equal(builder.actions.length,0,'the conversion tick must not add an unbudgeted upgrade intent');
 const cohort=Object.values(ctx.Game.creeps).filter(c=>c.memory.role==='upgrader');
 assert.equal(cohort.reduce((n,c)=>n+c.getActiveBodyparts(C.WORK),0),18);
 let spent=0;
 for(let tick=1001;tick<=1036;tick++){
  ctx.Game.time=tick;
  for(const c of cohort){c.actions.length=0;work(c);if(c.actions.some(a=>a[0]==='upgrade'))spent+=c.getActiveBodyparts(C.WORK);}
 }
 assert(spent/36<=14&&spent/36>=14-6/36,'18 WORK must share 14 energy/tick, allowing at most one largest action of rounding remainder');
 spawnRoom(f.room);assert.equal(ctx.Memory.frontier.rooms[f.room.name].economy.upgradeWork,18,'spawn demand counts the converted body in the regular upgrade workforce');
 f.room.sites=[{id:'new-extension',structureType:C.STRUCTURE_EXTENSION,pos:f.pos(22,28),progress:0,progressTotal:3000}];
 ctx.Game.time=1100;f.request=null;spawnRoom(f.room);
 assert.equal(f.request.memory.role,'builder','a later construction project still creates its normal builder demand');
}
{
 const f=pipelineFixture();f.room.sites=[];const builder=ctx.Game.creeps.builder;builder.memory.loaded=true;
 assert.equal(upgradePolicy(f.room).mode,'infrastructure');work(builder);
 assert.equal(builder.memory.role,'builder','a temporary gap in infrastructure construction must not convert its builder');
 assert(builder.actions.some(a=>a[0]==='upgrade'));
}
for(const scenario of ['rcl1','downgrade','bootstrap','pioneer']){
 const f=fixture();f.room.energyAvailable=f.room.energyCapacityAvailable=800;f.room.controller.level=scenario==='rcl1'?1:3;
 if(scenario==='downgrade')f.room.controller.ticksToDowngrade=100;
 const role=['bootstrap','pioneer'].includes(scenario)?scenario:'builder';
 const c=f.creep('protected-'+scenario,role,16,23,50,50);c.memory.loaded=true;work(c);
 assert.equal(c.memory.role,role,scenario+' must preserve its existing role');assert(c.actions.some(a=>a[0]==='upgrade'),scenario+' retains its previous upgrade behavior');
}
console.log('PASS: retired growth builder joins shared upgrade budget without transition overspend, spawn accounting, later builder demand, infrastructure/RCL1/emergency and other-role protection');
// Replay the historical duplicate-delivery bug against the actual terrain and
// unchanged execution plan. This is an offline fixture, not live throughput.
function stationFixture(){
 const f=fixture(),flow=JSON.parse(readSource('fixtures/fixed-logistics.json')),world=flow,plan=flow.plan;
 ctx.Game.time=flow.tick;f.room.controller.level=3;f.room.energyAvailable=f.room.energyCapacityAvailable=800;
 f.room.getTerrain=()=>({get:(x,y)=>Number(world.terrain[x+50*y])});
 const a=f.source('near',24,24),b=f.source('far',16,42);
 for(const item of flow.boxes)f.structure(C.STRUCTURE_CONTAINER,item.id,...item.pos,item.energy);
 for(const item of flow.creeps){const c=f.creep(item.name,item.memory.role,...item.pos,item.energy,item.capacity,[...Array(item.work).fill(C.WORK),...Array(item.capacity/50).fill(C.CARRY),C.MOVE]);
  c.memory.loaded=item.memory.loaded;if(item.memory.delivery)c.memory.haulDelivery={...item.memory.delivery};
  if(item.memory.role==='miner')c.memory.source=item.pos[1]===25?a.id:b.id;
 }
 ctx.Memory.frontier.rooms[f.room.name]={plan,economyControl:{at:ctx.Game.time,baseMode:'growth',mode:'growth',target:14,routes:[{roundTrip:22},{roundTrip:40}]}};
 return {...f,flow,box:f.room.objects.find(s=>s.structureType===C.STRUCTURE_CONTAINER&&s.pos.x===16),ups:Object.values(ctx.Game.creeps).filter(c=>c.memory.role==='upgrader'),haulers:Object.values(ctx.Game.creeps).filter(c=>c.memory.role==='hauler')};
}
{
 const f=stationFixture(),station=controllerStation(f.room);
 assert.deepEqual([station.port.x,station.port.y],[17,24],'the existing controller road is the fixed delivery port');
 assert.deepEqual(Array.from(station.seats,p=>p.x+','+p.y).sort(),['15,23','16,22','16,23','17,23'],'four seats exclude future extension/link, terrain walls and both planned access roads');
 for(const c of f.ups)work(c);
 const seats=f.ups.map(c=>c.memory.upgradeSeat.x+','+c.memory.upgradeSeat.y);
 assert.equal(new Set(seats).size,4,'each living primary upgrader owns a unique seat');
 const saved=JSON.stringify(f.ups.map(c=>c.memory.upgradeSeat));ctx.Game.time++;for(const c of f.ups)work(c);
 assert.equal(JSON.stringify(f.ups.map(c=>c.memory.upgradeSeat)),saved,'position fluctuations cannot reshuffle persistent seats');
 for(const c of f.haulers){const target=haulTarget(c);assert(!target||target.structureType,'historical three-hauler pursuit must not survive migration');assert.notEqual(c.memory.haulDelivery?.id,f.ups[0].name);}
 // A stationary courier on the approach clears it even when no demand remains.
 f.box.store[C.RESOURCE_ENERGY]=2000;const c=f.haulers.find(c=>c.store[C.RESOURCE_ENERGY]>0);c.pos=f.pos(17,24);c.actions.length=0;c.memory.loaded=true;haul(c);
 assert(c.actions.some(a=>a[0]==='move'),'idle loaded couriers yield the delivery port');
}
{
 const f=stationFixture();for(const c of f.ups)work(c);
 for(const c of f.ups)c.pos=f.pos(c.memory.upgradeSeat.x,c.memory.upgradeSeat.y);
 let upgrades=0,concurrent=0;
 for(let tick=0;tick<32;tick++){
  ctx.Game.time=f.flow.tick+tick;f.box.store[C.RESOURCE_ENERGY]=2000;
  for(const c of f.ups){c.store[C.RESOURCE_ENERGY]=8;c.actions.length=0;work(c);
   assert(c.actions.some(a=>a[0]==='withdraw'),'prefuel begins while the worker still has initial energy');
   assert(!c.actions.some(a=>a[0]==='move'),'fixed workers neither chase fuel nor move on duty-off ticks');
   if(c.actions.some(a=>a[0]==='upgrade')){upgrades+=4;concurrent++;}
  }
 }
 assert.equal(upgrades/32,14,'fixed prefueling preserves the original fourteen-energy upgrade duty budget');assert(concurrent>0);
 const c=f.ups[0];c.store[C.RESOURCE_ENERGY]=0;c.actions.length=0;work(c);
 assert(c.actions.some(a=>a[0]==='withdraw'));assert(!c.actions.some(a=>a[0]==='upgrade'),'newly withdrawn energy cannot fund an upgrade from zero initial energy');
 assert(JSON.stringify(ctx.Memory.frontier.rooms[f.room.name].upgradeStation).length<700,'runtime station state remains compact');
}
{
 const f=stationFixture();f.box.store[C.RESOURCE_ENERGY]=600;
 for(const c of f.haulers){c.store[C.RESOURCE_ENERGY]=c.store[C.RESOURCE_ENERGY]+c.store.getFreeCapacity();c.memory.loaded=true;delete c.memory.haulDelivery;}
 const need=deliveryNeeds(f.room).find(n=>n.node.id===f.box.id),gap=need.high-600;
 for(const c of f.haulers)haulTarget(c);
 const promised=f.haulers.reduce((n,c)=>n+(c.memory.haulDelivery?.amount||0),0);
 assert(promised<=gap,'carriers subtract other live commitments before reserving the same deficit');
 const selected=f.haulers.filter(c=>c.memory.haulDelivery);assert(selected.length<f.haulers.length,'the final small gap cannot attract every truck');
 const first=selected[0],amount=first.memory.haulDelivery.amount;delete ctx.Game.creeps[first.name];
 const waiting=f.haulers.find(c=>!c.memory.haulDelivery);assert.equal(haulTarget(waiting),f.box,'a dead carrier releases its amount without stale room-level reservations');
 assert(waiting.memory.haulDelivery.amount<=amount+50);
 waiting.memory.haulDelivery.expires=ctx.Game.time;const old=waiting.memory.haulDelivery;haulTarget(waiting);
 assert.notEqual(waiting.memory.haulDelivery,old,'expired commitments are released and may be reassigned');
 f.room.objects=f.room.objects.filter(s=>s.id!==f.box.id);assert.equal(haulTarget(waiting),null,'destroyed destination cannot retain a delivery commitment');
}
{
 const f=fixture(),spawn=f.structure(C.STRUCTURE_SPAWN,'small-spawn-gap',20,20,220,300);
 const first=f.creep('first','hauler',19,20,100,100,[C.CARRY,C.MOVE]),second=f.creep('second','hauler',18,20,100,100,[C.CARRY,C.MOVE]);
 first.memory.loaded=second.memory.loaded=true;let sent;
 first.transfer=(target,resource,amount)=>{sent=amount;return C.OK;};haul(first);
 assert.equal(sent,80,'transfer is capped to the promised deficit, not the full cargo');
 assert.equal(haulTarget(second),null,'a successful pending transfer stays reserved until the next Store snapshot');
 ctx.Game.time++;spawn.store[C.RESOURCE_ENERGY]=300;assert.equal(haulTarget(second),null);assert.equal(haulTarget(first),null);assert.equal(first.memory.haulDelivery,undefined);
 spawn.store[C.RESOURCE_ENERGY]=0;first.store[C.RESOURCE_ENERGY]=0;first.memory.loaded=false;
 const source=f.source('source',25,25),box=f.structure(C.STRUCTURE_CONTAINER,'source-box',24,25,500);
 first.withdraw=()=>C.ERR_NOT_IN_RANGE;haul(first);
 assert.equal(first.memory.haulDelivery.phase,'pickup');assert.equal(first.memory.haulDelivery.source,box.id,'an empty delivery reserves a destination and records its fixed source during pickup');
 const reserved=first.memory.haulDelivery.amount;assert.equal(haulTarget(second),spawn);assert(first.memory.haulDelivery.amount+second.memory.haulDelivery.amount<=300);
}
{
 const f=stationFixture();for(const c of f.ups)work(c);
 const first=f.ups[0],seat=first.memory.upgradeSeat;
 f.structure(C.STRUCTURE_EXTENSION,'unexpected-obstacle',seat.x,seat.y,0,50);ctx.Game.time++;work(first);
 assert(!first.memory.upgradeSeat||first.memory.upgradeSeat.x!==seat.x||first.memory.upgradeSeat.y!==seat.y,'a newly blocked seat is invalidated');
 const link=f.structure(C.STRUCTURE_LINK,'controller-link',16,24,600,800);f.room.controller.level=5;ctx.Game.time++;
 f.room.objects=f.room.objects.filter(s=>s.id!==f.box.id);const station=controllerStation(f.room);
 assert.equal(station.node.id,link.id,'destroyed container plus RCL5 link rebuilds the station around a valid node');
 for(const p of station.seats){assert(f.pos(p.x,p.y).getRangeTo(link)<=1);assert(f.pos(p.x,p.y).getRangeTo(f.room.controller)<=3);}
 f.room.objects=f.room.objects.filter(s=>s.id!==link.id);ctx.Game.time++;first.store[C.RESOURCE_ENERGY]=0;first.memory.loaded=false;first.actions.length=0;work(first);
 assert.equal(first.memory.upgradeSeat,undefined);assert(first.actions.some(a=>a[0]==='withdraw'),'no-box workers retain source-container recovery');
}
{
 const f=stationFixture(),c=f.ups[0];c.pos=f.pos(25,28);c.moveTo=()=>C.ERR_NO_PATH;work(c);
 assert.equal(c.memory.upgradeSeat,undefined);assert(c.memory.stationAvoid.until>ctx.Game.time,'an unreachable seat releases its claim with a bounded cooldown');
 ctx.Game.time++;c.actions.length=0;work(c);assert.equal(c.memory.upgradeSeat,undefined,'another worker assignment cannot force a cooling-down worker back into a failed seat');
 const starving=stationFixture(),worker=starving.ups[0];starving.box.store[C.RESOURCE_ENERGY]=0;worker.store[C.RESOURCE_ENERGY]=0;worker.memory.loaded=false;
 work(worker);ctx.Game.time+=21;worker.actions.length=0;work(worker);
 assert(worker.actions.some(a=>a[0]==='withdraw'&&a[1]!==starving.box.id),'prolonged station outage invokes bounded self-refuel recovery');
}
console.log('PASS: actual-terrain four fixed seats and open delivery/access roads, historical duplicate-target migration, prewithdraw plus upgrade with initial-stock guard and conserved budget, batch promises/death/expiry/destruction/same-tick completion, RCL5/blocked-seat/no-box/station-outage recovery');
{
 const f=fixture(),near=f.source('near-source',25,25),far=f.source('far-source',17,41);
 const hub=f.structure(C.STRUCTURE_LINK,'hub',21,26,0,800),source=f.structure(C.STRUCTURE_LINK,'source-link',16,40,700,800);
 ctx.Memory.frontier.rooms[f.room.name]={plan:{structures:[{type:'link',x:21,y:26,tag:'hub-link'},{type:'link',x:16,y:40,tag:'source-link-far-source'},{type:'link',x:16,y:24,tag:'controller-link'}]}};
 const sent=[];for(const node of [hub,source])node.transferEnergy=(target,amount)=>{sent.push([node.id,target.id,amount]);return C.OK;};
 f.room.controller.level=5;links(f.room);assert.deepEqual(sent,[['source-link','hub',700]],'RCL5 source link can operate before a controller link exists');
 source.cooldown=1;sent.length=0;links(f.room);assert.equal(sent.length,0,'cooling links do not claim delivery capacity');source.cooldown=0;
 const controller=f.structure(C.STRUCTURE_LINK,'controller-link',16,24,0,800);f.room.controller.level=6;
 sent.length=0;links(f.room);assert.deepEqual(sent,[['source-link','controller-link',700]],'source input prefers the controller when present');
 controller.store[C.RESOURCE_ENERGY]=800;sent.length=0;links(f.room);assert.deepEqual(sent,[['source-link','hub',700]],'full controller redirects source input to hub');
 source.store[C.RESOURCE_ENERGY]=0;hub.store[C.RESOURCE_ENERGY]=500;controller.store[C.RESOURCE_ENERGY]=100;sent.length=0;links(f.room);
 assert.deepEqual(sent,[['hub','controller-link',500]],'hub can forward initial stock to the controller');
 controller.store[C.RESOURCE_ENERGY]=800;
 const spawn=f.structure(C.STRUCTURE_SPAWN,'spawn',21,28,0,300),carrier=f.creep('hub-courier','hauler',22,27,0,100,[C.CARRY,C.MOVE]);
 haul(carrier);assert.deepEqual(carrier.actions.at(-1),['withdraw',hub.id],'haulers drain received hub stock for spawn/core delivery');
 carrier.store[C.RESOURCE_ENERGY]=100;carrier.memory.loaded=true;spawn.store[C.RESOURCE_ENERGY]=300;
 const storage=f.structure(C.STRUCTURE_STORAGE,'storage',19,28,0,1000000);assert.equal(haulTarget(carrier),storage,'received hub stock can also move into storage');
 hub.store[C.RESOURCE_ENERGY]=0;delete carrier.memory.withdrawnFrom;spawn.store[C.RESOURCE_ENERGY]=300;storage.store[C.RESOURCE_ENERGY]=1000000;
 assert.notEqual(haulTarget(carrier),hub,'haulers never refill the hub receiver');
}
// Exercise the pinned official processor's action dispatcher and both intents.
// The runtime API rejects an upgrade from zero initial energy before dispatch.
{
 const lodash=require(require.resolve('lodash',{paths:[engine]})),processors={};
 const utility={getDriver:()=>({constants:C}),calcResources:o=>Object.values(o.store||{}).reduce((n,v)=>n+v,0)};
 for(const name of ['withdraw','upgradeController']){
  const mod={exports:{}};vm.runInNewContext(fs.readFileSync(engine+'/src/processor/intents/creeps/'+name+'.js','utf8'),{module:mod,require(id){if(id==='lodash')return lodash;if(id==='../../../utils')return utility;if(id==='../../../config')return{};throw Error(id);}});processors[name]=mod.exports;
 }
 const dispatch={exports:{}};vm.runInNewContext(fs.readFileSync(engine+'/src/processor/intents/creeps/intents.js','utf8'),{module:dispatch,__dirname:'.',require(id){if(id==='lodash')return lodash;if(id==='bulk-require')return()=>processors;throw Error(id);}});
 const object={_id:'upgrader',type:'creep',user:'me',x:16,y:22,store:{energy:8},storeCapacity:100,body:Array.from({length:4},()=>({type:C.WORK,hits:100})),actionLog:{}};
 const box={_id:'box',type:'container',x:16,y:23,store:{energy:500}},controller={_id:'controller',type:'controller',user:'me',x:16,y:21,level:3,progress:100,downgradeTime:10000};
 const events=[];dispatch.exports(object,{withdraw:{id:'box',resourceType:C.RESOURCE_ENERGY,amount:92},upgradeController:{id:'controller'}},{roomObjects:{box,controller,upgrader:object},bulk:{update(){}},bulkUsers:{},stats:{inc(){}},roomController:controller,gameTime:100,eventLog:events});
 assert.equal(object.store.energy,96);assert.equal(box.store.energy,408);assert.equal(controller.progress,104);
 assert(events.some(e=>e.event===C.EVENT_TRANSFER)&&events.some(e=>e.event===C.EVENT_UPGRADE_CONTROLLER),'official dispatcher applies withdrawal and upgrade in the same tick');
 assert.equal(object.store.energy+box.store.energy,508-4,'same-tick work spends exactly the original four-WORK budget');
}
console.log('PASS: planned RCL5 source-to-hub, controller-first/link-full/cooldown fallbacks, hub-to-controller and hauler drain with no reverse refill; official processor confirms simultaneous withdraw and upgrade');
{
 const f=fixture(),box=f.structure(C.STRUCTURE_CONTAINER,'work-buffer',25,30,40),source=f.source('fallback-source',30,30);
 f.room.sites=[{id:'job',structureType:C.STRUCTURE_EXTENSION,pos:f.pos(25,32),progress:0}];
 const builder=f.creep('builder','builder',25,31,0,100);work(builder);assert.equal(builder.memory.workSupply.id,box.id);
 box.store[C.RESOURCE_ENERGY]=0;ctx.Game.time++;builder.actions.length=0;work(builder);
 assert.equal(builder.memory.workSupply.id,box.id,'a briefly depleted fixed work buffer retains its delivery binding');
 const carrier=f.creep('carrier','hauler',26,30,100,100,[C.CARRY,C.MOVE]);carrier.memory.loaded=true;
 assert.equal(haulTarget(carrier),box,'haulers can refill a temporarily empty construction buffer');
 assert(builder.actions.some(a=>a[0]==='harvest'),'the waiting builder may recover by self-harvest while delivery is pending');
 const remote=f.structure(C.STRUCTURE_CONTAINER,'backup-buffer',29,31,500);ctx.Game.time+=21;work(builder);
 assert.equal(builder.memory.workSupply.id,remote.id,'a prolonged outage rebinds to a reachable stocked fixed node');
}
console.log('PASS: empty construction buffers retain refill demand, self-harvest works while waiting, prolonged outages rebind');
// Reproduce the production overload with the pinned engine's real argument
// decoder and RoomPosition.getRangeTo implementation, not a permissive mock.
{
 const lodash=require(require.resolve('lodash',{paths:[engine]})),utilsSource=fs.readFileSync(engine+'/src/utils.js','utf8'),roomsSource=fs.readFileSync(engine+'/src/game/rooms.js','utf8');
 const utility={};let start=utilsSource.indexOf('exports.fetchXYArguments = function('),end=utilsSource.indexOf('\n};',start)+3;
 assert(start>=0&&end>start);vm.runInNewContext(utilsSource.slice(start,end),{exports:utility,_:lodash});
 class EnginePosition{constructor(x,y,roomName){Object.assign(this,{x,y,roomName});}}
 start=roomsSource.indexOf('RoomPosition.prototype.getRangeTo = register.wrapFn(');end=roomsSource.indexOf('\n    });',start)+8;
 assert(start>=0&&end>start);vm.runInNewContext(roomsSource.slice(start,end),{RoomPosition:EnginePosition,register:{wrapFn:fn=>fn},utils:utility,globals:{RoomPosition:EnginePosition},max:Math.max,abs:Math.abs});
 const controller={pos:new EnginePosition(16,21,'W21N26')},local={x:16,y:23},native=new EnginePosition(16,23,'W21N26'),other=new EnginePosition(16,23,'W22N26');
 assert(Number.isNaN(controller.pos.getRangeTo(local)),'official getRangeTo rejects plain plan coordinates');
 assert.equal(controller.pos.getRangeTo(16,23),2);assert.equal(controller.pos.getRangeTo(native),2);assert.equal(controller.pos.getRangeTo(other),Infinity);
 assert.equal(range(controller,local),2,'internal range normalizes the plain coordinates that failed online');
 assert.equal(range(local,controller),2);assert.equal(range(controller,native),2);assert.equal(range(controller,other),Infinity);
}
for(const planFile of ['fixtures/layout-plan-before.json','fixtures/layout-plan-reviewed.json']){
 const f=stationFixture(),plan=JSON.parse(readSource(planFile)),world=JSON.parse(readSource('fixtures/layout-world-before.json'));
 for(const s of world.structures)if(!f.room.objects.some(o=>o.id===s.id))f.structure(s.type,s.id,s.x,s.y,1000,1000);
 ctx.Memory.frontier.rooms[f.room.name].plan=plan;
 const station=controllerStation(f.room);assert(station,'full '+planFile+' must produce a real controller station');
 assert.equal(station.seats.length,4,'full '+planFile+' retains four legal worker seats');assert.deepEqual([station.port.x,station.port.y],[17,24]);
 const expected=plan.layoutRevision?['15,22','15,23','16,22','16,23']:['15,23','16,22','16,23','17,23'];
 assert.deepEqual(Array.from(station.seats,p=>p.x+','+p.y).sort(),expected,'station excludes the selected plan future buildings and roads');
 for(const c of f.ups)work(c);
 assert.equal(new Set(f.ups.map(c=>c.memory.upgradeSeat.x+','+c.memory.upgradeSeat.y)).size,4);
 const saved=ctx.Memory.frontier.rooms[f.room.name].upgradeStation;
 ctx.Game.time++;controllerStation(f.room);assert.equal(ctx.Memory.frontier.rooms[f.room.name].upgradeStation,saved,'valid full-plan seats use the existing bounded cache');
 f.box.store[C.RESOURCE_ENERGY]=10;const courier=f.haulers.find(c=>c.memory.loaded);assert.equal(haulTarget(courier),f.box,'low controller box becomes a fixed supply request under full '+planFile);
 assert(ctx.Memory.frontier.rooms[f.room.name].controllerSupply.active);assert(courier.memory.haulDelivery.amount>0);
}
console.log('PASS: strict and official RoomPosition overloads, local coordinate normalization, cross-room Infinity, full old/reviewed plans each produce four cached seats plus fixed low-water box demand');
// Shared development budget: tests exercise actual role actions and both
// caller orders, not only the eligibility predicates.
function sharingFixture(upWork=[4,4,4,4],buildWork=[1,1,1]){
 const f=pipelineFixture();f.room.energyAvailable=f.room.energyCapacityAvailable=800;
 for(const name of ['m1','m2'])ctx.Game.creeps[name].body.unshift(C.WORK);
 delete ctx.Game.creeps.upgrader;delete ctx.Game.creeps.builder;
 f.up=upWork.map((n,i)=>{const c=f.creep('up-'+i,'upgrader',15+i%3,22,100,100,[...Array(n).fill(C.WORK),C.CARRY,C.CARRY,C.MOVE]);c.memory.loaded=true;return c;});
 f.builders=buildWork.map((n,i)=>{const c=f.creep('builder-'+i,'builder',21,27+i,100,100,[...Array(n).fill(C.WORK),C.CARRY,C.CARRY,C.MOVE]);c.memory.loaded=true;return c;});
 f.control=updateEconomy(f.room);Object.assign(f.control,{target:2,buildEnergyTarget:13.5,developmentBudget:15.5});
 f.cycle=(count=1,order=[...f.up,...f.builders])=>{
  const totals={build:0,upgrade:0};
  for(let i=0;i<count;i++){
   ctx.Game.time++;f.control.at=ctx.Game.time;
   for(const c of [...f.up,...f.builders])c.actions.length=0;
   developmentPlan(f.room);for(const c of order)work(c);finishDevelopment(f.room);
   const d=ctx.Memory.frontier.rooms[f.room.name].development;
   totals.build+=d.buildIntentEnergy;totals.upgrade+=d.upgradeIntentEnergy;
   assert(d.credit>=-1e-8,'shared pool cannot be double-spent');
  }
  return totals;
 };
 return f;
}
for(const unavailable of ['travel','empty','refueling','spawning','yielding']){
 const f=sharingFixture();
 for(const c of f.builders){
  if(unavailable==='travel')c.pos=f.pos(35,35);
  if(unavailable==='empty')c.store[C.RESOURCE_ENERGY]=0;
  if(unavailable==='refueling'){c.memory.loaded=false;c.store[C.RESOURCE_ENERGY]=40;}
  if(unavailable==='spawning')c.spawning=true;
  if(unavailable==='yielding'){c.pos=f.pos(25,25);c.memory.yieldSource=f.a.id;}
 }
 // Match the production loop: spawning workers do not execute work().
 const actual=f.cycle(100,[...f.up,...f.builders.filter(c=>!c.spawning)]);
 assert.equal(actual.build,0,unavailable+' cannot reserve construction energy');
 assert(actual.upgrade>=1540&&actual.upgrade<=1550,unavailable+' lends the entire affordable pool to ready upgrades');
}
{
 const f=sharingFixture();f.builders[0].pos=f.pos(35,35);
 const use=f.cycle(100);
 assert(use.build>=980&&use.build<=1020,'two ready builders retain their realizable priority');
 assert(use.upgrade>500,'unrealizable construction quota reaches upgrading');
 assert(use.build+use.upgrade<=1550&&use.build+use.upgrade>=1540,'combined work consumes the pool within action rounding');
}
{
 const f=sharingFixture([4,4],[2,2]);Object.assign(f.control,{target:10,buildEnergyTarget:5.5});
 for(const c of f.up){c.pos=f.pos(35,35);c.upgradeController=()=>C.ERR_NOT_IN_RANGE;}
 const use=f.cycle(100,[...f.builders,...f.up]);
 assert.equal(use.upgrade,0);assert(use.build>=1530&&use.build<=1550,'construction borrows the unused upgrade share');
 assert(f.up.every(c=>c.actions.some(a=>a[0]==='move')),'borrowing must not stop idle upgraders from reaching the controller');
}
{
 const f=sharingFixture([4,4,4,4],[3,3]);f.room.sites[0].progress=f.room.sites[0].progressTotal-1;
 const use=f.cycle();assert.equal(use.build,1,'all builders together can consume only the remaining site energy');
 assert(use.upgrade>=12,'the almost-complete site cannot hoard a full construction allowance');
 assert(use.build+use.upgrade<=15.5);
}
{
 const f=sharingFixture([4,4,4,4],[3]);Object.assign(f.control,{target:2,buildEnergyTarget:14,developmentBudget:16});
 f.builders[0].build=()=>C.ERR_INVALID_TARGET;
 const use=f.cycle();assert.equal(use.build,0);assert.equal(use.upgrade,16,'failed build releases its grant to earlier-denied upgraders in the same tick');
}
{
 const f=sharingFixture([4,4],[3]);f.builders[0].store[C.RESOURCE_ENERGY]=1;
 const use=f.cycle();assert.equal(use.build,1,'a nearly empty loaded builder reserves only its fuel');assert.equal(use.upgrade,8);
}
{
 const f=sharingFixture([10,10],[]);f.room.controller.level=8;f.room.sites=[];Object.assign(f.control,{target:15,buildEnergyTarget:0,developmentBudget:20});
 const use=f.cycle(20);assert.equal(use.upgrade,300,'RCL8 sharing never exceeds the physical unboosted controller cap');
}
{
 const f=sharingFixture([4,4],[1]);f.room.sites=[];
 const old=f.control.target;ctx.Game.time+=100;const control=updateEconomy(f.room);
 assert.equal(control.target,old+2,'slow staffing transitions retain their normal cadence');
 assert(control.developmentBudget>control.target,'a staffing ramp must not strand the already affordable work allowance');
}
{
 const f=sharingFixture([4,4],[1]);
 const box=f.structure(C.STRUCTURE_CONTAINER,'loan-controller-box',16,23,200);
 f.creep('loan-carrier','hauler',17,24,100,100,[C.CARRY,C.CARRY,C.MOVE,C.MOVE]);
 const need=deliveryNeeds(f.room).find(n=>n.node===box);
 assert(need&&need.high>=460,'controller replenishment covers 8 WORK borrowing, rather than the 2/t floor');
}
console.log('PASS: shared budget lends both ways across travel/refuel/empty/spawn/yield, conserves total energy, clips fuel and site completion, releases failed actions in the same tick, preserves travel/RCL8/reserves and supplies borrowed work');

{
 const f=sharingFixture();const pioneer=f.creep('independent-pioneer','pioneer',21,28,100,100,[C.WORK,C.CARRY,C.MOVE]);pioneer.memory.loaded=true;
 assert.equal(buildAllowed(pioneer),true,'independent pioneer construction must retain its recovery policy in an owned room');
}

// Body/staffing regressions use the full reviewed plan and real local terrain.
const countPart=(b,p)=>b.filter(q=>(q.type||q)===p).length;
const bodyCost=b=>b.reduce((n,p)=>n+C.BODYPART_COST[p.type||p],0);
{
 const fixed=body('upgrader',800,{stationary:true}),mobile=body('upgrader',800),builder=body('builder',800);
 assert.deepEqual([countPart(fixed,C.WORK),countPart(fixed,C.CARRY),countPart(fixed,C.MOVE),bodyCost(fixed)],[6,2,2,800]);
 assert.deepEqual([countPart(mobile,C.WORK),countPart(mobile,C.CARRY),countPart(mobile,C.MOVE)],[5,2,4]);
 assert.deepEqual([countPart(builder,C.WORK),countPart(builder,C.CARRY),countPart(builder,C.MOVE),bodyCost(builder)],[3,4,4,700]);
 const f=fixture();f.structure(C.STRUCTURE_SPAWN,'spawn',21,28,300,300);
 assert(workerDuty(f.room,fixed,f.room.controller,true)>.98,'short one-time slower transit still leaves over 98% useful life');
 assert(workerDuty(f.room,fixed,f.room.controller,true)*6>workerDuty(f.room,mobile,f.room.controller,true)*5,'extra stationary WORK repays its slower one-time journey');
}
function capacityFixture(work=[4,4,1,1,1]){
 const f=stationFixture(),plan=JSON.parse(readSource('fixtures/layout-plan-reviewed.json')),world=JSON.parse(readSource('fixtures/layout-world-before.json'));
 ctx.global.frontierExpansion=null;
 for(const s of world.structures)if(!f.room.objects.some(o=>o.id===s.id))f.structure(s.type,s.id,s.x,s.y,1000,1000);
 ctx.Memory.frontier.rooms[f.room.name].plan=plan;
 for(const c of f.ups)delete ctx.Game.creeps[c.name];
 const station=controllerStation(f.room);
 f.ups=work.map((n,i)=>{const p=station.seats[i]||station.port,c=f.creep('capacity-'+i,'upgrader',p.x,p.y,50,100,[...Array(n).fill(C.WORK),C.CARRY,C.CARRY,C.MOVE,C.MOVE]);c.memory.loaded=true;return c;});
 const sp=f.room.find(C.FIND_MY_SPAWNS)[0];sp.spawnCreep=(body,name,options)=>{f.request={body,name,memory:options.memory};return C.OK;};
 delete ctx.Memory.frontier.rooms[f.room.name].economyControl;
 const control=updateEconomy(f.room);Object.assign(control,{target:8,buildEnergyTarget:0,usefulTarget:15.6,developmentBudget:15.6,carry:f.haulers.reduce((n,c)=>n+c.getActiveBodyparts(C.CARRY),0)});
 return Object.assign(f,{control,station});
}
{
 const f=capacityFixture(),roster=()=>Object.values(ctx.Game.creeps),demand=workforceDemand(f.room,f.control,roster());
 assert(demand.upgradeWork>=16,'slow 8/t priority share cannot strand a sustainable 15.6/t no-site pool');
 assert(demand.effectiveUp<10,'five bodies nominally11WORK provide only the top four seats, discounted for initial travel');
 assert(demand.upgrade,'a profitable 6WORK body may replace a small seat occupant without recycling it');
 spawnRoom(f.room);assert.equal(f.request.memory.role,'upgrader');assert.equal(countPart(f.request.body,C.WORK),6);
 assert.equal(f.control.target,8);assert.equal(f.control.developmentBudget,15.6,'staffing never enlarges the shared expenditure pool');
 const next=f.creep('capacity-new','upgrader',21,28,0,100,f.request.body);next.spawning=true;
 f.request=null;spawnRoom(f.room);assert.equal(f.request,null,'a pending larger occupant prevents repeated capacity births');
 assert(f.ups.every(c=>ctx.Game.creeps[c.name]===c),'capacity improvement never kills or recycles incumbents');
 next.spawning=false;next.pos=f.pos(16,24);for(const c of f.ups)work(c);work(next);
 assert(next.memory.upgradeSeat,'stronger arrived body displaces a small incumbent');
 const seated=roster().filter(c=>c.memory.upgradeSeat);
 assert.equal(seated.length,4);assert.equal(seated.reduce((n,c)=>n+c.getActiveBodyparts(C.WORK),0),15);
 assert.equal(new Set(seated.map(c=>c.memory.upgradeSeat.x+','+c.memory.upgradeSeat.y)).size,4);
}
{
 const f=capacityFixture(),c=f.ups[4];
 c.pos=f.pos(17,24);c.store[C.RESOURCE_ENERGY]=10;work(c);
 assert(!c.memory.upgradeSeat);assert(c.memory.upgradeParking,'the real reviewed layout has a safe overflow parking cell');
 assert(c.actions.some(a=>a[0]==='move'),'live-shaped no-seat upgrader must leave delivery port immediately');
 assert(!c.actions.some(a=>a[0]==='upgrade'||a[0]==='withdraw'),'port clearing takes precedence over holding the tile for work/refill');
 const parking={...c.memory.upgradeParking},plan=ctx.Memory.frontier.rooms[f.room.name].plan;
 assert(!plan.structures.some(s=>(s.type===C.STRUCTURE_ROAD||C.OBSTACLE_OBJECT_TYPES.includes(s.type))&&s.x===parking.x&&s.y===parking.y));
 assert(![[17,24],[16,24]].some(([x,y])=>parking.x===x&&parking.y===y));
 c.pos=f.pos(parking.x,parking.y);ctx.Game.time++;c.actions.length=0;work(c);
 assert(c.actions.some(a=>a[0]==='upgrade'));assert(!c.actions.some(a=>a[0]==='move'),'fueled overflow stays at its safe range-three parking cell');
 c.store[C.RESOURCE_ENERGY]=0;c.memory.refuelTarget={id:f.box.id,room:f.room.name,kind:'take',progress:ctx.Game.time};c.actions.length=0;ctx.Game.time++;work(c);
 assert(c.actions.some(a=>a[0]==='withdraw'&&a[1]!==f.box.id),'empty overflow uses source/core stock instead of returning to the fixed port');
 assert.notEqual(c.memory.refuelTarget?.id,f.box.id,'migration invalidates an old controller-box refuel target');
 const carrier=f.haulers.find(o=>o.store[C.RESOURCE_ENERGY]>0);carrier.pos=f.pos(17,24);carrier.transfer=()=>C.OK;carrier.memory.loaded=true;
 f.box.store[C.RESOURCE_ENERGY]=0;carrier.actions.length=0;haul(carrier);
 assert(carrier.actions.some(a=>a[0]==='move'),'courier can transfer then leave the unblocked port');
}
{
 const f=capacityFixture([6,6,4,4]);assert.equal(workforceDemand(f.room,f.control,Object.values(ctx.Game.creeps)).upgrade,false,'sufficient seat capacity does not buy redundant WORK');
 const dying=capacityFixture();for(const c of dying.ups)if(c.getActiveBodyparts(C.WORK)===1)c.ticksToLive=100;
 assert.equal(workforceDemand(dying.room,dying.control,Object.values(ctx.Game.creeps)).upgrade,false,'small remaining gain before normal replacement cannot repay an early body');
 const poor=capacityFixture();Object.assign(poor.control,{target:2,usefulTarget:3,developmentBudget:3});
 const demand=workforceDemand(poor.room,poor.control,Object.values(ctx.Game.creeps));
 assert(!demand.upgrade);assert(countPart(demand.upgradeBody,C.WORK)<=3,'low income cannot demand an800-energy discretionary upgrader');
 assert.equal(poor.control.developmentBudget,3,'trusted small/drawdown pool remains binding');
 const f2=capacityFixture();ctx.Game.creeps[Object.keys(ctx.Game.creeps).find(n=>ctx.Game.creeps[n].memory.role==='miner')].ticksToLive=80;
 spawnRoom(f2.room);assert.equal(f2.request.memory.role,'miner','critical miner renewal still outranks profitable seat improvement');
}
{
 const f=pipelineFixture();f.room.energyAvailable=f.room.energyCapacityAvailable=800;f.room.sites[0].pos=f.pos(22,32);
 const control=updateEconomy(f.room);Object.assign(control,{buildEnergyTarget:13,developmentBudget:15,usefulTarget:15});
 const roster=()=>Object.values(ctx.Game.creeps),demand=workforceDemand(f.room,control,roster());
 assert(demand.builderWork>Math.ceil(control.buildEnergyTarget/C.BUILD_POWER),'mobile construction demand includes refill/travel duty');
 assert(demand.effectiveBuild<15,'three nominal building WORK cannot be treated as continuous15/t with refills');
 assert(demand.build);assert(countPart(demand.builderBody,C.WORK)>=2,'a real sustained construction deficit gets a useful batched worker');
 f.room.sites[0].progress=f.room.sites[0].progressTotal-100;
 const finishing=workforceDemand(f.room,control,roster());assert(!finishing.build,'existing builders finish a tiny site before another birth could contribute');
 delete ctx.Game.creeps.builder;
 const tiny=workforceDemand(f.room,control,roster());assert(bodyCost(tiny.builderBody)<=300,'an unstaffed small road cannot create an unnecessary700-energy body');
 f.room.sites[0].progress=0;Object.assign(control,{buildEnergyTarget:2,developmentBudget:4,usefulTarget:4});
 const poor=workforceDemand(f.room,control,roster());assert(countPart(poor.builderBody,C.WORK)<=2,'low construction income sizes down future bodies');
}
console.log('PASS:800-energy stationary/mobile/builder bodies; lifespan and refill duty; seat-capacity demand, profitable replacement, pending suppression, real-plan port/approach clearing, retained incumbents, critical renewal, low-income and finishing-site protections');
