const vm=require('node:vm'),assert=require('node:assert/strict');
const {constants:C,readSource}=require('./test-support/runtime.cjs');
function fixture(){
 const homeName='W21N26',targetName='W21N25';
 function room(name,owned,level){const sourceList=[{id:name+'a',pos:{x:10,y:10}},{id:name+'b',pos:{x:30,y:30}}];return{name,sourceList,controller:{my:owned,owner:owned?{username:'AdamZmy'}:undefined,level,pos:{x:20,y:20}},storage:{store:{energy:20000}},find(k){if(k===C.FIND_SOURCES)return sourceList;if(k===C.FIND_MY_SPAWNS)return[{}];return[];},getTerrain:()=>({get:()=>0})};}
 const home=room(homeName,true,4),target=room(targetName,true,2);
 function unit(role,name,source,n=5){return{memory:{role,home:name,source},ticksToLive:1000,getActiveBodyparts:p=>p===C.WORK&&role==='miner'?n:p===C.CARRY&&role==='hauler'?n:0};}
 const history=Array.from({length:6},(_,i)=>({bank:10000+i*100}));
 const root={rooms:{[homeName]:{plan:{complete:true}},[targetName]:{plan:{complete:true,sourcePlans:[{pathLength:10},{pathLength:15}]}}},intel:{[homeName]:{terrain:{plain:1500,swamp:0}},[targetName]:{seen:1000,controller:{},sources:[{},{}],exits:{1:'W21N26'},terrain:{plain:1500,swamp:0},hostiles:0}},status:{cpu:8},telemetry:{cpuEMA:8,alerts:{},rooms:{[homeName]:{history},[targetName]:{history,upgradeEMA:.5}}}};
 const ctx={...C,module:{exports:{}},require:()=>({ensure:()=>({complete:true}),chooseAnchor:()=>({x:20,y:20})}),console:{log(){}},Memory:{frontier:root},Game:{time:1000,cpu:{bucket:9000},gcl:{level:7},rooms:{[homeName]:home},creeps:{a:unit('miner',homeName,homeName+'a'),b:unit('miner',homeName,homeName+'b'),h:unit('hauler',homeName,null,8)},map:{getRoomStatus:()=>({status:'normal'}),describeExits:()=>({3:targetName}),findRoute:()=>[{exit:3,room:targetName}]}}};
 vm.createContext(ctx);vm.runInContext(readSource('expansion.js'),ctx);
 return {ctx,root,home,target,homeName,targetName,unit,run:()=>ctx.module.exports.tick([home])};
}
let f=fixture();f.run();assert.equal(f.root.expansion.target,f.targetName);assert.equal(f.root.expansion.state,'launching');
f=fixture();f.home.storage.store.energy=11999;f.run();assert.equal(f.root.expansion,undefined);
f=fixture();f.root.telemetry.rooms[f.homeName].history[5].bank=9000;f.run();assert.equal(f.root.expansion,undefined);
f=fixture();f.root.telemetry.cpuEMA=17;f.run();assert.equal(f.root.expansion,undefined);
f=fixture();f.ctx.Game.creeps.b.ticksToLive=80;f.run();assert.equal(f.root.expansion,undefined);
f=fixture();f.root.expansion={home:f.homeName,target:f.targetName,state:'launching',started:900};f.ctx.Game.rooms[f.targetName]=f.target;f.run();assert.equal(f.root.expansion.state,'stabilizing','Spawn alone must not mean self-sufficient');
f.ctx.Game.creeps.ta=f.unit('miner',f.targetName,f.targetName+'a',2);f.ctx.Game.creeps.tb=f.unit('miner',f.targetName,f.targetName+'b',2);f.ctx.Game.creeps.th=f.unit('hauler',f.targetName,null,2);f.run();assert.equal(f.root.expansion.state,'complete');
f=fixture();f.root.expansion={home:f.homeName,target:f.targetName,state:'blocked',started:0};f.run();assert.equal(f.root.expansion.state,'blocked');
f=fixture();f.root.expansion={home:f.homeName,target:f.targetName,state:'stabilizing',started:900};f.ctx.Game.rooms[f.targetName]=f.target;f.home.energyAvailable=1300;
let pioneerRequests=0;f.ctx.module.exports.spawn(f.home,{spawnCreep(){pioneerRequests++;}},[{memory:{role:'scout'},ticksToLive:500}]);
assert.equal(pioneerRequests,0,'An owned colony with a spawn must not trigger an endless stream of replacement pioneers');
console.log('PASS: funded launch, falling reserves/CPU/replacement gates, colony self-sufficiency, blocked-state persistence');

