// Independent geometry checks against the official room terrain (no server writes).
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Module=require('node:module'),originalLoad=Module._load;
let archiveModule=require('./plans');
Module._load=function(request,parent,isMain){
 if(request==='plans'){if(!archiveModule)throw Error('Archive module unavailable');return archiveModule;}
 return originalLoad.call(this,request,parent,isMain);
};
Object.assign(global,require('/Users/zmy/Library/Application Support/Steam/steamapps/common/Screeps/server/package/node_modules/@screeps/common/lib/constants'));
global.Game={time:1,constructionSites:{}};global.Memory={frontier:{rooms:{}}};
class Pos{constructor(x,y,roomName){Object.assign(this,{x,y,roomName});}getRangeTo(p){p=p.pos||p;return Math.max(Math.abs(this.x-p.x),Math.abs(this.y-p.y));}}
global.RoomPosition=Pos;
class Matrix{constructor(){this.a=new Uint8Array(2500);}set(x,y,v){this.a[x+y*50]=v;}get(x,y){return this.a[x+y*50];}}
let terrain,searchCalls=0;
global.PathFinder={CostMatrix:Matrix,search(start,goal,opts){
 searchCalls++;const m=opts.roomCallback(start.roomName),d=new Float64Array(2500);d.fill(Infinity);
 const prev=new Int16Array(2500);prev.fill(-1);const heap=[];
 function push(v){heap.push(v);let i=heap.length-1;while(i){let p=(i-1)>>1;if(heap[p][0]<=v[0])break;heap[i]=heap[p];i=p;}heap[i]=v;}
 function pop(){let r=heap[0],v=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&heap[j+1][0]<heap[j][0])j++;if(v[0]<=heap[j][0])break;heap[i]=heap[j];i=j;}heap[i]=v;}return r;}
 let k=start.x+start.y*50;d[k]=0;push([0,k]);let found=-1;
 while(heap.length){const [cost,i]=pop();if(cost!==d[i])continue;const x=i%50,y=Math.floor(i/50);
  if(Math.max(Math.abs(x-goal.pos.x),Math.abs(y-goal.pos.y))<=goal.range){found=i;break;}
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
   const xx=x+dx,yy=y+dy,j=xx+yy*50;if(xx<0||yy<0||xx>49||yy>49||terrain.get(xx,yy)&1||m.get(xx,yy)===255)continue;
   const step=m.get(xx,yy)||(terrain.get(xx,yy)&2?opts.swampCost:opts.plainCost);const n=cost+step;
   if(n<d[j]){d[j]=n;prev[j]=i;push([n,j]);}
  }
 }
 const path=[];if(found>=0)for(let i=found;i!==k&&i>=0;i=prev[i])path.push(new Pos(i%50,Math.floor(i/50),start.roomName));
 return {path:path.reverse(),incomplete:found<0};
}};
const planner=require('./planner');
const K=p=>p.x+p.y*50;
const D=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
const name='W21N26';
const encoded=JSON.parse(fs.readFileSync('/tmp/screeps-'+name+'-terrain.json')).terrain[0].terrain;
const object=(p,id,type)=>({id,pos:new Pos(p[0],p[1],name),structureType:type,my:true});
const fromPlan=p=>object([p.x,p.y],p.tag,p.type);
function fixture({spawn=true,extra=[],sites=[]}={}){
 terrain={get:(x,y)=>Number(encoded[x+y*50])};
 const sources=[[24,24],[16,42]].map((p,i)=>object(p,'source'+i));
 const controller=Object.assign(object([16,21],'controller'),{level:1});
 const mineral=object([24,44],'mineral');
 const buildings=(spawn?[object([21,28],'spawn',STRUCTURE_SPAWN)]:[]).concat(extra);
 const room={name,controller,buildings,sites,getTerrain:()=>terrain,find(type){
  if(type===FIND_MY_CONSTRUCTION_SITES)return sites;if(type===FIND_SOURCES)return sources;if(type===FIND_MINERALS)return[mineral];
  if(type===FIND_MY_SPAWNS)return buildings.filter(s=>s.structureType===STRUCTURE_SPAWN&&s.my);if(type===FIND_STRUCTURES)return buildings;
  if([FIND_EXIT_TOP,FIND_EXIT_BOTTOM,FIND_EXIT_LEFT,FIND_EXIT_RIGHT].includes(type)){
   const exits=[];for(let i=0;i<50;i++){const x=type===FIND_EXIT_LEFT?0:type===FIND_EXIT_RIGHT?49:i,y=type===FIND_EXIT_TOP?0:type===FIND_EXIT_BOTTOM?49:i;if(!(terrain.get(x,y)&1))exits.push(new Pos(x,y,name));}return exits;
  }throw Error('Unhandled find '+type);
 }};
 return {room,sources,controller,mineral};
}
function validate(f,plan){
 const {room,sources,controller,mineral}=f;
 assert.equal(plan.complete,true,plan.missing);
 assert.equal(plan.roadVersion,1);assert.deepEqual(plan.roadMissing,[],'Economic routes must use the retained road network');
 const seen=new Map();for(const p of plan.structures){
  const k=K(p);
  if(p.type!==STRUCTURE_EXTRACTOR)assert(!(terrain.get(p.x,p.y)&1),'Building on wall: '+JSON.stringify(p));
  assert(p.x>0&&p.x<49&&p.y>0&&p.y<49);
  if(p.type!==STRUCTURE_EXTRACTOR)assert(!sources.concat([controller,mineral]).some(s=>K(s.pos)===k),'Building on natural object');
  if(![STRUCTURE_ROAD,STRUCTURE_RAMPART].includes(p.type)){assert(!seen.has(k),'Overlapping buildings');seen.set(k,p.type);}
 }
 for(let r=1;r<=8;r++){const counts={};for(const p of plan.structures.filter(p=>p.rcl<=r))counts[p.type]=(counts[p.type]||0)+1;for(const t in counts)assert(counts[t]<=CONTROLLER_STRUCTURES[t][r],`${name} RCL${r} ${t} ${counts[t]} > ${CONTROLLER_STRUCTURES[t][r]}`);}
 const inputs=plan.structures.filter(p=>p.tag.startsWith('lab-input'));const outputs=plan.structures.filter(p=>p.tag.startsWith('lab-output'));
 assert.equal(inputs.length,2);assert.equal(outputs.length,8);for(const i of inputs)for(const o of outputs)assert(D(i,o)<=2);
 // Independently flood from an actual walk tile, including pre-existing obstacles.
 const blocked=new Set(plan.structures.filter(p=>OBSTACLE_OBJECT_TYPES.includes(p.type)).map(K));
 for(const s of room.buildings.concat(room.sites))if(OBSTACLE_OBJECT_TYPES.includes(s.structureType))blocked.add(K(s.pos));
 for(const p of sources.concat([controller,mineral]))blocked.add(K(p.pos));
 const visited=new Set(),queue=[];let start;
 for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const x=plan.anchor.x+dx,y=plan.anchor.y+dy,k=x+y*50;if(!(terrain.get(x,y)&1)&&!blocked.has(k))start=k;}
 assert.notEqual(start,undefined,'No spawn exit');queue.push(start);visited.add(start);
 for(let j=0;j<queue.length;j++){const k=queue[j],x=k%50,y=Math.floor(k/50);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const xx=x+dx,yy=y+dy,n=xx+yy*50;if(xx<1||xx>48||yy<1||yy>48||blocked.has(n)||visited.has(n)||terrain.get(xx,yy)&1)continue;visited.add(n);queue.push(n);}}
 for(const p of plan.structures.filter(p=>![STRUCTURE_RAMPART,STRUCTURE_ROAD].includes(p.type))){let accessible=false;for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)if(visited.has(p.x+dx+(p.y+dy)*50))accessible=true;assert(accessible,'Inaccessible building '+JSON.stringify(p));}
 assert.equal(plan.sourcePlans.length,2);
 for(const s of plan.sourcePlans){const source=sources.find(p=>p.id===s.id);assert(D(s,source.pos)===1);assert(visited.has(K(s)),'Source stand tile unreachable');}
 assert(D(plan.controllerSpot,controller.pos)<=3);assert(visited.has(K(plan.controllerSpot)));
 const mining=plan.structures.find(p=>p.tag==='mineral');assert(mining&&D(mining,mineral.pos)===1&&visited.has(K(mining)));
 for(const p of room.buildings.concat(room.sites).filter(s=>[STRUCTURE_SPAWN,STRUCTURE_EXTENSION,STRUCTURE_STORAGE,STRUCTURE_LAB,STRUCTURE_CONTAINER].includes(s.structureType)))assert(plan.structures.some(i=>i.type===p.structureType&&K(i)===K(p.pos)),'Existing building/site omitted');
 return visited.size;
}
let f=fixture();searchCalls=0;const base=planner.makePlan(f.room);validate(f,base);assert(searchCalls<=8,'Planning regressed to per-building PathFinder calls');
console.log('Actual W21N26 spawn: complete RCL1–8 layout; '+searchCalls+' PathFinder calls; '+base.structures.length+' planned structures');
assert.equal(base.roadVersion,1);assert.deepEqual(base.roadMissing,[]);
const economyRoads=base.structures.filter(p=>p.type===STRUCTURE_ROAD&&p.roadClass==='economy');
assert(economyRoads.length>0&&economyRoads.length<base.counts.road/3,'Only the economic backbone should be promoted');
for(const route of base.roadRoutes){
 assert(route.complete);assert.equal(route.length,route.tiles.length);assert.equal(route.tiles.at(-1),K(base.roadCore));
 const target=route.kind==='source'?base.sourcePlans.find(p=>p.id===route.sourceId):base.controllerSpot;
 assert(D({x:route.tiles[0]%50,y:Math.floor(route.tiles[0]/50)},target)<=1);
 for(let i=0;i<route.tiles.length;i++){const p=economyRoads.find(p=>K(p)===route.tiles[i]);assert(p,'Route left the planned road graph');assert.equal(p.rcl,2);if(route.sourceId)assert(p.sourceIds.includes(route.sourceId));if(i)assert(D(p,{x:route.tiles[i-1]%50,y:Math.floor(route.tiles[i-1]/50)})<=1);}
}
console.log('Economic backbone: '+economyRoads.length+' of '+base.counts.road+' planned road tiles; both sources and controller share one connected core');
f=fixture({spawn:false});validate(f,planner.makePlan(f.room));console.log('Unclaimed W21N26: automatic anchor and full layout pass');
const retained=base.structures.filter(p=>[STRUCTURE_STORAGE,STRUCTURE_EXTENSION,STRUCTURE_CONTAINER,STRUCTURE_LAB,STRUCTURE_ROAD].includes(p.type)).map(fromPlan);
f=fixture({extra:retained});validate(f,planner.makePlan(f.room));console.log('Existing storage, 60 extensions, 10 labs, containers and roads retained without quota duplication');
const ext=base.structures.filter(p=>p.type===STRUCTURE_EXTENSION).slice(0,5).map(fromPlan);
f=fixture({sites:ext});validate(f,planner.makePlan(f.room));console.log('Existing extension construction sites reserved and reused');
f=fixture({spawn:false,sites:[fromPlan(base.structures.find(p=>p.tag==='primary'))]});assert.deepEqual(planner.chooseAnchor(f.room),base.anchor);validate(f,planner.makePlan(f.room));
// A neutral wall ring must disqualify the room, including range-one claim access.
const walls=[];for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)if(dx||dy)walls.push({...object([16+dx,21+dy],'wall',STRUCTURE_WALL),my:false});
f=fixture({spawn:false,extra:walls});assert.equal(planner.makePlan(f.room).complete,false);
f=fixture({extra:walls});const enclosed=planner.makePlan(f.room);assert.equal(enclosed.complete,false);assert.match(enclosed.missing,/controller.*unreachable/);
console.log('Neutral constructed walls enclosing controller cannot produce an expansion-ready plan');
f=fixture({spawn:false,extra:walls});Memory.frontier.rooms[name]={};Game.time=100;const blockedSurvey=planner.ensure(f.room);assert.equal(blockedSurvey.complete,false);
f.room.buildings.splice(0);Game.time=110;assert.equal(planner.ensure(f.room),blockedSurvey,'Incomplete plans should not rerun every tick');Game.time=600;validate(f,planner.ensure(f.room));
console.log('Blocked surveys retry after 500 ticks and recover when walls disappear');
// Real PathFinder returns a partial path on exhaustion: never treat its endpoint as a mineral stand.
const normalSearch=PathFinder.search;
f=fixture();PathFinder.search=(start,goal,opts)=>goal.pos.x===24&&goal.pos.y===44?{incomplete:true,path:[new Pos(22,30,name)]}:normalSearch(start,goal,opts);
const partial=planner.makePlan(f.room);PathFinder.search=normalSearch;assert.equal(partial.complete,false);assert(!partial.structures.some(p=>p.tag==='mineral'));
console.log('Incomplete mineral routes are rejected');
// Exercise the real staged construction runner and materialize sites between ticks.
f=fixture();f.room.storage={store:{[RESOURCE_ENERGY]:100000}};Memory.frontier={rooms:{[name]:{plan:base}}};
let calls=0;
f.room.createConstructionSite=(x,y,type)=>{
 const p={x,y},here=f.room.buildings.filter(s=>K(s.pos)===K(p));
 assert(!f.room.sites.some(s=>K(s.pos)===K(p)),'Two sites on one tile');
 assert(!here.some(s=>s.structureType===type),'Duplicate structure request');
 assert(!here.some(s=>s.structureType!==STRUCTURE_RAMPART&&type!==STRUCTURE_RAMPART&&!(s.structureType===STRUCTURE_ROAD&&type===STRUCTURE_CONTAINER)&&!(s.structureType===STRUCTURE_CONTAINER&&type===STRUCTURE_ROAD)),'Incompatible occupied tile');
 const count=f.room.buildings.concat(f.room.sites).filter(s=>s.structureType===type).length;
 assert(count<CONTROLLER_STRUCTURES[type][f.controller.level],'RCL limit exceeded');
 const item=base.structures.find(i=>i.type===type&&i.x===x&&i.y===y);assert(item&&item.rcl<=f.controller.level,'Premature construction');
 const site=object([x,y],'site-'+(++calls),type);f.room.sites.push(site);Game.constructionSites[site.id]=site;return OK;
};
for(let level=1;level<=8;level++){
 f.controller.level=level;
 for(let t=0;t<150;t++){
  const before=calls;Game.time+=10;Game.time-=Game.time%10;planner.run(f.room);
  assert(f.room.sites.length<=5,'Per-tick site budget exceeded');
  assert(f.room.sites.filter(s=>s.structureType===STRUCTURE_ROAD).length<=3,'Road site budget exceeded');
  f.room.buildings.push(...f.room.sites.splice(0));Game.constructionSites={};if(before===calls)break;
 }
 for(const p of base.structures.filter(p=>p.rcl<=level))assert(f.room.buildings.some(s=>s.structureType===p.type&&K(s.pos)===K(p)),`RCL${level} never built ${p.tag}`);
}
console.log('RCL1–8 construction simulation: all '+base.structures.length+' planned structures realized with valid stage, overlap and site budgets');
// A deployed v3 plan migrates metadata in place without layout churn or a new search.
f=fixture();const old=JSON.parse(JSON.stringify(base));delete old.roadVersion;delete old.roadRoutes;delete old.roadMissing;delete old.roadCore;
for(const p of old.structures){delete p.roadClass;delete p.sourceIds;delete p.roadSwamp;delete p.roadOrder;if(p.type===STRUCTURE_ROAD){p.rcl=Math.max(3,p.rcl);p.priority=30;}}
const geometry=JSON.stringify(old.structures.map(p=>[p.type,p.x,p.y,p.tag])),beforeMigration=searchCalls;
Memory.frontier={rooms:{[name]:{plan:old}}};assert.equal(planner.ensure(f.room),old);assert.equal(old.roadVersion,1);assert.equal(searchCalls,beforeMigration);assert.equal(JSON.stringify(old.structures.map(p=>[p.type,p.x,p.y,p.tag])),geometry);assert.deepEqual(old.counts,base.counts);
function roadFixture(level,extra=[],sites=[]){
 const ready=base.structures.filter(p=>p.rcl<=level&&p.type!==STRUCTURE_ROAD&&p.tag!=='primary').map(fromPlan);
 const state=fixture({extra:ready.concat(extra),sites});state.controller.level=level;
 Memory.frontier={rooms:{[name]:{plan:base}}};Game.constructionSites={};
 state.room.createConstructionSite=(x,y,type)=>{const s=object([x,y],'road-test-'+state.room.sites.length,type);state.room.sites.push(s);Game.constructionSites[s.id]=s;return OK;};
 return state;
}
function buildOnce(state){Game.time+=10;Game.time-=Game.time%10;planner.run(state.room);}
f=roadFixture(1);buildOnce(f);assert.equal(f.room.sites.length,0,'Roads must not preempt RCL1 recovery');
f=roadFixture(2);buildOnce(f);assert.equal(f.room.sites.length,3);
for(const site of f.room.sites)assert(economyRoads.some(p=>K(p)===K(site.pos)),'RCL2 road was not economic');
assert(terrain.get(f.room.sites[0].pos.x,f.room.sites[0].pos.y)&TERRAIN_MASK_SWAMP,'Swamp bottleneck should be paved first');
buildOnce(f);assert.equal(f.room.sites.length,3,'Unfinished road sites must cap subsequent batches');
const queued=base.structures.filter(p=>p.rcl===3&&[STRUCTURE_EXTENSION,STRUCTURE_TOWER].includes(p.type)).map(fromPlan).concat([fromPlan(economyRoads[0])]);
f=roadFixture(2,[],queued);f.controller.level=3;buildOnce(f);assert.equal(f.room.sites.length,8,'Construction should use at most one remaining room slot');
f=roadFixture(2);Game.constructionSites=Object.fromEntries(Array.from({length:90},(_,i)=>[i,{}]));buildOnce(f);assert.equal(f.room.sites.length,0,'Global site reserve must be respected');
f=roadFixture(4,economyRoads.map(fromPlan));f.room.storage={store:{[RESOURCE_ENERGY]:19999}};buildOnce(f);assert.equal(f.room.sites.length,0,'Access roads should wait for surplus');
f.room.storage.store[RESOURCE_ENERGY]=20000;buildOnce(f);assert.equal(f.room.sites.length,3);for(const site of f.room.sites)assert(base.structures.some(p=>p.type===STRUCTURE_ROAD&&p.roadClass==='access'&&K(p)===K(site.pos)));
console.log('Road policy: metadata-only v3 migration; RCL2 economic roads; swamp priority; 3 road / 8 room / 90 global site limits; ordinary roads wait for RCL4 and surplus');

