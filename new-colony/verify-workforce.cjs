'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm');
const {constants:C,loadGameModule}=require('./test-support/runtime.cjs');
const ctx={...C,console,Game:{time:1000,creeps:{},rooms:{},constructionSites:{},cpu:{limit:20,bucket:10000}},Memory:{frontier:{rooms:{}}},global:{}};
vm.createContext(ctx);
const workforce=loadGameModule(ctx,'workforce'),development=loadGameModule(ctx,'development'),colony=loadGameModule(ctx,'colony'),mining=loadGameModule(ctx,'mining');
function fixture({capacity=1300,energy=1300,spawnCount=1}={}) {
 ctx.Game.time++;ctx.Game.creeps={};ctx.Game.constructionSites={};ctx.Game.cpu={limit:20,bucket:10000};ctx.Memory.frontier={rooms:{},intel:{}};
 const objects=[],sites=[],actions=[],births=[];
 const room={name:'W1N1',objects,sites,energyCapacityAvailable:capacity,energyAvailable:energy,getTerrain:()=>({get:()=>0}),
  lookForAt(type,x,y){return(type===C.LOOK_CONSTRUCTION_SITES?sites:objects).filter(o=>o.pos.x===x&&o.pos.y===y);},
  find(type){return type===C.FIND_SOURCES?objects.filter(o=>o.source):type===C.FIND_MY_CREEPS?Object.values(ctx.Game.creeps):type===C.FIND_MY_SPAWNS?objects.filter(o=>o.structureType===C.STRUCTURE_SPAWN):type===C.FIND_MY_CONSTRUCTION_SITES?sites:type===C.FIND_STRUCTURES||type===C.FIND_MY_STRUCTURES?objects.filter(o=>o.structureType):[];},
  createConstructionSite(x,y,type,name){actions.push(['site',x,y,type,name]);return C.OK;}};
 class Position{constructor(x,y,name=room.name){this.x=x;this.y=y;this.roomName=name;}findClosestByPath(a){return a[0];}}
 ctx.RoomPosition=Position;const pos=(x,y)=>new Position(x,y);
 room.controller={my:true,level:4,pos:pos(10,10),ticksToDowngrade:10000};ctx.Game.rooms={[room.name]:room};
 const store=(n,cap=2000)=>({[C.RESOURCE_ENERGY]:n,getFreeCapacity(){return cap-this[C.RESOURCE_ENERGY];}});
 function structure(type,id,x,y,n=0,cap=2000){const node={id,my:true,structureType:type,pos:pos(x,y),room,store:store(n,cap),hits:250000,hitsMax:250000,ticksToDecay:100};objects.push(node);if(type===C.STRUCTURE_STORAGE)room.storage=node;return node;}
 function source(id,x,y){const node={id,source:true,pos:pos(x,y),energy:3000,energyCapacity:3000};objects.push(node);return node;}
 function creep(name,role,parts,x=20,y=20,n=50){const c={name,id:name,room,pos:pos(x,y),memory:{role,home:room.name},body:parts,ticksToLive:1400,store:store(n,500),
  getActiveBodyparts(t){return this.body.filter(p=>(p.type||p)===t).length;},moveTo(){actions.push(['move',name]);return C.OK;},
  repair(t){actions.push(['repair',name,t.id]);return C.OK;},build(t){actions.push(['build',name,t.id]);return C.OK;},upgradeController(){actions.push(['upgrade',name]);return C.OK;},
  transfer(t,r,a){actions.push(['transfer',name,t.id,a]);return C.OK;},withdraw(t,r,a){actions.push(['withdraw',name,t.id,a]);return C.OK;},pickup(){return C.OK;},harvest(t){actions.push(['harvest',name,t.id]);return C.OK;},drop(){return C.OK;}};
  ctx.Game.creeps[name]=c;return c;}
 const spawns=[];for(let n=0;n<spawnCount;n++){const sp=structure(C.STRUCTURE_SPAWN,'spawn'+n,20+n,20,300,300);sp.spawnCreep=(body,name,options)=>{births.push({spawn:sp.id,body,name,memory:options.memory});return C.OK;};spawns.push(sp);}
 ctx.Game.getObjectById=id=>objects.concat(sites).find(o=>o.id===id)||ctx.Game.creeps[id];
 return{room,objects,sites,actions,births,spawns,pos,store,structure,source,creep};
}
const minerBody=[C.WORK,C.WORK,C.WORK,C.WORK,C.WORK,C.CARRY,C.MOVE,C.MOVE,C.MOVE];
const workerBody=[C.WORK,C.CARRY,C.MOVE];
function stable(f,{up=true,builder=false}={}) {
 const src=f.source('source',25,25),m=f.creep('miner','miner',minerBody,24,24);m.memory.source=src.id;
 f.creep('haul','hauler',Array(25).fill(C.CARRY).concat(Array(25).fill(C.MOVE)));
 if(up)f.creep('up','upgrader',Array(15).fill(C.WORK).concat(C.CARRY,C.MOVE),10,11);
 if(builder)f.creep('builder','builder',workerBody,10,12);
 f.structure(C.STRUCTURE_STORAGE,'storage',21,21,20000,1000000);return m;
}
function request(f,id,priority=200,body=workerBody){return{id,owner:'mission:test',slotKey:id,home:f.room.name,role:'pioneer',body,memory:{operationId:'test'},priority,neededAt:ctx.Game.time+100,expiresAt:ctx.Game.time+5000,reason:'test-request'};}
{
 const f=fixture({energy:200});stable(f,{up:false,builder:true});ctx.Game.cpu.bucket=1;ctx.Memory.frontier.performance={mean:30};
 workforce.spawnRoom(f.room);assert.equal(f.births[0].memory.role,'upgrader','W005: builder cannot hide missing controller WORK under CPU recovery');
 assert.equal(f.births[0].body.reduce((n,p)=>n+C.BODYPART_COST[p],0),200,'essential missing role uses available recovery energy');
 assert.equal(ctx.Memory.frontier.rooms[f.room.name].colonyPolicy.cpuMode,'recovery');
}
{
 const f=fixture();stable(f);f.sites.push({id:'site',pos:f.pos(12,12),structureType:C.STRUCTURE_EXTENSION,progress:0,progressTotal:3000});
 ctx.Game.cpu.bucket=1;ctx.Memory.frontier.performance={mean:30};workforce.spawnRoom(f.room);
 assert.equal(f.births[0].memory.role,'builder','W005: existing upgrader cannot hide missing builder capacity under CPU recovery');
}
{
 const f=fixture({spawnCount:2,energy:300});stable(f);const a=request(f,'a',5000),b=request(f,'b',5000);
 workforce.spawnRoom(f.room,[a,{...a,id:'duplicate'},b]);assert.equal(f.births.length,1);assert.equal(f.births[0].memory.spawnSlot,'a');
 assert.equal(f.births[0].memory.birthRoom,f.room.name);assert.equal(f.births[0].memory.bornAt,ctx.Game.time);
 workforce.spawnRoom(f.room,[a,b]);assert.equal(f.births.length,1,'same-tick repeated entry cannot overwrite successful spawn or spend initial energy twice');
 ctx.Game.time++;f.room.energyAvailable=400;workforce.spawnRoom(f.room,[a,b]);
 assert.equal(f.births.length,3,'unconfirmed prior intent is released; two spawns use exactly400 shared energy');
 assert.equal(new Set(f.births.slice(1).map(b=>b.memory.spawnSlot)).size,2,'owner-slot duplicate never consumes a second spawn');
 const pending=ctx.Memory.frontier.rooms[f.room.name].workforce.pending;assert.equal(Object.keys(pending).length,2);
 for(const born of f.births.slice(1)){const c=f.creep(born.name,born.memory.role,born.body);c.memory=born.memory;c.spawning=true;}
 ctx.Game.time++;workforce.spawnRoom(f.room,[a,b]);assert.equal(f.births.length,3,'observed births suppress repeated demand');assert.equal(Object.keys(pending).length,0,'observed creep reconciles pending intent');
}
{
 const f=fixture({spawnCount:2,energy:400});stable(f);const a=request(f,'a',5000);
 workforce.spawnRoom(f.room,[a]);const born=f.births[0],sp=f.spawns[0];sp.spawning={name:born.name,remainingTime:8};
 ctx.Game.time++;workforce.spawnRoom(f.room,[a]);assert.equal(f.births.length,1,'real spawn work survives missing creep object without duplicating into second spawn');
 assert.equal(Object.values(ctx.Memory.frontier.rooms[f.room.name].workforce.pending)[0].status,'observed-spawning');
 // A lost demand cancels waiting state; actual in-progress birth remains factual.
 const wait=ctx.Memory.frontier.rooms[f.room.name].workforce.waiting;wait['cancelled|slot']={since:0};workforce.spawnRoom(f.room,[]);assert.equal(wait['cancelled|slot'],undefined);
}
{
 const f=fixture({energy:0});stable(f);const old=request(f,'old',200);workforce.spawnRoom(f.room,[old]);
 ctx.Game.time+=1000;f.room.energyAvailable=200;workforce.spawnRoom(f.room,[old,request(f,'fresh',400)]);
 assert.equal(f.births[0].memory.spawnSlot,'old','aging eventually serves a low-cost optional job ahead of fresh optional work');
}
{
 const f=fixture({capacity:800,energy:800,spawnCount:2}),a=f.source('a',25,25),b=f.source('b',35,35);
 const oldA=f.creep('old-a','miner',minerBody,24,24),oldB=f.creep('old-b','miner',minerBody,34,34);oldA.memory.source=a.id;oldB.memory.source=b.id;oldA.ticksToLive=oldB.ticksToLive=50;
 f.creep('haul','hauler',Array(25).fill(C.CARRY).concat(C.MOVE));f.creep('up','upgrader',Array(15).fill(C.WORK).concat(C.CARRY,C.MOVE),10,11);
 const ops=mining.operations(f.room);assert.equal(ops[0].activeWork,5);assert.equal(ops[0].futureWork,0);
 const needs=mining.replacementNeeds(f.room,Object.values(ctx.Game.creeps),minerBody,20);assert.equal(needs.length,2);assert(needs.every(n=>n.latestStart<ctx.Game.time));
 workforce.spawnRoom(f.room);assert.equal(f.births.length,1,'800 energy can fund only one700 miner across two spawns');assert(f.births[0].memory.replaces);
 const born=f.births[0],c=f.creep(born.name,'miner',born.body,20,20);c.memory=born.memory;c.spawning=true;ctx.Game.time++;f.room.energyAvailable=800;
 workforce.spawnRoom(f.room);assert.equal(f.births.length,2);assert.notEqual(f.births[1].memory.source,born.memory.source,'second source renewal is not shadowed by first pending successor');
}
{
 const f=fixture();stable(f,{builder:true});const box=f.structure(C.STRUCTURE_CONTAINER,'controller-buffer',10,12,1000);box.hits=1000;box.ticksToDecay=1;
 f.sites.push({id:'permanent-site',pos:f.pos(11,12),structureType:C.STRUCTURE_EXTENSION,progress:0,progressTotal:100000});
 const builder=ctx.Game.creeps.builder;for(let i=0;i<5;i++){ctx.Game.time++;development.work(builder);box.hits+=100;}
 assert.equal(f.actions.filter(a=>a[0]==='repair'&&a[2]===box.id).length,5,'R001: controller-buffer maintenance cannot starve behind persistent construction');
 assert.equal(f.actions.filter(a=>a[0]==='build').length,0);assert(development.criticalRepairs(f.room)[0].deadline>ctx.Game.time);
}
{
 const f=fixture();stable(f);const first=colony.updateEconomy(f.room);ctx.Game.time++;assert.equal(colony.updateEconomy(f.room).at,first.at,'ordinary tick retains policy planning interval');
 delete ctx.Game.creeps.miner;ctx.Game.time++;const failed=colony.updateEconomy(f.room);assert.equal(failed.at,ctx.Game.time);assert.equal(failed.phase,'recovery','miner loss bypasses100-tick economic cache');
 f.sites.push({id:'new-site',pos:f.pos(12,12),structureType:C.STRUCTURE_EXTENSION,progress:0,progressTotal:3000});ctx.Game.time++;assert.equal(colony.updateEconomy(f.room).at,ctx.Game.time,'critical new construction bypasses100-tick cache');
 f.sites.length=0;ctx.Game.time++;assert.equal(colony.updateEconomy(f.room).at,ctx.Game.time,'construction completion immediately reassigns growth budget');
}
{
 const f=fixture();f.room.controller.level=2;
 const requests=Array.from({length:8},(_,i)=>({id:'extension'+i,owner:'planner',x:30+i,y:30,structureType:C.STRUCTURE_EXTENSION,minRCL:2}));
 requests.push({id:'forbidden',owner:'mission',x:35,y:35,structureType:C.STRUCTURE_RAMPART,priority:1000},
  {id:'dependency',owner:'planner',x:38,y:38,structureType:C.STRUCTURE_CONTAINER,dependencies:['missing']},
  {id:'overlap',owner:'planner',x:20,y:20,structureType:C.STRUCTURE_CONTAINER});
 const result=development.runConstruction(f.room,requests);assert.equal(result.accepted,5,'controller quota permits exactly five RCL2 extensions');assert.equal(result.rejected['rampart-disabled'],1);assert.equal(result.rejected.dependency,1);assert.equal(result.rejected['structure-conflict'],1);
 ctx.Game.time++;ctx.Game.constructionSites=Object.fromEntries(Array.from({length:C.MAX_CONSTRUCTION_SITES},(_,i)=>['site'+i,{pos:{x:i%50,y:1,roomName:'W9N9'},structureType:C.STRUCTURE_ROAD}]));
 const capped=development.runConstruction(f.room,[{id:'cap',x:30,y:40,structureType:C.STRUCTURE_CONTAINER}]);assert.equal(capped.accepted,0);assert.equal(capped.rejected['global-site-cap'],1);
}
{
 const f=fixture();stable(f);const old=ctx.Game.creeps.haul;old.body=[C.CARRY,C.MOVE];old.ticksToLive=60;
 const control=colony.updateEconomy(f.room),renewals=workforce.workerRenewals(f.room,Object.values(ctx.Game.creeps),control);
 assert(old.ticksToLive>old.body.length*C.CREEP_SPAWN_TIME+35,'small predecessor is still alive by the former generic rule');
 assert(renewals.some(r=>r.role==='hauler'&&r.memory.replaces===old.name&&r.essential),'newbody/travel deadline renews missing future transport capacity');
 workforce.spawnRoom(f.room);assert.equal(f.births[0].memory.replaces,old.name);
 const born=f.births[0],next=f.creep(born.name,born.memory.role,born.body);next.memory=born.memory;next.spawning=true;ctx.Game.time++;
 workforce.spawnRoom(f.room);assert.equal(f.births.filter(b=>b.memory.role==='hauler').length,1,'observed in-flight successor prevents second hauler renewal');
}
for(const role of ['upgrader','builder']){
 const f=fixture();stable(f,{builder:role==='builder'});const old=ctx.Game.creeps[role==='builder'?'builder':'up'];old.body=[C.WORK,C.WORK,C.CARRY,C.MOVE];old.ticksToLive=50;
 if(role==='builder')f.sites.push({id:'long-project',pos:f.pos(12,12),structureType:C.STRUCTURE_EXTENSION,progress:0,progressTotal:100000});
 const control=colony.updateEconomy(f.room);Object.assign(control,{target:10,buildEnergyTarget:15,usefulTarget:20,developmentBudget:20});
 const renewals=workforce.workerRenewals(f.room,Object.values(ctx.Game.creeps),control);
 assert(renewals.some(r=>r.role===role&&r.memory.replaces===old.name&&r.essential),role+' replacement includes proposed body, initial journey and spawn queue');
}
{
 const f=fixture();stable(f,{builder:true});const a=ctx.Game.creeps.builder,b=f.creep('builder-b','builder',workerBody,11,12);
 f.sites.push({id:'finishing',pos:f.pos(11,12),structureType:C.STRUCTURE_EXTENSION,progress:2998,progressTotal:3000},
  {id:'next',pos:f.pos(12,12),structureType:C.STRUCTURE_EXTENSION,progress:0,progressTotal:3000});
 development.developmentPlan(f.room);development.work(a);development.work(b);
 assert.equal(f.actions.filter(a=>a[0]==='build'&&a[2]==='finishing').length,1,'remaining2work is reserved only once');
 assert.equal(f.actions.filter(a=>a[0]==='build'&&a[2]==='next').length,1,'second fueled worker builds another useful site without idling');
 const box=f.structure(C.STRUCTURE_CONTAINER,'critical',10,12,1000);box.hits=1000;f.room.controller.ticksToDowngrade=100;ctx.Game.time++;f.actions.length=0;
 development.work(a);assert(f.actions.some(a=>a[0]==='upgrade'),'controller downgrade emergency remains above buffer maintenance');assert(!f.actions.some(a=>a[0]==='repair'));
}
{
 const f=fixture({capacity:800,energy:600});stable(f);
 const expensive={...request(f,'urgent',1000,minerBody),essential:true,latestStart:ctx.Game.time-1};
 const later={...request(f,'later',1000),essential:true,latestStart:ctx.Game.time+50};
 workforce.spawnRoom(f.room,[expensive,later]);assert.equal(f.births.length,0,'equal-priority later job cannot drain funds reserved for earlier essential deadline');
 assert.equal(ctx.Memory.frontier.rooms[f.room.name].workforce.waiting['mission:test|later'].reason,'critical-deadline-reservation');
}
{
 const f=fixture();stable(f);ctx.Memory.frontier.expansion={home:f.room.name,state:'bootstrapping'};
 assert.equal(colony.updateEconomy(f.room).reserveRate,3,'active mission has the existing support reserve');
 for(const state of ['cancelled','aborting']){ctx.Game.time++;ctx.Memory.frontier.expansion.state=state;
  const result=colony.updateEconomy(f.room);assert.equal(result.baseMode,'growth',state+' releases mother growth policy');assert.equal(result.reserveRate,0,state+' releases mission reserve rate');}
}
{
 vm.runInContext("globalThis.__bodyFills=0;globalThis.__originalFill=Array.prototype.fill;Array.prototype.fill=function(...args){++globalThis.__bodyFills;return globalThis.__originalFill.apply(this,args);}",ctx);
 try{
  workforce.body('upgrader',800);workforce.body('builder',1800);
  assert.equal(ctx.__bodyFills,6,'two body choices allocate only their six final part arrays, not unaffordable candidates');
  const f=fixture();stable(f);const control=colony.updateEconomy(f.room),all=Object.values(ctx.Game.creeps);
  workforce.workforceDemand(f.room,control,all);ctx.__bodyFills=0;
  workforce.workforceDemand(f.room,control,all.slice());assert.equal(ctx.__bodyFills,0,'identical duty/body candidates are reused for same-tick demand projections');
  const sp=f.spawns[0];sp.spawning={name:'existing-birth',remainingTime:30};
  workforce.spawnRoom(f.room,[request(f,'external-busy')]);const first=ctx.Memory.frontier.rooms[f.room.name].workforce.planningTick;
  function advance(){ctx.Game.time++;sp.spawning.remainingTime--;for(const c of Object.values(ctx.Game.creeps))if(!c.spawning)c.ticksToLive--;}
  advance();ctx.__bodyFills=0;workforce.spawnRoom(f.room,[]);
  const state=ctx.Memory.frontier.rooms[f.room.name].workforce;
  assert.equal(state.planningTick,first);assert.equal(state.planReused,true);assert.equal(ctx.__bodyFills,0,'busy unchanged room performs no body search');
  assert.equal(state.tick,ctx.Game.time,'busy fast path still updates request status');
  assert(!state.queued.some(r=>r.owner==='mission:test'),'cancelled external demand disappears even on reused internal plan');
  advance();delete ctx.Game.creeps.miner;workforce.spawnRoom(f.room,[]);
  assert.equal(state.planReused,false);assert.equal(state.planningTick,ctx.Game.time,'missing source role invalidates busy cache immediately');
  assert(state.queued.some(r=>r.essential&&r.role==='miner'),'busy room still publishes critical source recovery');
  advance();sp.spawning=null;workforce.spawnRoom(f.room,[]);assert.equal(state.planReused,false);assert(f.births.length,'free spawn recomputes and services a protected request');
 }finally{vm.runInContext('Array.prototype.fill=globalThis.__originalFill;delete globalThis.__originalFill;',ctx);}
}
{
 const f=fixture();stable(f);let scans=0;const original=mining.operations;
 mining.operations=(...args)=>{scans++;return original(...args);};
 try{workforce.spawnRoom(f.room);assert.equal(scans,1,'source operations are built once and shared by renewal/capacity/payback paths');}finally{mining.operations=original;}
}
console.log('PASS workforce: distinct-role CPU recovery, shared-energy multi-spawn/dedup, accepted versus observed birth reconciliation, cancellation, aging, dual-source renewals, critical-buffer repair, event-driven economy, centralized construction constraints, consumer timelines, remaining-work redirection and bounded planning allocation/cache paths');
