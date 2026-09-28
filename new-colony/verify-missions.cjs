'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm');
const {constants:C,readSource}=require('./test-support/runtime.cjs');
function load(context,name,overrides={}){
    const cache={};
    const get=n=>{
        if(Object.hasOwn(overrides,n))return overrides[n];
        if(cache[n])return cache[n].exports;
        const module=cache[n]={exports:{}};
        const fn=vm.runInContext('(function(require,module,exports){'+readSource(n+'.js')+'\n})',context);
        fn(get,module,module.exports);return module.exports;
    };return get(name);
}
function movementFixture(){
    const roomName='W20N25',target='W20N24';let obstacles=[],occupants=[],exits=[17,18,19,20].map(x=>({x,y:49,roomName})),scans=0,searches=0,routes=0;
    const room={name:roomName,find(type){if(type===C.FIND_STRUCTURES){scans++;return obstacles;}if(type===C.FIND_CREEPS)return occupants;if(type===C.FIND_EXIT_BOTTOM)return exits;return [];}};
    const goals=[],counts={},ctx=vm.createContext({...C,Memory:{frontier:{intel:{}}},Game:{time:1000,map:{getRoomStatus:()=>({status:'normal'}),findRoute:(from,to,options)=>{routes++;return options.routeCallback(to)===Infinity?C.ERR_NO_PATH:[{room:to,exit:C.FIND_EXIT_BOTTOM}];}}},RoomPosition:class{constructor(x,y,roomName){Object.assign(this,{x,y,roomName});}}});
    const c={id:'traveler',name:'traveler',room,memory:{role:'claimer',home:roomName,target},fatigue:0,pos:{x:19,y:48,roomName,findClosestByPath(list){searches++;return list.filter(p=>Math.max(Math.abs(p.x-this.x),Math.abs(p.y-this.y))<=1).at(-1)||list[0];}},moveTo(p,options){goals.push({x:p.x,y:p.y,options,hadPath:!!this.memory._move});return C.OK;}};
    const movement=load(ctx,'movement',{metrics:{movementCount:n=>{counts[n]=(counts[n]||0)+1;}}});
    return {ctx,c,room,goals,counts,movement,target,run:()=>movement.travel(c,target),scans:()=>scans,searches:()=>searches,routes:()=>routes,
        obstacles:v=>{obstacles=v;},occupants:v=>{occupants=v;},exits:v=>{exits=v;},wall:(x=20)=>({structureType:C.STRUCTURE_WALL,pos:{x,y:49,roomName}})};
}
let m=movementFixture();m.obstacles([m.wall()]);m.run();assert.deepEqual(m.goals.map(p=>[p.x,p.y]),[[19,49]],'Range-one reachable walled endpoint is not a passable exit');
m=movementFixture();m.obstacles([m.wall()]);Object.assign(m.c.memory,{travelExit:{key:'W20N25>W20N24:5',x:20,y:49,at:918},stuck:248,last:'W20N25:19,48',moveAttempt:999,moveTarget:'W20N25:20,49:0',_move:{path:'20494'}});m.run();assert.equal(m.goals[0].x,19);assert.equal(m.goals[0].hadPath,false);assert.equal(m.c.memory.travelExitAvoid[0].until,1050);
m=movementFixture();for(let i=0;i<6;i++){m.ctx.Game.time=1000+i;m.run();}assert.equal(m.goals.at(-1).x,19);assert.equal(m.scans(),2);assert.equal(m.c.memory.travelExitAvoid[0].x,20);
m=movementFixture();m.obstacles([17,18,19,20].map(x=>m.wall(x)));for(let i=0;i<10;i++){m.ctx.Game.time=1000+i;m.run();}assert.equal(m.scans(),1);assert.equal(m.goals.length,0);m.obstacles([]);m.ctx.Game.time=1010;m.run();assert.equal(m.goals.length,1);
for(const [properties,expected] of [[{my:false,isPublic:false},19],[{my:false,isPublic:true},20],[{my:true,isPublic:false},20]]){m=movementFixture();m.obstacles([{structureType:C.STRUCTURE_RAMPART,pos:{x:20,y:49},...properties}]);m.run();assert.equal(m.goals[0].x,expected);}
m=movementFixture();m.occupants([{id:'other',pos:{x:20,y:49}}]);m.run();assert.equal(m.goals[0].x,19);
m=movementFixture();m.movement.go(m.c,{x:20,y:20},1,{owner:'defense'});assert.equal(m.goals.length,1);assert.equal(m.c.memory.movement.owner,'defense');assert.equal(m.goals[0].options.owner,undefined);assert.equal(m.movement.go(m.c,{x:30,y:30}),C.ERR_BUSY);assert.equal(m.goals.length,1,'Later task cannot overwrite an immediate accepted move');
m.ctx.Game.time++;m.c.pos.x=20;m.c.pos.y=20;m.c.memory.stuck=8;assert.equal(m.movement.go(m.c,{x:20,y:21}),C.OK);assert.equal(m.c.memory.stuck,0);assert.equal(m.c.memory.movement.state,'in-range');assert.equal(m.goals.length,1);
m.ctx.Game.time++;m.c.fatigue=2;m.c.memory.stuck=8;assert.equal(m.movement.go(m.c,{x:30,y:30}),C.ERR_TIRED);assert.equal(m.c.memory.stuck,0);assert.equal(m.c.memory.moveAttempt,undefined);assert.equal(m.goals.length,1);
m.ctx.Game.time++;m.c.fatigue=0;m.movement.go(m.c,{x:30,y:30});assert.equal(m.c.memory.stuck,0,'Fatigue is not a failed attempted step');
m=movementFixture();for(let i=0;i<80;i++){m.ctx.Game.time=1000+i;m.c.memory.last='prior-progress';m.run();}assert.equal(m.routes(),1);assert.equal(m.searches(),1);m.ctx.Memory.frontier.intel[m.target]={seen:1080,hostiles:1};m.ctx.Game.time=1080;m.run();assert.equal(m.routes(),2);assert.equal(m.goals.length,80,'Fresh hostile intel invalidates cached travel immediately');
m=movementFixture();let attempts=0;m.c.moveTo=()=>++attempts===1?C.ERR_NO_PATH:C.OK;
assert.equal(m.movement.go(m.c,{x:10,y:10}),C.ERR_NO_PATH);assert.equal(m.movement.go(m.c,{x:11,y:10}),C.OK);assert.equal(attempts,2,'Unsubmitted failed path may try a different port');assert.equal(m.movement.go(m.c,{x:12,y:10}),C.ERR_BUSY);assert.equal(attempts,2);
m=movementFixture();m.c.memory._move={path:'cached'};m.movement.go(m.c,{x:10,y:10});assert.equal(m.goals[0].hadPath,true,'A valid preexisting engine path survives the first owner call');
console.log('PASS movement: immediate single owner, range/fatigue rest, cache reuse, exact blocked exits and bounded recovery');
function missionFixture(){
    const homeName='W21N26',targetName='W21N25';
    function room(name,my,level){const sourceList=[{id:name+'a',pos:{x:10,y:10}},{id:name+'b',pos:{x:30,y:30}}];return{name,sourceList,spawns:[],sites:[],structures:[],controller:{my,owner:my?{username:'AdamZmy'}:undefined,level,pos:{x:20,y:20}},storage:{store:{energy:20000}},energyAvailable:1300,find(k){if(k===C.FIND_SOURCES)return sourceList;if(k===C.FIND_MY_SPAWNS)return this.spawns;if(k===C.FIND_MY_CONSTRUCTION_SITES)return this.sites;if(k===C.FIND_STRUCTURES)return this.structures;return [];},getTerrain:()=>({get:()=>0}),createConstructionSite(){throw Error('Mission/planner must only request construction');}};}
    const home=room(homeName,true,4),target=room(targetName,false,1);home.spawns=[{id:'home-spawn'}];
    function unit(role,where,source,n=5){return{name:role+':'+source,room:where,pos:{...(where.sourceList.find(s=>s.id===source)||{pos:{x:25,y:25}}).pos},memory:{role,home:where.name,source},ticksToLive:1000,getActiveBodyparts:p=>p===C.WORK&&['miner','pioneer'].includes(role)?n:p===C.CARRY&&role==='hauler'?n:0};}
    const history=Array.from({length:6},(_,i)=>({bank:10000+i*100}));
    const plan={complete:true,anchor:{x:25,y:25},structures:[{x:25,y:25,type:C.STRUCTURE_SPAWN,rcl:1,priority:100}],sourcePlans:[{pathLength:10},{pathLength:15}]};
    const root={rooms:{[homeName]:{},[targetName]:{plan}},intel:{[homeName]:{terrain:{plain:1500,swamp:0}},[targetName]:{seen:1000,controller:{},sources:[{},{}],exits:{1:homeName},terrain:{plain:1500,swamp:0},hostiles:0}},status:{cpu:8},telemetry:{cpuEMA:8,alerts:{},rooms:{[homeName]:{tick:1000,history},[targetName]:{tick:1000,history,upgradeEMA:.5}}}};
    let planCalls=0,travels=[];
    const ctx=vm.createContext({...C,console:{log(){}},Memory:{frontier:root},Game:{time:1000,cpu:{bucket:9000},gcl:{level:7},rooms:{[homeName]:home},creeps:{a:unit('miner',home,homeName+'a'),b:unit('miner',home,homeName+'b'),h:unit('hauler',home,null,8)},map:{describeExits:()=>({3:targetName})}}});
    const expansion=load(ctx,'expansion',{movement:{allowed:()=>true,route:()=>[{room:targetName,exit:3}],travel:(c,t)=>{travels.push(t);return c.room.name===t;},go(){}},planner:{ensure(){planCalls++;throw Error('Scout must not run planning');}}});
    return {home,target,homeName,targetName,root,ctx,expansion,unit,travels,planCalls:()=>planCalls,tick:()=>expansion.tick([home])};
}
let f=missionFixture();f.tick();assert.equal(f.root.expansion.state,'ready');assert.equal(f.root.expansion.target,f.targetName);assert.equal(f.planCalls(),0);f.ctx.Game.time++;f.tick();assert.equal(f.root.expansion.state,'claiming');
const requests=f.expansion.spawnRequests(f.home);assert.deepEqual(Array.from(requests,r=>r.role),['scout','claimer','pioneer','pioneer']);for(const r of requests){assert(r.id&&r.owner&&r.slotKey&&r.memory&&r.body.length&&r.expiresAt>f.ctx.Game.time);assert.equal(r.home,f.homeName);}
const slots=Array.from(requests,r=>r.slotKey);assert.equal(new Set(slots).size,4);const survivor=f.unit('pioneer',f.home);survivor.memory={...requests.find(r=>r.slotKey.endsWith(':pioneer:1')).memory};f.ctx.Game.creeps.pioneer=survivor;assert(f.expansion.spawnRequests(f.home).some(r=>r.slotKey.endsWith(':pioneer:0')),'A surviving second slot does not suppress the empty first slot');
f.expansion.record(f.target);assert.equal(f.planCalls(),0);assert.equal(f.root.intel[f.targetName].source,'vision');
f.ctx.Game.rooms[f.targetName]=f.target;f.target.controller.my=true;f.target.controller.owner={username:'AdamZmy'};f.tick();assert.equal(f.root.expansion.state,'bootstrapping');const siteRequests=f.expansion.constructionRequests(f.target);assert.equal(siteRequests.length,1);assert.equal(siteRequests[0].structureType,C.STRUCTURE_SPAWN);assert.equal(siteRequests[0].owner,'expansion');
f.target.spawns=[{id:'colony-spawn'}];survivor.room=f.target;f.tick();const handover=f.root.expansion.handoverAt;assert.equal(f.root.expansion.state,'stabilizing');assert.equal(survivor.memory.home,f.targetName);assert.equal(survivor.memory.role,'bootstrap');assert.equal(survivor.memory.operationId,undefined);assert.equal(f.expansion.spawnRequests(f.home).filter(r=>r.role!=='scout').length,0);
f.ctx.Game.time++;f.tick();assert.equal(f.root.expansion.handoverAt,handover,'Handover does not repeat');delete f.ctx.Game.rooms[f.targetName];assert.equal(f.expansion.spawnRequests(f.home).filter(r=>r.role!=='scout').length,0,'Missing vision after handover must not relaunch pioneers');f.ctx.Game.rooms[f.targetName]=f.target;
f.target.controller.level=2;f.ctx.Game.creeps.ta=f.unit('miner',f.target,f.targetName+'a',2);f.ctx.Game.creeps.tb=f.unit('miner',f.target,f.targetName+'b',2);f.ctx.Game.creeps.th=f.unit('hauler',f.target,null,2);f.tick();assert.equal(f.root.expansion.state,'stabilizing','Spawn and imported workforce alone do not prove local births');
f.ctx.Game.creeps.ta.memory.birthRoom=f.targetName;f.ctx.Game.creeps.ta.memory.bornAt=f.ctx.Game.time;f.ctx.Game.creeps.ta.spawning=true;f.tick();assert.equal(f.root.expansion.localBirth,undefined);f.ctx.Game.creeps.ta.spawning=false;f.tick();assert(f.root.expansion.localBirth);assert.equal(f.root.expansion.state,'stabilizing');
f.ctx.Game.creeps.tb.pos={x:45,y:45};f.ctx.Game.time++;f.tick();assert.equal(f.root.expansion.stableSince,undefined,'Assigned miners away from the source do not prove a working colony');f.ctx.Game.creeps.tb.pos={...f.target.sourceList[1].pos};f.tick();assert(Number.isFinite(f.root.expansion.stableSince));
f.ctx.Game.time+=101;f.tick();assert.equal(f.root.expansion.stableSince,undefined,'Stale upgrade telemetry cannot maintain the stable window');f.root.telemetry.rooms[f.targetName].tick=f.ctx.Game.time;f.tick();
f.ctx.Game.time+=99;f.root.telemetry.rooms[f.targetName].tick=f.ctx.Game.time;f.tick();assert.equal(f.root.expansion.state,'stabilizing');f.ctx.Game.time++;f.root.telemetry.rooms[f.targetName].tick=f.ctx.Game.time;f.tick();assert.equal(f.root.expansion.state,'complete');const completed=JSON.stringify(f.root.expansion);f.target.spawns=[];f.ctx.Game.time++;f.tick();assert.equal(JSON.stringify(f.root.expansion),completed,'Previously completed mission remains completed');
f=missionFixture();f.tick();f.ctx.Game.creeps.b.ticksToLive=80;f.ctx.Game.time++;f.tick();assert.equal(f.root.expansion.state,'paused');assert.equal(f.root.expansion.reason,'mother economy needs recovery');assert.equal(f.expansion.spawnRequests(f.home).filter(r=>r.role!=='scout').length,0);f.ctx.Game.creeps.b.ticksToLive=1000;f.ctx.Game.time++;f.tick();assert.equal(f.root.expansion.state,'claiming');
f.ctx.Game.rooms[f.targetName]=f.target;f.target.controller.owner={username:'other'};f.tick();assert.equal(f.root.expansion.state,'blocked');assert.equal(f.root.expansion.reason,'target claimed by another player');
f=missionFixture();f.tick();const operation=f.root.expansion.id;f.ctx.Game.creeps.p=f.unit('pioneer',f.home);Object.assign(f.ctx.Game.creeps.p.memory,{operationId:operation,target:f.targetName,slotKey:'mission-slot',travelExit:{x:1,y:1},_move:{path:'123'}});f.expansion.cancel('user cancelled');assert.equal(f.root.expansion.state,'aborting');for(const k of ['operationId','slotKey','travelExit','_move'])assert.equal(f.ctx.Game.creeps.p.memory[k],undefined);assert.equal(f.expansion.spawnRequests(f.home).filter(r=>r.role!=='scout').length,0);assert.equal(f.expansion.constructionRequests(f.target).length,0);
for(const gate of ['storage','cpu','coverage','rooms']){f=missionFixture();if(gate==='storage')f.home.storage.store.energy=11999;if(gate==='cpu')f.root.telemetry.cpuEMA=17;if(gate==='coverage')f.ctx.Game.creeps.b.ticksToLive=80;if(gate==='rooms'){f.root.maxRooms=7;f.expansion.tick([f.home,f.home,f.home]);}else f.tick();assert.equal(f.root.expansion,undefined,gate+' gate remains enforced');}
console.log('PASS missions: request-only owners, scout facts, funding/coverage/room gates, local birth + stable handover, cancellation and completed mission preservation');
// Exact cold archive failures must retain receipts; no implicit replacement map.
for(const saved of [null,{load:()=>({version:2,structures:[]})}]){
    const receipt={version:3,complete:true,archiveId:'known'},root={rooms:{W22N26:{plan:receipt}},intel:{}};
    const ctx=vm.createContext({...C,Memory:{frontier:root},Game:{time:1,rooms:{}},RoomPosition:class{}});
    const planner=load(ctx,'planner',{plans:saved});const result=planner.ensure({name:'W22N26',controller:{my:true}});
    assert.equal(result,receipt);assert.equal(root.rooms.W22N26.planRecovery.status,'blocked');
}
f=missionFixture();f.target.controller.my=true;f.target.controller.level=1;f.root.rooms[f.targetName].plan.structures.push({x:26,y:25,type:C.STRUCTURE_RAMPART,rcl:1,priority:200});
const planner=load(f.ctx,'planner',{plans:null});const candidates=planner.constructionRequests(f.target);assert.equal(candidates.length,1);assert.equal(candidates[0].structureType,C.STRUCTURE_SPAWN);assert.equal(candidates[0].owner,'planner');assert.equal(typeof candidates[0].minRCL,'number');
for(const name of ['planner.js','expansion.js']){const source=readSource(name);assert(!/\.spawnCreep\s*\(/.test(source),name+' has no spawn execution');assert(!/\.createConstructionSite\s*\(/.test(source),name+' has no construction execution');}
console.log('PASS planning: exact archive receipt retention, construction candidates and independent rampart exclusion');