// Inter-room travel must retain both its room route and exit endpoint. Repeated
// RoomPosition path selection is a real search, independent of moveTo's cache.
function travelerFixture(){
 const f=fixture();let routeCalls=0,exitCalls=0,nextX=49;
 f.ctx.RoomPosition=class {constructor(x,y,roomName){Object.assign(this,{x,y,roomName});}};
 f.ctx.Game.map.findRoute=(from,to,options)=>{routeCalls++;return options.routeCallback(to)===Infinity?C.ERR_NO_PATH:[{exit:3,room:to}];};
 const find=f.home.find;f.home.find=k=>k===C.FIND_EXIT_RIGHT?[{x:49,y:20,roomName:f.homeName},{x:48,y:20,roomName:f.homeName}]:find(k);
 const creep={id:'traveler',room:f.home,memory:{role:'claimer',home:f.homeName,target:f.targetName},pos:{x:25,y:25,roomName:f.homeName,findClosestByPath(exits,options){exitCalls++;assert.equal(options.ignoreCreeps,true);assert.equal(options.maxRooms,1);return exits.find(p=>p.x===nextX)||exits[0];}}};
 const goals=[];let result=C.OK;
 const run=()=>f.ctx.module.exports.run(creep,{go(c,p,r){assert.equal(r,0);goals.push(p);return result;}});
 return {...f,creep,goals,run,routeCalls:()=>routeCalls,exitCalls:()=>exitCalls,setX:x=>{nextX=x;},setResult:r=>{result=r;}};
}
let t=travelerFixture();
for(let i=0;i<80;i++){t.ctx.Game.time=1000+i;t.setX(49-i%2);t.run();}
assert.equal(t.routeCalls(),1,'Eighty travel ticks should share one inter-room route');
assert.equal(t.exitCalls(),1,'A moving creep must not reselect the exit every tick');
assert.ok(t.goals.every(p=>p.x===49&&p.y===20),'The movement endpoint stays stable despite closest-exit changes');
t.ctx.Game.time=1100;t.run();assert.equal(t.routeCalls(),2,'Route TTL must trigger a new route search');assert.equal(t.exitCalls(),2);

t=travelerFixture();t.run();t.ctx.Game.time++;
t.root.intel[t.targetName].hostiles=1;t.root.intel[t.targetName].seen=t.ctx.Game.time;t.run();
assert.equal(t.routeCalls(),2,'New hostile intel invalidates a cached route immediately');
assert.equal(t.goals.length,1,'The stale route must not move a creep into a newly unsafe room');
assert.equal(t.creep.memory.unreachable,t.ctx.Game.time);
t.ctx.Game.time++;t.run();assert.equal(t.routeCalls(),2,'Unreachable routes use a short retry backoff');
t.root.intel[t.targetName].hostiles=0;t.ctx.Game.time+=10;t.run();assert.equal(t.routeCalls(),3,'Failed routes are retried after a bounded interval');

t=travelerFixture();t.run();t.ctx.Game.time++;t.root.intel[t.targetName].owner='other';t.run();
assert.equal(t.routeCalls(),2,'Ownership changes invalidate a cached route');assert.equal(t.goals.length,1);
t=travelerFixture();t.run();t.ctx.Game.time++;t.ctx.Game.map.getRoomStatus=()=>({status:'closed'});t.run();
assert.equal(t.routeCalls(),2,'Closed rooms invalidate a cached route');assert.equal(t.goals.length,1);