// The static archive retains every executable field from acknowledged API data.
// Cold Memory only retains candidate metadata, and readers do not decode plans.
const clone=value=>JSON.parse(JSON.stringify(value));
const snapshotFile=__dirname+'/state/room-plans-before.json';
const snapshots=JSON.parse(fs.readFileSync(snapshotFile));
const realArchive=archiveModule;
for(const [n,m] of Object.entries(snapshots)){
 const id=realArchive.identify(n,m.plan);assert(id,'Snapshot must have an exact acknowledged archive');
 assert.deepEqual(realArchive.load(n,id),m.plan,'Lossless static archive for '+n);
 const altered=clone(m.plan);altered.structures[0].x++;assert.equal(realArchive.identify(n,altered),null,'Changed structures are never acknowledged implicitly');
}
const home=fixture().room;
Game.rooms={[name]:home};Game.cpu={limit:20,bucket:10000,getUsed:()=>0};
Memory.frontier={rooms:clone(snapshots),intel:{}};Game.time=100001;
const ownedBefore=clone(Memory.frontier.rooms[name]);
const coldNames=Object.keys(snapshots).filter(n=>n!==name);
const fullCount=()=>coldNames.filter(n=>Array.isArray(Memory.frontier.rooms[n].plan.structures)).length;
const nextMaintenance=()=>{Game.time++;if(Game.time%10===0)Game.time++;planner.run(home);};
planner.run(home);assert.equal(fullCount(),coldNames.length-1);
planner.run(home);planner.run(home);assert.equal(fullCount(),coldNames.length-1,'Only one cold room may migrate per tick');
Game.cpu.getUsed=()=>13;nextMaintenance();assert.equal(fullCount(),coldNames.length-1,'Migration must yield CPU headroom');
Game.cpu.getUsed=()=>0;Game.cpu.bucket=1999;nextMaintenance();assert.equal(fullCount(),coldNames.length-1,'Migration must preserve a low bucket');
Game.cpu.bucket=10000;
while(fullCount())nextMaintenance();
assert.deepEqual(Memory.frontier.rooms[name],ownedBefore,'Owned layout and economy metadata must remain unchanged');
let coldBefore=0,coldAfter=0;
for(const n of coldNames){
 const summary=Memory.frontier.rooms[n].plan;
 assert.equal(typeof summary.archiveId,'string');assert.equal(summary.structures,undefined);assert.equal(summary.roadRoutes,undefined);
 coldBefore+=JSON.stringify(snapshots[n]).length;coldAfter+=JSON.stringify(Memory.frontier.rooms[n]).length;
 assert.deepEqual(realArchive.load(n,summary.archiveId),snapshots[n].plan,'All coordinates and road metadata survive '+n);
 for(const field of ['version','created','complete','missing','anchor','sourcePlans','controllerSpot','counts'])assert.deepEqual(summary[field],snapshots[n].plan[field]);
}
assert(coldAfter<coldBefore*.02,'Cold summaries should remove at least 98% of dormant plan Memory');
console.log('Acknowledged API archive: '+coldNames.length+' cold room plans, '+coldBefore+' → '+coldAfter+' Memory JSON characters, with exact executable layout restoration');
const summaries=clone(Memory.frontier.rooms);
const coldName=coldNames.find(n=>snapshots[n].plan.complete),coldRoom={name:coldName,controller:{my:false}};
const nativeParse=JSON.parse;let decodes=0;
JSON.parse=function(...args){decodes++;return nativeParse(...args);};
try{
 const summary=Memory.frontier.rooms[coldName].plan;
 for(let i=0;i<100;i++)assert.equal(planner.ensure(coldRoom),summary);
 const incompleteName=coldNames.find(n=>!snapshots[n].plan.complete);
 Game.time+=1000;
 assert.equal(planner.ensure({name:incompleteName,controller:{my:false}}),Memory.frontier.rooms[incompleteName].plan);
 assert.equal(decodes,0,'Scouts never decode archives or replan archived cold rooms');
 summary.anchor={x:10,y:11};assert.deepEqual(planner.ensure(coldRoom).anchor,{x:10,y:11},'Current API summary edits remain visible');
}finally{JSON.parse=nativeParse;}
Memory.frontier.rooms=clone(summaries);
Memory.frontier.expansion={target:coldName,state:'launching'};
let beforeRestore=searchCalls;
const activePlan=planner.ensure(coldRoom);
assert.deepEqual(activePlan,snapshots[coldName].plan);assert.equal(searchCalls,beforeRestore,'Activation restores exact coordinates without replanning');
assert.equal(activePlan,Memory.frontier.rooms[coldName].plan);assert(!Object.isFrozen(activePlan.structures));
nextMaintenance();assert.equal(Memory.frontier.rooms[coldName].plan,activePlan,'An active expansion target must keep its execution data');
delete Memory.frontier.expansion;
const ownedName=coldNames.find(n=>n!==coldName&&snapshots[n].plan.complete);
const claimedRoom={name:ownedName,controller:{my:true}};Game.rooms[ownedName]=claimedRoom;
assert.deepEqual(planner.ensure(claimedRoom),snapshots[ownedName].plan);assert.equal(searchCalls,beforeRestore);
const restored=Memory.frontier.rooms[ownedName].plan;restored.structures[0].priority=121;assert.equal(planner.ensure(claimedRoom).structures[0].priority,121);
console.log('Cold scouts use summaries only; owned and active expansion rooms restore exact mutable execution lists without new searches');

