'use strict';
// Independent behavior checks against real main.js; no game API or source edits.
const assert=require('node:assert/strict'),vm=require('node:vm');
const {constants:C,readSource}=require('../test-support/runtime.cjs');
const ctx={...C,module:{exports:{}},console,Game:{time:1,creeps:{}},Memory:{},global:{}};
vm.createContext(ctx);vm.runInContext(readSource('main.js')+'\nmodule.exports.audit={body,work,updateEconomy,workforceDemand,spawnRoom,refuel,collectHaul,haulTarget,links};',ctx);
const policy=ctx.module.exports.audit,cost=b=>b.reduce((n,p)=>n+C.BODYPART_COST[p],0),parts=(b,p)=>b.filter(x=>x===p).length;
for(const budget of [200,800,1300,2300,5600])for(const role of ['hauler','upgrader','builder']){
 const b=policy.body(role,budget);assert(b&&b.length<=50);assert(cost(b)<=budget);assert(parts(b,C.MOVE)>0);
}
assert.equal(parts(policy.body('hauler',1300),C.CARRY),13,'1300-energy hauling demand can exceed old 8 CARRY cap');
assert.equal(parts(policy.body('hauler',5600),C.CARRY),25,'single hauler is bounded by engine 50 parts');
assert(parts(policy.body('upgrader',5600,{stationary:true}),C.WORK)>10,'worker can exceed arbitrary 10 WORK cap');
for(const role of ['builder','upgrader'])assert(parts(policy.body(role,5600,{stationary:true,workLimit:2}),C.WORK)<=2,'small actual WORK requirement remains small');
function fixture(){
 ctx.Game.time+=1000;ctx.Game.creeps={};ctx.Memory={frontier:{rooms:{},intel:{}}};
 const room={name:'audit',objects:[],sites:[],energyAvailable:3000,energyCapacityAvailable:3000,
  controller:{my:true,level:4,ticksToDowngrade:20000,pos:{x:20,y:20,roomName:'audit'}},
  getTerrain:()=>({get:()=>0}),lookForAt(type,x,y){return this.objects.filter(o=>o.structureType&&o.pos.x===x&&o.pos.y===y);},
  find(type,opt){const a=type===C.FIND_SOURCES?this.objects.filter(o=>o.source):type===C.FIND_STRUCTURES||type===C.FIND_MY_STRUCTURES?this.objects.filter(o=>o.structureType):type===C.FIND_MY_SPAWNS?this.objects.filter(o=>o.structureType===C.STRUCTURE_SPAWN):type===C.FIND_MY_CONSTRUCTION_SITES?this.sites:type===C.FIND_MY_CREEPS?Object.values(ctx.Game.creeps):[];return opt&&opt.filter?a.filter(opt.filter):a;}};
 const pos=(x,y)=>({x,y,roomName:room.name,findClosestByPath:a=>a[0]||null}),store=(n,capacity)=>({energy:n,getFreeCapacity(){return capacity-this.energy;}});
 function structure(type,id,x,y,n=0,capacity=2000){const o={id,structureType:type,my:true,pos:pos(x,y),hits:1000,hitsMax:1000,store:store(n,capacity)};room.objects.push(o);return o;}
 room.storage=structure(C.STRUCTURE_STORAGE,'store',24,24,10000,100000);
 const spawn=structure(C.STRUCTURE_SPAWN,'spawn',25,25,300,300);spawn.spawnCreep=(body,name,options)=>{room.spawned={body,name,...options};return C.OK;};
 function creep(name,role,body,n=0){const actions=[],c={name,pos:pos(21,21),room,memory:{role,home:room.name,loaded:n>0},body,ticksToLive:1400,store:store(n,100),actions,getActiveBodyparts:p=>parts(body,p),build:t=>{actions.push('build');return C.OK;},repair:t=>{actions.push('repair');return C.OK;},upgradeController:()=>{actions.push('upgrade');return C.OK;},transfer:()=>{actions.push('transfer');return C.OK;},withdraw:()=>{actions.push('withdraw');return C.OK;},moveTo:()=>{actions.push('move');return C.OK;}};ctx.Game.creeps[name]=c;return c;}
 ctx.Game.rooms={[room.name]:room};ctx.Game.getObjectById=id=>room.objects.find(o=>o.id===id);
 return {room,pos,store,structure,creep};
}
{
 const f=fixture(),b=f.creep('finished','builder',[C.WORK,C.CARRY,C.MOVE],100);
 policy.work(b);assert.equal(b.memory.role,'upgrader','storage must not divert a finished builder permanently into hauling');
 ctx.Game.time++;policy.work(b);assert(b.actions.includes('upgrade'),'converted builder executes available upgrade work');
}
for(const job of ['site','repair']){
 const f=fixture(),b=f.creep('busy','builder',[C.WORK,C.CARRY,C.MOVE],100);
 if(job==='site')f.room.sites.push({id:'job',my:true,pos:f.pos(22,22),structureType:C.STRUCTURE_EXTENSION,progress:0,progressTotal:3000});
 else f.structure(C.STRUCTURE_ROAD,'road',22,22).hits=100;
 policy.work(b);assert.equal(b.memory.role,'builder',job+' retains builder role');assert(b.actions.includes(job==='site'?'build':'repair'),job+' remains executable before reassignment');
}
{
 const f=fixture(),m=ctx.Memory.frontier.rooms[f.room.name]={plan:{roadRoutes:[]}};
 for(let i=0;i<2;i++){
  const source={id:'source'+i,source:true,pos:f.pos(5+i*30,5),energy:3000,energyCapacity:3000};f.room.objects.push(source);
  m.plan.roadRoutes.push({id:'source:'+source.id,sourceId:source.id,complete:true,tiles:Array(100).fill(10)});
  const miner=f.creep('miner'+i,'miner',[...Array(5).fill(C.WORK),C.CARRY,C.MOVE]);miner.memory.source=source.id;miner.pos=f.pos(source.pos.x+1,source.pos.y);
 }
 f.creep('hauler','hauler',[C.CARRY,C.CARRY,C.MOVE,C.MOVE]);f.creep('upgrader','upgrader',[C.WORK,C.CARRY,C.MOVE]);
 const control=policy.updateEconomy(f.room);assert(control.rawCarry>36&&control.carry>36,'long route room demand is not clipped to 36 total CARRY');
 policy.spawnRoom(f.room);assert.equal(f.room.spawned.memory.role,'hauler');assert(cost(f.room.spawned.body)>1000,'spawn budget follows room capacity and genuine CARRY shortage');assert(f.room.spawned.body.length<=50);
 m.economyControl.carry=3;policy.spawnRoom(f.room);assert.equal(f.room.spawned.memory.role,'hauler');assert(cost(f.room.spawned.body)<=200,'one-part CARRY shortage does not trigger a room-sized body');
 const demand=policy.workforceDemand(f.room,{usefulTarget:20,developmentBudget:20,target:20,buildEnergyTarget:0},Object.values(ctx.Game.creeps));assert(cost(demand.upgradeBody)>1000,'workforce body budget also follows room capacity');
}
{
 const f=fixture();f.room.storage.store.energy=0;
 const source={id:'small-source',source:true,pos:f.pos(30,30),energy:0};f.room.objects.push(source);
 f.structure(C.STRUCTURE_CONTAINER,'small-stock',29,30,19,2000);
 const c=f.creep('small-worker','builder',[C.WORK,C.CARRY,C.MOVE]);c.pos=f.pos(28,30);
 assert(policy.refuel(c,false),'worker can use sole 19 energy stock');assert(c.actions.includes('withdraw'));
 const h=f.creep('small-hauler','hauler',[C.CARRY,C.MOVE]);h.pos=f.pos(28,30);
 assert(policy.collectHaul(h),'hauler can collect sole 19 energy source stock');assert(h.actions.includes('withdraw'));
}
{
 const f=fixture(),box=f.structure(C.STRUCTURE_CONTAINER,'controller-box',22,22,1981,2000);
 const h=f.creep('small-gap','hauler',[C.CARRY,C.CARRY,C.MOVE,C.MOVE],100);
 assert.equal(policy.haulTarget(h).id,box.id,'19 energy controller gap receives a delivery without arbitrary batch floor');assert.equal(h.memory.haulDelivery.amount,19);
}
for(const n of [1,50]){
 const f=fixture(),from=f.structure(C.STRUCTURE_LINK,'from',30,30,n,800),to=f.structure(C.STRUCTURE_LINK,'to',22,22,0,800);
 ctx.Memory.frontier.rooms[f.room.name]={plan:{structures:[{type:C.STRUCTURE_LINK,x:30,y:30,tag:'source-link-1'},{type:C.STRUCTURE_LINK,x:22,y:22,tag:'controller-link'}]}};
 let sent=0;from.transferEnergy=(target,amount)=>{assert.equal(target,to);sent=amount;return C.OK;};
 policy.links(f.room);assert.equal(sent,n===1?0:50,'link sends useful small batch but avoids zero-net transfer');
}
console.log('PASS: independent policy audit — physical/need-based bodies, long-route hauling demand, completed builder reassigns while real jobs retain priority');