t=travelerFixture();t.run();t.setResult(C.ERR_NO_PATH);t.ctx.Game.time++;t.run();
assert.equal(t.creep.memory.travelExit,undefined,'A local path failure clears the stale endpoint');
t.setResult(C.OK);t.ctx.Game.time++;t.run();assert.equal(t.routeCalls(),2);assert.equal(t.exitCalls(),2);
t.creep.memory.target='W22N26';t.ctx.Game.time++;t.run();assert.equal(t.exitCalls(),3,'A target change requires a fresh exit selection');

t=travelerFixture();
for(let i=0;i<129;i++){t.creep.memory.target='W'+(100+i)+'N1';t.run();}
assert.equal(t.routeCalls(),129);t.creep.memory.target='W100N1';t.run();
assert.equal(t.routeCalls(),130,'Bounded route cache evicts the oldest route instead of growing forever');
console.log('PASS: shared route/exit caches, expiry, immediate hazard invalidation, failed-route backoff, path recovery and bounded memory');

// Reproduce the real W20N25 (19,48) failure: findClosestByPath can select
// (20,49) because it reaches range 1, then moveTo appends the blocked final
// step and returns OK. Successful return codes must not hide non-movement.
function edgeFixture(){
 const f=fixture(),roomName='W20N25',target='W20N24';
 f.ctx.RoomPosition=class {constructor(x,y,roomName){Object.assign(this,{x,y,roomName});}};
 f.home.name=roomName;f.ctx.Game.map.findRoute=()=>[{exit:C.FIND_EXIT_BOTTOM,room:target}];
 let structures=[],occupants=[],exits=[17,18,19,20].map(x=>({x,y:49,roomName})),scans=0,searches=0,jam=false;
 const blocking=s=>C.OBSTACLE_OBJECT_TYPES.includes(s.structureType)||s.structureType===C.STRUCTURE_RAMPART&&!s.my&&!s.isPublic;
 const blocked=p=>structures.some(s=>s.pos.x===p.x&&s.pos.y===p.y&&blocking(s))||occupants.some(u=>u.pos.x===p.x&&u.pos.y===p.y);
 const c={id:'scout',room:f.home,fatigue:0,memory:{role:'claimer',home:roomName,target},pos:{x:19,y:48,roomName,
  findClosestByPath(candidates){searches++;assert.ok(Array.isArray(candidates));return candidates.filter(p=>Math.max(Math.abs(p.x-this.x),Math.abs(p.y-this.y))<=1).at(-1)||candidates[0];}}};
 f.home.find=k=>{if(k===C.FIND_STRUCTURES){scans++;return structures;}if(k===C.FIND_CREEPS)return occupants;if(k===C.FIND_EXIT_BOTTOM)return exits;return [];};
 const goals=[];
 function go(creep,p){
  if(creep.fatigue)return C.ERR_TIRED;
  const key=roomName+':'+creep.pos.x+','+creep.pos.y,targetKey=roomName+':'+p.x+','+p.y+':0';
  creep.memory.stuck=creep.memory.moveAttempt===f.ctx.Game.time-1&&creep.memory.moveTarget===targetKey&&creep.memory.last===key?(creep.memory.stuck||0)+1:0;
  Object.assign(creep.memory,{last:key,moveTarget:targetKey,moveAttempt:f.ctx.Game.time});
  goals.push({x:p.x,y:p.y,hadPath:!!creep.memory._move});
  if(!jam&&!blocked(p)){creep.pos.x=p.x;creep.pos.y=p.y;}
  return C.OK;
 }
 return {...f,c,goals,run:()=>f.ctx.module.exports.run(c,{go}),scans:()=>scans,searches:()=>searches,
  setStructures:v=>{structures=v;},setOccupants:v=>{occupants=v;},setExits:v=>{exits=v;},setJam:v=>{jam=v;},
  wall:(x=20,y=49)=>({structureType:C.STRUCTURE_WALL,pos:{x,y,roomName}}),
  cached(){Object.assign(c.memory,{travelExit:{key:roomName+'>'+target+':5',x:20,y:49,at:918},stuck:248,last:roomName+':19,48',moveAttempt:999,moveTarget:roomName+':20,49:0',_move:{path:'20494'}});}};
}
let e=edgeFixture();e.setStructures([e.wall()]);e.run();
assert.deepEqual(e.goals.map(p=>[p.x,p.y]),[[19,49]],'A range-1-reachable but walled exit must be excluded before selection');

