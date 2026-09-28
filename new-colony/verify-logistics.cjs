'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm');
const {constants:C,loadGameModule}=require('./test-support/runtime.cjs');
// Quantities settle only at the next tick, with optional rejected intents.
// This separates accepted commands from measured cargo and destination stores.
function fixture(){
 const room={name:'W21N26',objects:[],walls:new Set(),sites:[],station:null,memory:{plan:{structures:[]}},controller:{my:true,level:4},
  getTerrain(){return{get:(x,y)=>this.walls.has(x+50*y)?C.TERRAIN_MASK_WALL:0};},
  lookForAt(type,x,y){return this.objects.filter(o=>o.structureType&&o.pos.x===x&&o.pos.y===y);},
  find(type){return type===C.FIND_STRUCTURES?this.objects.filter(o=>o.structureType):type===C.FIND_SOURCES?this.objects.filter(o=>o.isSource):
   type===C.FIND_DROPPED_RESOURCES?this.objects.filter(o=>o.resourceType):type===C.FIND_TOMBSTONES?this.objects.filter(o=>o.tombstone):
   type===C.FIND_RUINS?this.objects.filter(o=>o.ruin):type===C.FIND_MY_CREEPS?Object.values(ctx.Game.creeps):[];}};
 const ctx={...C,console,Game:{time:1,creeps:{},rooms:{[room.name]:room}},Memory:{},global:{},gameModuleOverrides:{}};
 const distance=(a,b)=>{a=a.pos||a;b=b.pos||b;return Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));};
 class Position{
  constructor(x,y,roomName=room.name){Object.assign(this,{x,y,roomName});}
  getRangeTo(p,y){return typeof y==='number'?distance(this,{x:p,y}):distance(this,p);}
  findPathTo(target,options={}){
   target=target.pos||target;const blocked=new Set(),key=p=>p.x+50*p.y;
   if(options.costCallback)options.costCallback(room.name,{set(x,y,n){if(n===255)blocked.add(x+50*y);}});
   const q=[{x:this.x,y:this.y,path:[]}],seen=new Set([key(this)]);
   for(let i=0;i<q.length&&i<(options.maxOps||2500);i++){
    const p=q[i];if(distance(p,target)<=(options.range||0))return p.path;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
     const n={x:p.x+dx,y:p.y+dy},k=key(n);if(seen.has(k))continue;seen.add(k);
     if(n.x<1||n.x>48||n.y<1||n.y>48||room.walls.has(k)||blocked.has(k)||
      room.objects.some(o=>distance(o,n)===0&&(o.isSource||C.OBSTACLE_OBJECT_TYPES.includes(o.structureType)))||
      options.ignoreCreeps===false&&Object.values(ctx.Game.creeps).some(c=>distance(c,n)===0))continue;
     q.push({...n,path:p.path.concat(n)});
    }
   }return[];
  }
  findClosestByPath(list){return list.filter(o=>distance(this,o)<=1||this.findPathTo(o,{range:1}).length).sort((a,b)=>distance(this,a)-distance(this,b))[0]||null;}
 }
 ctx.RoomPosition=Position;room.controller.pos=new Position(45,45);
 ctx.Game.getObjectById=id=>room.objects.find(o=>o.id===id)||Object.values(ctx.Game.creeps).find(c=>c.id===id);
 ctx.gameModuleOverrides={metrics:{movementCount(){}},infrastructure:{linkNetwork:()=>({hub:room.hub})},
  movement:{go(c,target,r=1,options={}){if(c.fatigue)return C.ERR_TIRED;return c.moveTo(target.pos||target,{range:r,...options});}},
  development:{controllerStation:()=>room.station,upgraderAssignment:()=>({primary:[],policy:{target:0}}),economyMemory:()=>room.memory,
   routeTravel:()=>10,constructionJobs:()=>room.sites,walkable(r,p){return p.x>=1&&p.x<=48&&p.y>=1&&p.y<=48&&!room.walls.has(p.x+50*p.y)&&
    !room.objects.some(o=>distance(o,p)===0&&(o.isSource||C.OBSTACLE_OBJECT_TYPES.includes(o.structureType)));}}};
 vm.createContext(ctx);let logistics=loadGameModule(ctx,'logistics'),runtime=loadGameModule(ctx,'runtime');
 function store(n,capacity){return{[C.RESOURCE_ENERGY]:n,getFreeCapacity(){return capacity-this[C.RESOURCE_ENERGY];}};}
 function node(type,id,x,y,n=0,capacity=2000){const o={id,my:true,structureType:type,pos:new Position(x,y),store:store(n,capacity)};room.objects.push(o);if(type===C.STRUCTURE_STORAGE)room.storage=o;return o;}
 function source(id,x,y){const o={id,isSource:true,pos:new Position(x,y),energy:3000};room.objects.push(o);return o;}
 function box(id,x,y,n=100,capacity=2000){source(id+'-source',x,y+1);return node(C.STRUCTURE_CONTAINER,id,x,y,n,capacity);}
 function drop(id,x,y,n){const o={id,pos:new Position(x,y),resourceType:C.RESOURCE_ENERGY,amount:n};room.objects.push(o);return o;}
 function station(id='controller-box',x=20,y=20,n=0,capacity=2000){const o=node(C.STRUCTURE_CONTAINER,id,x,y,n,capacity);room.station={node:o,nodes:[o],seats:[],port:{x:x+1,y}};return o;}
 function creep(name,x,y,n=0,capacity=100){
  const c={id:name,name,my:true,room,pos:new Position(x,y),memory:{role:'hauler',home:room.name},store:store(n,capacity),actions:[],fatigue:0,
   getActiveBodyparts(){return 0;},moveTo(target,options={}){this.actions.push({kind:'move',target,options});this.move={target,options};return C.OK;},
   withdraw(target,res,amount){return action(this,'pickup',target,amount);},pickup(target){return action(this,'pickup',target,Math.min(target.amount,this.store.getFreeCapacity()));},
   transfer(target,res,amount){return action(this,'deliver',target,amount);}};
  ctx.Game.creeps={...ctx.Game.creeps,[name]:c};return c;
 }
 function value(o){return o.store?o.store[C.RESOURCE_ENERGY]:o.amount;}
 function action(c,kind,target,amount){
  if(distance(c,target)>1)return C.ERR_NOT_IN_RANGE;
  if(!(amount>0))return C.ERR_INVALID_ARGS;
  if(kind==='pickup'&&!value(target))return C.ERR_NOT_ENOUGH_RESOURCES;
  if(kind==='deliver'&&!target.store.getFreeCapacity())return C.ERR_FULL;
  c.actions.push({kind,target:target.id,amount});c.intent={kind,target,amount};return C.OK;
 }
 function settle(reject=[]){
  for(const c of Object.values(ctx.Game.creeps)){
   const i=c.intent;if(i&&!reject.includes(c.name)&&room.objects.includes(i.target)){
    const from=i.kind==='pickup'?i.target:c,to=i.kind==='pickup'?c:i.target,amount=Math.min(i.amount,value(from),to.store.getFreeCapacity());
    if(from.store)from.store[C.RESOURCE_ENERGY]-=amount;else from.amount-=amount;
    to.store[C.RESOURCE_ENERGY]+=amount;
   }delete c.intent;
  }
  for(const c of Object.values(ctx.Game.creeps)){
   if(c.move&&!c.fatigue){const path=c.pos.findPathTo(c.move.target,{...c.move.options,ignoreCreeps:true});if(path[0])c.pos=new Position(path[0].x,path[0].y);}
   delete c.move;
  }
  ctx.Game.time++;
 }
 function task(c,target,sourceId,amount,state='pickup'){
  c.memory.haul={state,task:{id:target.id,source:sourceId,room:room.name,amount,pickupAmount:Math.max(0,amount-value(c)),priority:4,
   expires:ctx.Game.time+200,progress:ctx.Game.time,position:c.pos.x+','+c.pos.y}};return c.memory.haul.task;
 }
 return{ctx,room,node,source,box,drop,station,creep,task,settle,value,Position,
  get logistics(){return logistics;},get runtime(){return runtime;},reset(){delete ctx.__gameModuleCache;logistics=loadGameModule(ctx,'logistics');runtime=loadGameModule(ctx,'runtime');},
  tick(order=Object.values(ctx.Game.creeps)){logistics.prepare(room);for(const c of order)logistics.haul(c);settle();}};
}
{
 const f=fixture(),dest=f.node(C.STRUCTURE_SPAWN,'spawn',8,8,0,300),src=f.box('mine',20,20,100),c=f.creep('legacy',7,8,40);
 c.memory.loaded=false;c.memory.haulPickup={id:src.id,room:f.room.name};c.memory.haulDelivery={id:dest.id,source:src.id,room:f.room.name,amount:100,priority:0,expires:100,phase:'pickup'};
 f.logistics.prepare(f.room);assert.equal(c.memory.haul.state,'deliver');assert.equal(c.memory.haul.task.amount,40);
 for(const k of ['loaded','haulPickup','haulDelivery'])assert.equal(c.memory[k],undefined);
 const before=JSON.stringify(c.memory.haul);f.reset();f.logistics.prepare(f.room);assert.equal(JSON.stringify(c.memory.haul),before,'reset preserves the unified task');
 f.logistics.haul(c);assert.equal(f.value(dest),0,'accepted transfer is not settled energy');f.settle();assert.equal(f.value(dest),40);
}
{
 const f=fixture(),dest=f.node(C.STRUCTURE_SPAWN,'spawn',7,5,0,300),src=f.box('tiny',5,5,10),c=f.creep('tiny-load',6,5);
 f.logistics.haul(c);assert.equal(c.memory.haul.task.amount,10);assert.equal(c.memory.haul.task.intent.amount,10);assert.equal(f.value(c),0);
 f.settle();f.logistics.haul(c);assert.equal(c.memory.haul.state,'deliver');assert.equal(c.memory.haul.task.intent.kind,'deliver');
 f.settle();assert.equal(f.value(dest),10);assert.equal(f.value(src),0);f.logistics.haul(c);assert.equal(c.memory.haul.state,'idle');
}
{
 const f=fixture(),dest=f.station('demand',8,5),store=f.node(C.STRUCTURE_STORAGE,'storage',5,5,1000,1000000);f.box('far',35,35,100);
 const c=f.creep('from-storage',6,5);f.logistics.prepare(f.room);assert.equal(c.memory.haul.task.source,store.id,'storage competes with mining stock as a normal source');
 const t=c.memory.haul.task;f.box('new-close',6,7,2000);f.settle();f.logistics.prepare(f.room);assert.equal(c.memory.haul.task.source,t.source,'small score changes cannot reverse the committed trip');
 assert.equal(c.memory.haul.task.id,dest.id);
}
{
 const f=fixture();f.node(C.STRUCTURE_SPAWN,'near-destination',6,5,0,300);f.node(C.STRUCTURE_SPAWN,'route-destination',21,5,0,300);f.box('supply',20,5,100);
 const c=f.creep('complete-route',5,5);f.logistics.prepare(f.room);assert.equal(c.memory.haul.task.id,'route-destination','new assignment compares both route legs across the same priority class');
}
{
 const f=fixture(),dest=f.station('demand',10,10),src=f.box('small',6,6,10),hub=f.node(C.STRUCTURE_LINK,'hub',8,6,106,800);f.room.hub=hub;
 const cs=[f.creep('a',7,6),f.creep('b',7,7),f.creep('c',6,7)];f.logistics.prepare(f.room);
 const reserved=id=>cs.reduce((n,c)=>n+(c.memory.haul.task?.source===id?c.memory.haul.task.pickupAmount:0),0);
 assert(reserved(src.id)<=10);assert(reserved(hub.id)<=106);assert.equal(reserved(src.id)+reserved(hub.id),116);
 for(const c of cs)f.logistics.haul(c);
 assert(f.runtime.availableEnergy(src)>=0&&f.runtime.availableEnergy(hub)>=0);
 const accepted=cs.reduce((n,c)=>n+(c.memory.haul.task?.intent?.amount||0),0);assert(accepted<=116);
 f.settle();assert.equal(cs.reduce((n,c)=>n+f.value(c),0),accepted);assert.equal(dest.store[C.RESOURCE_ENERGY],0);
}
{
 const f=fixture(),dest=f.station('small-gap',10,10,1800),src=f.box('supply',5,5,1000);
 const a=f.creep('a-empty',5,6),b=f.creep('b-empty',6,5),loaded=f.creep('z-loaded',9,10,100);
 f.task(a,dest,src.id,100);f.task(b,dest,src.id,100);f.logistics.prepare(f.room);
 assert.equal(loaded.memory.haul.task.amount,100,'loaded dispatch precedes empty carrier order');
 assert.equal([a,b,loaded].reduce((n,c)=>n+(c.memory.haul.task?.amount||0),0),200);
 f.logistics.haul(a);f.logistics.haul(b);f.logistics.haul(loaded);
 assert.equal(loaded.memory.haul.task.intent.kind,'deliver');
 assert.equal([a,b].reduce((n,c)=>n+(c.memory.haul.task?.intent?.amount||0),0),100,'empty-first execution cannot steal the loaded claim');
}
{
 const f=fixture(),dest=f.node(C.STRUCTURE_SPAWN,'spawn',8,8,0,300),c=f.creep('source-disappeared',7,8,40);
 f.task(c,dest,'destroyed-source',100);f.logistics.haul(c);assert.equal(c.memory.haul.state,'deliver');assert.equal(c.memory.haul.task.intent.amount,40);
 f.settle();assert.equal(f.value(dest),40);
}
{
 const f=fixture(),dest=f.station('normal',20,20),store=f.node(C.STRUCTURE_STORAGE,'storage',5,5,1000,1000000),c=f.creep('no-bounce',6,5,40);
 f.task(c,dest,store.id,40,'deliver');c.memory.haul.origin=store.id;dest.store[C.RESOURCE_ENERGY]=2000;f.logistics.haul(c);
 assert.equal(c.memory.haul.task,null);assert(!c.actions.some(a=>a.kind==='deliver'&&a.target===store.id));
 dest.store[C.RESOURCE_ENERGY]=0;f.settle();f.logistics.haul(c);assert.equal(c.memory.haul.task.id,dest.id);
}
{
 const f=fixture(),dest=f.station('normal',20,20),c=f.creep('urgent',10,10,30);f.task(c,dest,'mine',30,'deliver');
 f.logistics.prepare(f.room);assert.equal(c.memory.haul.task.id,dest.id);
 const spawn=f.node(C.STRUCTURE_SPAWN,'emergency',10,11,0,300);f.settle();f.logistics.haul(c);
 assert.equal(c.memory.haul.task.id,spawn.id);assert.equal(c.memory.haul.task.intent.amount,30,'partial cargo immediately serves a new emergency');
}
{
 const f=fixture(),dest=f.station('unload',10,10,1850),first=f.creep('first',9,10,100),second=f.creep('second',10,9,100),empty=f.creep('empty',5,5);
 const src=f.box('supply',6,5,100);f.task(first,dest,src.id,75,'deliver');f.task(second,dest,src.id,25,'deliver');f.task(empty,dest,src.id,50);
 assert(f.logistics.deliverHaul(first,dest));assert.equal(first.memory.haul.task.intent.amount,100,'old 75 lease cannot truncate 100 physical cargo');
 assert.equal(empty.memory.haul.task.amount,25,'full unload reclaims the excess empty soft demand');
 assert(f.logistics.deliverHaul(second,dest));assert.equal(second.memory.haul.task.intent.amount,50,'same-tick accepted incoming leaves only physical remaining space');assert.equal(empty.memory.haul.task,null);
 f.settle();assert.equal(f.value(dest),2000);assert.equal(f.value(second),50);f.logistics.prepare(f.room);assert.notEqual(second.memory.haul.task?.id,dest.id);
}
{
 const f=fixture(),dest=f.node(C.STRUCTURE_SPAWN,'spawn',7,5,0,300),src=f.box('supply',5,5,100),c=f.creep('rejected',6,5);
 f.logistics.haul(c);assert.equal(c.memory.haul.task.intent.kind,'pickup');f.settle([c.name]);assert.equal(f.value(c),0);
 f.logistics.prepare(f.room);assert.equal(c.memory.haul.state,'pickup','rejected pickup never fabricates loaded cargo');assert.equal(c.memory.haul.task.intent,undefined);
 f.logistics.haul(c);f.settle();f.logistics.haul(c);f.settle([c.name]);assert.equal(f.value(c),100);assert.equal(f.value(dest),0);
 f.reset();f.logistics.haul(c);assert.equal(c.memory.haul.state,'deliver','failed accepted transfer retains a real delivery task');assert.equal(f.value(c),100);
}
{
 const f=fixture(),store=f.node(C.STRUCTURE_STORAGE,'storage',5,5,1000,1000000),c=f.creep('idle',6,5);f.logistics.haul(c);
 assert.equal(c.memory.haul.state,'idle');assert.equal(c.actions.length,0,'storage cannot source its own storage request');
 const mine=f.box('mine',20,20,100);f.settle();f.logistics.prepare(f.room);assert.equal(c.memory.haul.task.source,mine.id);assert.equal(c.memory.haul.task.id,store.id,'normal excess may enter storage without forcing every trip through it');
}
{
 const f=fixture(),dest=f.station('topup-target',10,5,100),src=f.box('source',5,5,100),c=f.creep('cheap-topup',6,5,30);f.task(c,dest,src.id,100);
 f.logistics.prepare(f.room);assert.equal(c.memory.haul.state,'pickup');f.logistics.haul(c);assert.equal(c.memory.haul.task.intent.amount,70);
 f.settle();f.logistics.prepare(f.room);assert.equal(c.memory.haul.state,'deliver');
 const far=f.creep('skip-detour',15,15,30);f.task(far,dest,src.id,100);f.settle();f.logistics.prepare(f.room);assert.equal(far.memory.haul.state,'deliver','partial cargo never crosses the room to become full');
}
{
 const f=fixture(),dest=f.station('link-target',10,10,1600),sender=f.node(C.STRUCTURE_LINK,'sender',12,12,400,800),c=f.creep('courier',9,10,100);
 f.runtime.commitEnergy(sender,dest,400,388);f.logistics.haul(c);assert.equal(c.memory.haul.task.intent.amount,12,'Link incoming and hauling share physical destination capacity');
}
{
 const f=fixture(),dest=f.station('temporary-demand',10,10,1900),src=f.box('source',5,5,100),worker=f.creep('temporary-worker',4,5);
 worker.memory.role='builder';f.logistics.haulTarget(worker);assert.equal(worker.memory.haul.task.amount,100);
 const hauler=f.creep('normal-hauler',6,5);f.settle();f.logistics.prepare(f.room);
 assert.equal(hauler.memory.haul.task.source,src.id,'a worker that left hauling cannot reserve future source inventory');
 assert.equal(hauler.memory.haul.task.amount,100);f.logistics.release(worker);assert.equal(worker.memory.haul.state,'idle');
}
{
 const f=fixture(),dest=f.station('drop-demand',10,10,1850),src=f.drop('uncapped-drop',5,5,150),first=f.creep('first',6,5),peer=f.creep('peer',5,6);
 f.task(first,dest,src.id,50);f.task(peer,dest,src.id,100);f.logistics.collectHaul(first);
 assert.equal(first.memory.haul.task.intent.amount,100,'pickup has no quantity argument and accounts for its full accepted load');
 assert.equal(first.memory.haul.task.amount,100);assert.equal(peer.memory.haul.task.amount,50,'unfunded source and destination promises shrink after uncapped pickup');
 assert.equal(peer.memory.haul.task.pickupAmount,50);f.logistics.collectHaul(peer);f.settle();
 assert.equal(f.value(first)+f.value(peer),150,'source content is never counted more than once');
}
{
 const f=fixture();f.node(C.STRUCTURE_SPAWN,'demand',7,5,0,300);const trapped=f.node(C.STRUCTURE_STORAGE,'trapped',5,8,1000,1000000),reachable=f.box('reachable',13,5,100),c=f.creep('routes',6,5);
 for(let y=7;y<=9;y++)for(let x=4;x<=6;x++)if(x!==5||y!==8)f.room.walls.add(x+50*y);
 f.logistics.prepare(f.room);assert.equal(c.memory.haul.task.source,reachable.id,'a cheap geometric estimate cannot select an unreachable source');
 assert.notEqual(c.memory.haul.task.source,trapped.id);
 const source=c.memory.haul.task.source;let searches=0;const path=c.pos.findPathTo;c.pos.findPathTo=function(...args){searches++;return path.apply(this,args);};
 f.settle();f.logistics.prepare(f.room);f.logistics.haulTarget(c);assert.equal(c.memory.haul.task.source,source);assert.equal(searches,0,'stable task validation does not repeat candidate route search');
}
{
 const f=fixture(),dest=f.station('sole-port',20,20),former=f.creep('former-worker',23,20,100),courier=f.creep('courier',22,20,100);
 former.memory.role='builder';f.task(former,dest,'source',100,'deliver');former.memory.haul.executorTick=f.ctx.Game.time-1;
 former.memory.haul.task.port={x:21,y:20};const task=f.task(courier,dest,'source',100,'deliver'),layout={ports:[{x:21,y:20}],preferred:null,seats:[]};
 assert.equal(f.logistics.holdsDeliveryPort(former,former.memory.haul.task),false,'previous-tick temporary worker cannot retain a port');
 assert.equal(f.logistics.deliveryPort(courier,dest,task,layout).x,21,'stale temporary port does not block the only live unload endpoint');
 former.memory.haul.executorTick=f.ctx.Game.time;delete task.port;
 assert.equal(f.logistics.deliveryPort(courier,dest,task,layout),null,'an active delegated worker still owns its near-term port');
 f.logistics.release(former);assert.equal(f.logistics.deliveryPort(courier,dest,task,layout).x,21,'explicit work handoff releases the endpoint immediately');
}
{
 const f=fixture(),dest=f.station('same-node-starvation',10,5,100),src=f.box('source',5,5,100),c=f.creep('partial',6,5,30);
 f.task(c,dest,src.id,100);f.logistics.prepare(f.room);assert.equal(c.memory.haul.state,'pickup');
 dest.store[C.RESOURCE_ENERGY]=0;f.settle();f.logistics.prepare(f.room);
 assert.equal(c.memory.haul.state,'deliver','new starvation at the same destination ends optional topup');assert.equal(c.memory.haul.task.amount,30);
}
console.log('PASS: unified haul migration/reset, multi-tick actual reconciliation, tiny batches, full-route/storage sourcing, dual reservations, loaded-first reclamation, source/destination invalidation, emergency preemption, full unload, Link intent coordination, no self-route or storage bounce, bounded nearby topup');