// Unknown and changed layouts never disappear. A restored full array explicitly
// supplied through the API is authoritative over its previous archive receipt.
const changedName=coldNames.find(n=>n!==ownedName&&n!==coldName);
Memory.frontier.rooms[changedName]=clone(snapshots[changedName]);
Memory.frontier.rooms[changedName].plan.structures[0].priority=321;
Memory.frontier.rooms.unknown={plan:clone(base)};
const changedBefore=clone(Memory.frontier.rooms[changedName]);
Game.time+=300;nextMaintenance();
assert.deepEqual(Memory.frontier.rooms[changedName],changedBefore);assert(Array.isArray(Memory.frontier.rooms.unknown.plan.structures));
Memory.frontier.rooms[changedName].plan.archiveId='obsolete';
assert.equal(planner.ensure({name:changedName,controller:{my:false}}).structures[0].priority,321);

function freshPlanner(customArchive=realArchive){
 archiveModule=customArchive;delete require.cache[require.resolve('./planner')];return require('./planner');
}
// A global reset leaves no heap cache; restoration relies only on the deployed
// static archive and the archive ID still present in ordinary Memory.
Memory.frontier={rooms:clone(summaries),intel:{}};Game.rooms={[name]:home};
const resetPlanner=freshPlanner();const resetRoom={name:coldName,controller:{my:true}};
assert.deepEqual(resetPlanner.ensure(resetRoom),snapshots[coldName].plan);