e=edgeFixture();e.setStructures([e.wall(20,47),e.wall(20,48),e.wall()]);e.cached();e.run();
assert.deepEqual([e.c.pos.x,e.c.pos.y],[19,49],'The live stuck-248 snapshot must recover to a passable exit');
assert.equal(e.goals[0].hadPath,false,'The obsolete appended final-step path must be cleared');
assert.equal(e.c.memory.travelExitAvoid[0].until,1050,'Failed endpoints are avoided for fifty ticks');
assert.equal(e.scans(),1);

for(const [properties,expectedX] of [[{my:false,isPublic:false},19],[{my:false,isPublic:true},20],[{my:true,isPublic:false},20]]){
 e=edgeFixture();e.setStructures([{structureType:C.STRUCTURE_RAMPART,pos:{x:20,y:49},...properties}]);e.run();
 assert.equal(e.goals[0].x,expectedX,'Enemy private ramparts block entry; own and public ramparts remain passable');
}
e=edgeFixture();e.setOccupants([{id:'other',pos:{x:20,y:49}}]);e.run();assert.equal(e.goals[0].x,19,'Occupied exit tiles must be excluded too');

e=edgeFixture();e.setJam(true);
for(let i=0;i<6;i++){e.ctx.Game.time=1000+i;e.run();}
assert.equal(e.goals.at(-1).x,19,'Repeated OK results without movement must invalidate the first endpoint');
assert.equal(e.scans(),2,'A blocked endpoint is reselected only after consecutive real failed attempts');
assert.equal(e.c.memory.travelExitAvoid[0].x,20);
for(let i=6;i<11;i++){e.ctx.Game.time=1000+i;e.run();}
assert.equal(e.goals.at(-1).x,18,'A second blocked endpoint must not immediately select the first failed tile');
assert.equal(e.c.memory.travelExitAvoid.length,2);

for(const stale of [{fatigue:2},{moveAttempt:900},{last:'W20N25:18,48'},{moveTarget:'W20N25:19,49:0'}]){
 e=edgeFixture();e.setJam(true);e.cached();
 if(stale.fatigue)e.c.fatigue=stale.fatigue;else Object.assign(e.c.memory,stale);
 e.run();assert.equal(e.scans(),0,'Fatigue, old attempts, progress or another target must not invalidate a cached exit');
 assert.equal(e.c.memory.travelExitAvoid,undefined);
}

e=edgeFixture();e.setStructures([17,18,19,20].map(x=>e.wall(x)));e.run();
for(let i=1;i<10;i++){e.ctx.Game.time=1000+i;e.run();}
assert.equal(e.scans(),1,'Fully blocked exits must back off instead of scanning every tick');
assert.equal(e.searches(),0);assert.equal(e.goals.length,0);
e.setStructures([]);e.ctx.Game.time=1010;e.run();assert.equal(e.scans(),2);assert.equal(e.goals.length,1,'Retry after ten ticks can recover when the obstruction disappears');

e=edgeFixture();e.setExits([{x:20,y:49,roomName:'W20N25'}]);e.setJam(true);
for(let i=0;i<6;i++){e.ctx.Game.time=1000+i;e.run();}
assert.equal(e.goals.length,5,'A failed sole exit must not be retried immediately');
e.setJam(false);e.ctx.Game.time=1055;e.run();
assert.deepEqual([e.c.pos.x,e.c.pos.y],[20,49],'The fifty-tick exclusion expires and allows a recovered sole exit');
console.log('PASS: real blocked-exit OK/no-movement regression, obstacle/rampart/occupancy filtering, bounded stuck recovery, fatigue/stale exclusions and retry expiry');