// Missing module/ID or incompatible plan versions rebuild only an activated
// room once. Subsequent normal ticks reuse its newly persisted plan.
for(const missing of [null,realArchive]){
 const fallback=freshPlanner(missing),state=fixture();
 Memory.frontier={rooms:{[name]:{plan:{version:3,created:Game.time,complete:true,archiveId:'missing'}}},intel:{}};
 beforeRestore=searchCalls;const rebuilt=fallback.ensure(state.room);
 assert(rebuilt.complete&&rebuilt.structures);assert(searchCalls>beforeRestore);
 const afterRebuild=searchCalls;assert.equal(fallback.ensure(state.room),rebuilt);assert.equal(searchCalls,afterRebuild);
}
function archiveOf(room,plan){return {has:n=>n===room,identify:(n,p)=>n===room&&JSON.stringify(p)===JSON.stringify(plan)?'test-id':null,load:(n,id)=>n===room&&id==='test-id'?clone(plan):null};}
const outdated=clone(base);outdated.version=2;
let special=freshPlanner(archiveOf(name,outdated));
Memory.frontier={rooms:{[name]:{plan:{version:2,created:Game.time,complete:true,archiveId:'test-id'}}},intel:{}};
beforeRestore=searchCalls;let result=special.ensure(fixture().room);assert.equal(result.version,3);assert(searchCalls>beforeRestore);
const afterVersion=searchCalls;assert.equal(special.ensure(fixture().room),result);assert.equal(searchCalls,afterVersion);
// A road metadata upgrade preserves the archived building geometry.
const oldRoad=clone(base);delete oldRoad.roadVersion;
special=freshPlanner(archiveOf(name,oldRoad));Memory.frontier.rooms[name].plan={version:3,created:Game.time,complete:true,archiveId:'test-id'};
beforeRestore=searchCalls;result=special.ensure(fixture().room);
assert.equal(result.roadVersion,1);assert.equal(searchCalls,beforeRestore);
assert.deepEqual(result.structures.map(p=>[p.type,p.x,p.y,p.tag]),base.structures.map(p=>[p.type,p.x,p.y,p.tag]));
// Incomplete layouts resume their existing retry policy once active.
f=fixture({spawn:false,extra:walls});const blocked=planner.makePlan(f.room);blocked.created=Game.time;
special=freshPlanner(archiveOf(name,blocked));Memory.frontier.rooms[name].plan={version:3,created:Game.time,complete:false,archiveId:'test-id'};
const incomplete=special.ensure(f.room);assert.equal(incomplete.complete,false);
beforeRestore=searchCalls;Game.time+=100;assert.equal(special.ensure(f.room),incomplete);assert.equal(searchCalls,beforeRestore);
f.room.buildings.splice(0);Game.time=blocked.created+500;assert.equal(special.ensure(f.room).complete,true);assert(searchCalls>beforeRestore);
console.log('Global reset, missing archive/module, version upgrade, road metadata migration and active 500-tick failure retry all recover safely');

// Incremental offline generation must preserve old payloads when fresh game
// snapshots contain summaries, and retain IDs that still exist in live Memory.
const os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'screeps-plan-archive-'));
try{
 const input=path.join(temporary,'snapshot.json'),output=path.join(temporary,'plans.js');
 const generate=()=>cp.execFileSync(process.execPath,[__dirname+'/tools/build-plan-archive.cjs','--snapshot',input,'--output',output],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 const readArchive=()=>{delete require.cache[require.resolve(output)];return require(output);};
 fs.writeFileSync(input,JSON.stringify({[coldName]:snapshots[coldName]}));generate();
 let generated=readArchive();const id=generated.identify(coldName,snapshots[coldName].plan);
 fs.writeFileSync(input,JSON.stringify({[coldName]:summaries[coldName]}));generate();
 generated=readArchive();assert.deepEqual(generated.load(coldName,id),snapshots[coldName].plan,'A summary-only update preserves its full local archive');
 const revision=clone(snapshots[coldName]);revision.plan.structures[0].priority++;
 fs.writeFileSync(input,JSON.stringify({[coldName]:revision}));generate();
 generated=readArchive();const revisedId=generated.identify(coldName,revision.plan);assert(revisedId&&revisedId!==id);
 assert.deepEqual(generated.load(coldName,id),snapshots[coldName].plan,'Previously issued archive IDs remain restorable');
 assert.deepEqual(generated.load(coldName,revisedId),revision.plan);
 const beforeFailure=fs.readFileSync(output,'utf8');
 fs.writeFileSync(input,JSON.stringify({unknown:{plan:{archiveId:'absent'}}}));
 assert.throws(generate,/unavailable archive/);assert.equal(fs.readFileSync(output,'utf8'),beforeFailure,'An unavailable summary reference must not overwrite the archive');
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
Module._load=originalLoad;
console.log('Offline archive generator preserves summary-only rooms and old IDs, merges new full plans, and rejects missing payloads without destructive writes');
console.log('All planner checks passed (independent geometry/API simulation; not a live CPU benchmark).');
