'use strict';
const {baseUpgradePolicy,economyMemory,routeTravel,updateEconomy,upgradePolicy}=require('colony');
const {mine}=require('mining');
const {E,vals,range,energy,availableEnergy,near,go,take,give,alive,allCreeps,roomCreeps,structures,myStructures,spawns,constructionSites,drops,tombstones,ruins,sources,stores,miningSpots}=require('runtime');
let upgradeIntentTick=-1,upgradeActors=new Set();
let upgraderCacheTick=-1,upgraderCache={};
let stationCacheTick=-1,stationCache={};
let constructionCacheTick=-1,constructionCache={};
const WORKER_ROLES=new Set(['upgrader','builder','repairman']);
const BUILDER_TRAIL_LIMIT=32;
function workerRole(c) {
    const memory=c&&c.memory||{};
    if(memory.role==='worker')return WORKER_ROLES.has(memory.workRole)?memory.workRole:'upgrader';
    return WORKER_ROLES.has(memory.role)?memory.role:null;
}
function isWorker(c) { return !!workerRole(c); }
function setWorkerRole(c,role) {
    c.memory.role='worker';c.memory.unitType='worker';c.memory.workRole=role;
}
function upgrade(c) {
    const t=c.room.controller;if(!t||!t.my)return;
    if(upgradeIntentTick!==Game.time){upgradeIntentTick=Game.time;upgradeActors=new Set();}
    if(upgradeActors.has(c))return;
    upgradeActors.add(c);
    const result=c.upgradeController(t);recordDevelopment(c,'upgrade',result);
    if(result===ERR_NOT_IN_RANGE)go(c,t,3);
}
function upgraderAssignment(room) {
    if(upgraderCacheTick!==Game.time){upgraderCacheTick=Game.time;upgraderCache={};}
    if(upgraderCache[room.name]&&upgraderCache[room.name].room===room)return upgraderCache[room.name].value;
    const assignment=workerAssignment(room);
    const value={policy:assignment.policy,primary:assignment.upgraders,support:[],builders:assignment.builders,repairmen:assignment.repairmen,
        workers:assignment.workers,builderCount:assignment.builderCount,repairmanCount:assignment.repairmanCount,building:assignment.building};
    upgraderCache[room.name]={room,value};return value;
}
function upgradeAllowed(c,assignment=upgraderAssignment(c.room)) {
    // Worker count is the room-level capacity. Role conversion, rather than
    // an old per-role budget, decides whether this worker is upgrading.
    return assignment.primary.includes(c);
}
function workerAssignment(room) {
    delete upgraderCache[room.name];
    const policy=upgradePolicy(room);
    const all=allCreeps().filter(c=>!c.spawning&&c.room&&c.room.name===room.name);
    const workers=all.filter(isWorker);
    const jobs=constructionJobs(room),repairs=criticalRepairs(room);
    const building=jobs.length>0||repairs.length>0;
    // Critical maintenance takes the temporary half-pool first. Ordinary
    // construction uses the same half-pool when no repairman is required.
    const taskRole=repairs.length?'repairman':jobs.length?'builder':'upgrader';
    const taskCount=taskRole==='upgrader'?0:Math.floor(workers.length/2);
    const fullWork=workerBodyWork(room);
    const candidates=workers.slice().sort((a,b)=>
        Number(a.getActiveBodyparts(WORK)!==fullWork)-Number(b.getActiveBodyparts(WORK)!==fullWork)||
        (b.ticksToLive||0)-(a.ticksToLive||0)||a.name.localeCompare(b.name));
    const taskWorkers=new Set(candidates.slice(0,taskCount));
    const builders=[],repairmen=[],upgraders=[];
    for(const c of workers){
        const role=taskWorkers.has(c)?taskRole:'upgrader';
        if(workerRole(c)!==role||c.memory.role!=='worker'){
            setWorkerRole(c,role);
            c.memory.workerRoleSince=Game.time;
            delete c.memory.workJob;
            if(role!=='builder')clearBuilderTrajectory(c);
        }
        if(role==='builder')markBuilderTrajectory(c);
        if(role==='builder')builders.push(c);
        else if(role==='repairman')repairmen.push(c);
        else upgraders.push(c);
    }
    return {policy,workers,upgraders,builders,repairmen,builderCount:builders.length,repairmanCount:repairmen.length,building,jobs,repairs,fullWork};
}
function workerBodyWork(room) {
    const budget=room&&Number.isFinite(room.energyCapacityAvailable)?room.energyCapacityAvailable:0;
    const parts=budget>=200?bodyForWorker(budget):null;
    return parts?parts.filter(p=>(p.type||p)===WORK).length:0;
}
function bodyForWorker(budget,workLimit=50) {
    for(let work=Math.min(50,Math.floor(budget/BODYPART_COST[WORK]),workLimit);work>=1;work--){
        const carry=Math.max(1,Math.ceil(work*.5));
        const move=Math.max(1,Math.ceil((work+carry)/2));
        if(work+carry+move<=50&&work*BODYPART_COST[WORK]+carry*BODYPART_COST[CARRY]+move*BODYPART_COST[MOVE]<=budget)
            return Array(work).fill(WORK).concat(Array(carry).fill(CARRY),Array(move).fill(MOVE));
    }
    return null;
}
function setWorkerState(c,state) {
    if(!isWorker(c)&&c.memory.role!=='bootstrap')return;
    if(c.memory.workerState!==state){c.memory.workerState=state;c.memory.workerStateSince=Game.time;}
}
function clearBuilderTrajectory(c) {
    delete c.memory.builderTrail;delete c.memory.builderTrailTask;delete c.memory.builderTrailRoom;
}
function markBuilderTrajectory(c) {
    if(workerRole(c)!=='builder'||!c.pos)return;
    const task=c.memory.workJob||'unassigned',roomName=c.room&&c.room.name;
    if(c.memory.builderTrailTask!==task||c.memory.builderTrailRoom!==roomName){
        c.memory.builderTrail=[];c.memory.builderTrailTask=task;c.memory.builderTrailRoom=roomName;
    }
    const trail=c.memory.builderTrail,last=trail[trail.length-1];
    if(!last||last.x!==c.pos.x||last.y!==c.pos.y||last.t!==Game.time){
        trail.push({x:c.pos.x,y:c.pos.y,t:Game.time});
        if(trail.length>BUILDER_TRAIL_LIMIT)trail.splice(0,trail.length-BUILDER_TRAIL_LIMIT);
    }
    const visual=c.room&&c.room.visual;
    if(visual&&typeof visual.poly==='function'&&trail.length>1)
        visual.poly(trail.map(p=>({x:p.x,y:p.y})),{stroke:'#f59e0b',width:.15,opacity:.65});
    if(visual&&typeof visual.circle==='function')visual.circle(c.pos.x,c.pos.y,{radius:.35,fill:'#f59e0b',opacity:.7});
}
function walkable(room,p) {
    return p.x>0&&p.y>0&&p.x<49&&p.y<49&&!(room.getTerrain().get(p.x,p.y)&TERRAIN_MASK_WALL)&&
        !room.lookForAt(LOOK_STRUCTURES,p.x,p.y).some(s=>OBSTACLE_OBJECT_TYPES.includes(s.structureType)||s.structureType===STRUCTURE_RAMPART&&!s.my&&!s.isPublic)&&
        !sources(room).some(s=>range(s,p)===0)&&(!room.controller||range(room.controller,p)!==0);
}
function controllerStation(room) {
    if(stationCacheTick!==Game.time){stationCacheTick=Game.time;stationCache={};}
    if(stationCache[room.name]&&stationCache[room.name].room===room){
        const cached=stationCache[room.name].value;
        if(cached&&Game.getObjectById(cached.node.id)===cached.node)return cached;
        delete stationCache[room.name];
    }
    const ctrl=room.controller;if(!ctrl||!ctrl.my)return null;
    const m=economyMemory(room),plan=m.plan,ss=sources(room);
    const nodes=stores(room).filter(s=>[STRUCTURE_CONTAINER,STRUCTURE_LINK].includes(s.structureType)&&range(s,ctrl)<=3&&!ss.some(src=>range(src,s)<=1));
    // Keep the container's four seats while it exists. A later link can feed
    // adjacent seats; losing the container rebuilds the station around the link.
    nodes.sort((a,b)=>Number(a.structureType===STRUCTURE_LINK)-Number(b.structureType===STRUCTURE_LINK)||range(a,ctrl)-range(b,ctrl));
    const node=nodes[0];if(!node){delete m.upgradeStation;stationCache[room.name]={room,value:null};return null;}
    const key=nodes.map(s=>s.id).join(',')+':'+ctrl.level+':'+(plan&&plan.version||0)+':'+(plan&&plan.structures||[]).length;
    let station=m.upgradeStation;
    if(!station||station.key!==key||station.until<=Game.time||station.until>Game.time+25||
        ![station.port,...station.seats].every(p=>walkable(room,p))){
        const future=new Set((plan&&plan.structures||[]).filter(s=>OBSTACLE_OBJECT_TYPES.includes(s.type)).map(s=>s.x+50*s.y));
        const roads=new Set((plan&&plan.structures||[]).filter(s=>s.type===STRUCTURE_ROAD).map(s=>s.x+50*s.y));
        const core=plan&&(plan.roadCore||plan.anchor)||spawns(room)[0]?.pos||{x:25,y:25};
        const options=[];
        for(let y=node.pos.y-1;y<=node.pos.y+1;y++)for(let x=node.pos.x-1;x<=node.pos.x+1;x++){
            const p={x,y};if(walkable(room,p)&&!future.has(x+50*y)&&range(ctrl,p)<=3)options.push(p);
        }
        options.sort((a,b)=>Number(roads.has(b.x+50*b.y))-Number(roads.has(a.x+50*a.y))||range(a,core)-range(b,core)||range(ctrl,b)-range(ctrl,a));
        const port=options.shift();if(!port){delete m.upgradeStation;stationCache[room.name]={room,value:null};return null;}
        // Planned approach roads stay open, including the second access route.
        const seats=options.filter(p=>!roads.has(p.x+50*p.y));
        station=m.upgradeStation={key,node:node.id,port,seats,until:Game.time+25};
    }
    const value={...station,node,nodes};stationCache[room.name]={room,value};return value;
}
function stationUpgrade(c,assignment) {
    const station=controllerStation(c.room),avoid=c.memory.stationAvoid;
    if(!station||avoid&&avoid.until>Game.time&&avoid.id===station.node.id){delete c.memory.upgradeSeat;return false;}
    // Seat count is physical. A stronger viable successor must not wait behind
    // a one-WORK incumbent just because the latter claimed the seat first.
    const peers=assignment.primary.slice().sort((a,b)=>Number(alive(b))-Number(alive(a))||b.getActiveBodyparts(WORK)-a.getActiveBodyparts(WORK)||
        Number(!!b.memory.upgradeSeat)-Number(!!a.memory.upgradeSeat)||a.name.localeCompare(b.name)).slice(0,station.seats.length);
    const used=new Set(),key=p=>p.x+50*p.y;
    for(const peer of assignment.primary){const seat=peer.memory.upgradeSeat;
        if(peers.includes(peer)&&seat&&seat.id===station.node.id&&station.seats.some(p=>key(p)===key(seat))&&!used.has(key(seat)))used.add(key(seat));
        else delete peer.memory.upgradeSeat;
    }
    for(const peer of peers)if(!peer.memory.upgradeSeat){
        const seat=station.seats.filter(p=>!used.has(key(p))).sort((a,b)=>range(peer,a)-range(peer,b))[0];
        if(seat){peer.memory.upgradeSeat={id:station.node.id,x:seat.x,y:seat.y};used.add(key(seat));}
    }
    const seat=c.memory.upgradeSeat;if(!seat)return false;
    delete c.memory.haulSupply;delete c.memory.refuelTarget;
    const held=energy(c),work=c.getActiveBodyparts(WORK),capacity=held+c.store.getFreeCapacity(E);
    if(!held&&!station.nodes.some(s=>availableEnergy(s)>0)){
        if(c.memory.stationEmptySince===undefined)c.memory.stationEmptySince=Game.time;
        if(Game.time-c.memory.stationEmptySince>=20){c.memory.stationAvoid={id:station.node.id,until:Game.time+25};delete c.memory.upgradeSeat;return false;}
    }else delete c.memory.stationEmptySince;
    // Withdrawal and upgrading use separate intents. An empty creep cannot
    // issue upgrade at tick start merely because its withdrawal will succeed.
    if(held<=Math.min(capacity/2,Math.max(work*3,1))){
        const supply=station.nodes.filter(s=>range(c,s)<=1&&availableEnergy(s)>0).sort((a,b)=>Number(b.structureType===STRUCTURE_LINK)-Number(a.structureType===STRUCTURE_LINK))[0];
        if(supply)take(c,supply);
    }
    if(held>0&&(c.room.controller.ticksToDowngrade<4000||c.room.controller.level===1||upgradeAllowed(c,assignment)))upgrade(c);
    if(c.pos.x!==seat.x||c.pos.y!==seat.y){
        const result=go(c,new RoomPosition(seat.x,seat.y,c.room.name),0);
        if(result===ERR_NO_PATH||!c.fatigue&&c.memory.stuck>=6){
            c.memory.stationAvoid={id:station.node.id,until:Game.time+15};delete c.memory.upgradeSeat;delete c.memory._move;
        }
    }
    return true;
}
function overflowUpgrade(c,assignment) {
    const station=controllerStation(c.room);
    if(!station||c.memory.upgradeSeat||c.memory.stationAvoid&&c.memory.stationAvoid.until>Game.time)return false;
    const plan=economyMemory(c.room).plan,roads=new Set((plan&&plan.structures||[]).filter(s=>s.type===STRUCTURE_ROAD||OBSTACLE_OBJECT_TYPES.includes(s.type)).map(s=>s.x+50*s.y));
    const peers=roomCreeps(c.room).filter(o=>o!==c);
    const allowed=p=>range(c.room.controller,p)<=3&&walkable(c.room,p)&&!roads.has(p.x+50*p.y)&&
        ![station.port,...station.seats].some(s=>range(s,p)===0)&&
        !peers.some(o=>range(o,p)===0||o.memory.upgradeParking&&range(o.memory.upgradeParking,p)===0);
    let parking=c.memory.upgradeParking;
    if(!parking||parking.id!==station.node.id||!allowed(parking)){
        const options=[];
        for(let y=c.room.controller.pos.y-3;y<=c.room.controller.pos.y+3;y++)for(let x=c.room.controller.pos.x-3;x<=c.room.controller.pos.x+3;x++)if(allowed({x,y}))options.push({x,y});
        parking=options.sort((a,b)=>range(c,a)-range(c,b))[0];
        if(parking)c.memory.upgradeParking={id:station.node.id,x:parking.x,y:parking.y};else delete c.memory.upgradeParking;
    }
    // Clear the port/access road before a refuel or upgrade can hold it again.
    const blocking=[station.port,...station.seats].some(p=>range(c,p)===0)||roads.has(c.pos.x+50*c.pos.y)&&range(c,station.node)<=2;
    if(blocking){if(parking)go(c,new RoomPosition(parking.x,parking.y,c.room.name),0);else require('logistics').clearStationTraffic(c);return true;}
    if(!parking){require('logistics').haul(c);return true;}
    if(!energy(c)){
        c.memory.loaded=false;
        // Overflow uses ordinary source/core stock, never a port-side retreat
        // to the same fixed controller node it was asked to clear.
        refuel(c,true,true);return true;
    }
    if(range(c,parking)>0){go(c,new RoomPosition(parking.x,parking.y,c.room.name),0);return true;}
    c.memory.loaded=true;
    if(c.room.controller.ticksToDowngrade<4000||c.room.controller.level===1||upgradeAllowed(c,assignment))upgrade(c);
    return true;
}
function workerSupply(c,job) {
    const room=c.room,station=controllerStation(room),old=c.memory.workSupply;
    let target=old&&old.job===job.id&&old.room===room.name&&Game.getObjectById(old.id);
    const excluded=s=>station&&station.nodes.some(n=>n.id===s.id);
    const avoid=c.memory.refuelAvoid,allowed=s=>!excluded(s)&&(!avoid||avoid.until<=Game.time||avoid.id!==s.id);
    if(target&&(!target.store||!allowed(target)))target=null;
    const depleted=target&&availableEnergy(target)<=0;
    if(depleted){
        if(old.emptySince===undefined)old.emptySince=Game.time;
        // Keep the fixed building's refill request alive while the worker can
        // still use general self-refuel recovery during a short stock outage.
        if(Game.time-old.emptySince<20)return false;
        target=null;
    }else if(target)delete old.emptySince;
    if(!target){
        const candidates=stores(room).filter(s=>[STRUCTURE_CONTAINER,STRUCTURE_STORAGE,STRUCTURE_LINK].includes(s.structureType)&&availableEnergy(s)>0&&allowed(s));
        candidates.sort((a,b)=>range(job,a)-range(job,b));
        // Check reachability once per binding, rather than chasing a worker or
        // reconsidering a closer drop while the worker travels for a full batch.
        for(const candidate of candidates)if(near(c,[candidate])){target=candidate;break;}
        if(target)c.memory.workSupply={id:target.id,job:job.id,room:room.name};else if(!depleted)delete c.memory.workSupply;
    }
    if(!target)return false;
    const position=c.pos.x+','+c.pos.y;let task=c.memory.refuelTarget;
    if(!task||task.id!==target.id)task=c.memory.refuelTarget={id:target.id,kind:'take',room:room.name,position,progress:Game.time};
    if(task.position!==position||c.fatigue){task.position=position;task.progress=Game.time;}
    const result=take(c,target);
    if(result===OK){task.progress=Game.time;return true;}
    if(result===ERR_NOT_IN_RANGE&&Game.time-task.progress<=15&&go(c,target)!==ERR_NO_PATH)return true;
    c.memory.refuelAvoid={id:target.id,until:Game.time+15};delete c.memory.refuelTarget;delete c.memory.workSupply;return false;
}
function workReady(c) {
    return energy(c)>0&&(c.memory.loaded||c.store.getFreeCapacity(E)===0||isWorker(c));
}
// Readiness and accepted intents are diagnostics, not a spending valve. The
// ledger remains the authority for actual engine expenditure and RCL8 limits.
let developmentTick=-1,developmentPlans={};
function developmentPlan(room) {
    const m=economyMemory(room);
    if(developmentTick!==Game.time){developmentTick=Game.time;developmentPlans={};}
    const cached=developmentPlans[room.name];if(cached&&cached.room===room&&cached.memory===m)return cached;
    delete m.developmentCredit;
    const control=m.economyControl,assignment=workerAssignment(room),jobs=assignment.jobs;
    const requests=[],reserved={};let upgradeReady=0;
    const workers=allCreeps().slice().sort((a,b)=>Number(!!(jobs[0]&&range(b,jobs[0])<=3))-Number(!!(jobs[0]&&range(a,jobs[0])<=3))||a.name.localeCompare(b.name));
    for(const c of workers){
        if(c.spawning||c.room.name!==room.name||!energy(c))continue;
        const work=c.getActiveBodyparts(WORK);if(!work)continue;
        const yielding=c.memory.yieldSource&&Game.getObjectById(c.memory.yieldSource);
        if(yielding&&range(c,yielding)<=1)continue;
        if(assignment.upgraders.includes(c)){
            if(!room.controller.upgradeBlocked&&range(c,room.controller)<=3)upgradeReady+=Math.min(work,energy(c));
            continue;
        }
        if(workerRole(c)!=='builder'&&c.memory.role!=='bootstrap')continue;
        const candidates=jobs.filter(target=>!Number.isFinite(target.progressTotal)||target.progressTotal-target.progress-(reserved[target.id]||0)>0);
        const previous=candidates.find(target=>target.id===c.memory.workJob);
        const target=previous&&candidates[0]&&previous.structureType===candidates[0].structureType?previous:candidates[0];
        if(!target){delete c.memory.workJob;continue;}c.memory.workJob=target.id;
        if(workerRole(c)==='builder')markBuilderTrajectory(c);
        if(c.memory.role==='bootstrap'&&room.energyAvailable<room.energyCapacityAvailable)continue;
        const ready=range(c,target)<=3;
        const cost=ready?Math.min(work*BUILD_POWER,energy(c),Number.isFinite(target.progressTotal)?Math.max(0,target.progressTotal-target.progress-(reserved[target.id]||0)):Infinity):0;
        requests.push({creep:c,kind:'build',target,cost,ready});if(ready)reserved[target.id]=(reserved[target.id]||0)+cost;
    }
    const plan={room,memory:m,requests,total:control&&control.developmentBudget||0,
        buildDemand:requests.reduce((n,r)=>n+r.cost,0),upgradeDemand:upgradeReady,spent:{build:0,upgrade:0},siteSpent:{},upgraded:new Set()};
    developmentPlans[room.name]=plan;return plan;
}
function recordDevelopment(c,kind,result) {
    const plan=developmentPlan(c.room);if(result!==OK)return;
    if(kind==='upgrade'){
        if(!plan.upgraded.has(c)){plan.upgraded.add(c);plan.spent.upgrade+=Math.min(c.getActiveBodyparts(WORK),energy(c));}
        return;
    }
    const request=plan.requests.find(r=>r.creep===c&&r.kind===kind);if(!request||request.done)return;
    const cost=Math.min(request.cost,Number.isFinite(request.target.progressTotal)?Math.max(0,request.target.progressTotal-request.target.progress-(plan.siteSpent[request.target.id]||0)):Infinity);
    request.done=true;plan.spent.build+=cost;plan.siteSpent[request.target.id]=(plan.siteSpent[request.target.id]||0)+cost;
}
function finishDevelopment(room) {
    const plan=developmentPlan(room);
    // No retry intents or action credits: one creep action is issued by work().
    plan.memory.development={tick:Game.time,budget:plan.total,buildReady:plan.buildDemand,upgradeReady:plan.upgradeDemand,
        buildIntentEnergy:plan.spent.build,upgradeIntentEnergy:plan.spent.upgrade,upgradeThrottled:false,buildThrottled:false};
}
function buildAllowed(c) {
    if(!isWorker(c)&&c.memory.role!=='bootstrap')return true;
    const plan=developmentPlan(c.room),request=plan.requests.find(r=>r.creep===c);
    if(!request||request.done)return false;
    return !Number.isFinite(request.target.progressTotal)||request.target.progressTotal-request.target.progress-(plan.siteSpent[request.target.id]||0)>0;
}
let buildIntentTick=-1,buildActors=new Set();
function build(c,target) {
    if(buildIntentTick!==Game.time){buildIntentTick=Game.time;buildActors=new Set();}
    if(buildActors.has(c))return;
    buildActors.add(c);const result=c.build(target);recordDevelopment(c,'build',result);
    if(result===ERR_NOT_IN_RANGE)go(c,target,3);
}
function refuel(c,harvest=true,protectController=false) {
    const station=controllerStation(c.room),dedicated=station&&(protectController||!(workerRole(c)==='upgrader'&&upgraderAssignment(c.room).primary.includes(c)));
    const protectedStock=t=>dedicated&&station.nodes.some(n=>n.id===t.id);
    const peers=roomCreeps(c.room).filter(o=>o.name!==c.name);
    const free=p=>!peers.some(o=>{
        const reserved=o.memory.refuelTarget;
        return o.pos.x===p.x&&o.pos.y===p.y||o.memory.role==='miner'&&o.memory.spot&&o.memory.spot.x===p.x&&o.memory.spot.y===p.y||
            reserved&&reserved.kind==='harvest'&&reserved.room===c.room.name&&reserved.x===p.x&&reserved.y===p.y&&!o.memory.loaded&&o.store.getFreeCapacity(E)>0&&Game.time-reserved.progress<=15;
    });
    const position=c.pos.x+','+c.pos.y;
    let task=c.memory.refuelTarget,target=task&&Game.getObjectById(task.id);
    if(task&&task.position!==position){task.position=position;task.progress=Game.time;}
    const stalled=task&&!c.fatigue&&Game.time-task.progress>15;
    if(task&&(!target||protectedStock(target)||task.room!==c.room.name||stalled||(task.kind==='harvest'? !harvest||target.energy<=0||!miningSpots(c.room,target).some(p=>p.x===task.x&&p.y===task.y&&free(p)):availableEnergy(target)<=0))){
        if(stalled)c.memory.refuelAvoid={id:task.id,until:Game.time+10};
        delete c.memory.refuelTarget;task=null;target=null;
    }
    if(!task){
        const avoid=c.memory.refuelAvoid,allowed=t=>!avoid||avoid.until<=Game.time||avoid.id!==t.id;
        const dropped=drops(c.room).filter(d=>d.resourceType===E&&d.amount>0&&allowed(d));
        const stock=stores(c.room).filter(s=>[STRUCTURE_CONTAINER,STRUCTURE_STORAGE,STRUCTURE_LINK].includes(s.structureType)&&availableEnergy(s)>0&&allowed(s)&&!protectedStock(s));
        const loot=tombstones(c.room).concat(ruins(c.room)).filter(s=>availableEnergy(s)>0&&allowed(s));
        target=near(c,dropped.concat(stock,loot));
        if(target)task={id:target.id,kind:'take'};
        else if(harvest){
            const ss=sources(c.room).filter(s=>s.energy>0&&allowed(s)).map(s=>({s,spots:miningSpots(c.room,s).filter(free)})).filter(o=>o.spots.length);
            ss.sort((a,b)=>range(c,a.s)-range(c,b.s));
            if(ss.length){const {s,spots}=ss[0];spots.sort((a,b)=>range(c,a)-range(c,b));target=s;task={id:s.id,kind:'harvest',x:spots[0].x,y:spots[0].y};}
        }
        if(!task)return false;
        Object.assign(task,{room:c.room.name,position,progress:Game.time});c.memory.refuelTarget=task;
    }
    const result=task.kind==='harvest'?c.harvest(target):take(c,target);
    if(result===OK){task.progress=Game.time;return true;}
    if(result===ERR_NOT_IN_RANGE){
        const moved=task.kind==='harvest'?go(c,new RoomPosition(task.x,task.y,c.room.name),0):go(c,target);
        if(moved!==ERR_NO_PATH)return true;
    }
    c.memory.refuelAvoid={id:task.id,until:Game.time+10};delete c.memory.refuelTarget;
    return false;
}
function urgentFill(c) {
    const t=near(c,stores(c.room).filter(s=>(s.structureType===STRUCTURE_SPAWN||s.structureType===STRUCTURE_EXTENSION)&&s.my&&s.store.getFreeCapacity(E)>0));
    if(t){give(c,t);return true;}return false;
}
function constructionJobs(room,supportOnly=false) {
    if(constructionCacheTick!==Game.time){constructionCacheTick=Game.time;constructionCache={};}
    const roomSites=constructionSites(room),cacheKey=room.name+':'+Number(supportOnly),cached=constructionCache[cacheKey];if(cached&&cached.room===room&&cached.sites===roomSites)return cached.value;
    const plan=Memory.frontier&&Memory.frontier.rooms&&Memory.frontier.rooms[room.name]&&Memory.frontier.rooms[room.name].plan;
    const roads=new Map((plan&&plan.structures||[]).filter(s=>s.type===STRUCTURE_ROAD).map(s=>[s.x+50*s.y,s]));
    const priority={spawn:110,tower:100,container:96,extension:90,storage:80,link:70,road:40,rampart:30};
    const jobs=roomSites.filter(site=>site.structureType!==STRUCTURE_RAMPART).map(site=>{
        const road=site.structureType===STRUCTURE_ROAD&&roads.get(site.pos.x+50*site.pos.y);
        const economy=!!(road&&road.roadClass==='economy');
        return {site,road,economy,priority:economy?94:priority[site.structureType]||10};
    }).filter(j=>!supportOnly||j.economy||[STRUCTURE_SPAWN,STRUCTURE_TOWER,STRUCTURE_EXTENSION,STRUCTURE_CONTAINER].includes(j.site.structureType));
    jobs.sort((a,b)=>b.priority-a.priority||Number(!!(b.economy&&b.road.roadSwamp))-Number(!!(a.economy&&a.road.roadSwamp))||(b.site.progress||0)-(a.site.progress||0)||(a.economy&&b.economy?(a.road.roadOrder||0)-(b.road.roadOrder||0):0));
    const value=jobs.map(j=>j.site);constructionCache[cacheKey]={room,sites:roomSites,value};return value;
}
// Containers decay independently of the construction queue. Keep the existing
// maintenance health target, but order critical supply nodes by time to loss.
let repairTick=-1,repairIntents={};
function criticalRepairs(room) {
    const ss=sources(room),ctrl=room.controller;
    const bound=new Set(roomCreeps(room).map(c=>c.memory.workSupply&&c.memory.workSupply.id).filter(Boolean));
    return structures(room).filter(s=>s.structureType===STRUCTURE_CONTAINER&&s.hits<s.hitsMax*.55&&
        (ctrl&&range(s,ctrl)<=3||ss.some(source=>range(source,s)<=1)||bound.has(s.id))).map(node=>{
        const decay=typeof CONTAINER_DECAY==='number'?CONTAINER_DECAY:5000;
        const interval=typeof CONTAINER_DECAY_TIME_OWNED==='number'?CONTAINER_DECAY_TIME_OWNED:500;
        return {node,deadline:Game.time+(node.ticksToDecay===undefined?interval:node.ticksToDecay)+Math.max(0,Math.ceil(node.hits/decay)-1)*interval,
            desiredHits:Math.ceil(node.hitsMax*.55),reason:'critical-buffer-maintenance'};
    }).sort((a,b)=>a.deadline-b.deadline||a.node.hits-b.node.hits);
}
function repairCritical(c) {
    if(!energy(c)||!c.getActiveBodyparts(WORK))return false;
    if(repairTick!==Game.time){repairTick=Game.time;repairIntents={};}
    const job=criticalRepairs(c.room).find(r=>r.node.hits+(repairIntents[r.node.id]||0)<r.desiredHits);
    if(!job)return false;
    const result=c.repair(job.node);
    if(result===ERR_NOT_IN_RANGE){go(c,job.node,3);return true;}
    if(result!==OK)return false;
    const repairPower=typeof REPAIR_POWER==='number'?REPAIR_POWER:100;
    repairIntents[job.node.id]=(repairIntents[job.node.id]||0)+Math.min(energy(c),c.getActiveBodyparts(WORK))*repairPower;
    const m=economyMemory(c.room);m.maintenance={tick:Game.time,target:job.node.id,deadline:job.deadline,reason:job.reason};
    return true;
}
function work(c) {
    const ctrl=c.room.controller;
    if(c.memory.yieldSource){
        require('logistics').release(c);
        const source=Game.getObjectById(c.memory.yieldSource);
        if(source&&range(c,source)<=1){const home=spawns(c.room)[0]||ctrl;if(home)go(c,home);return;}
        delete c.memory.yieldSource;
    }
    delete c.memory.haulSupply;
    const assignment=isWorker(c)||c.memory.role==='bootstrap'?workerAssignment(c.room):null;
    if(workerRole(c)==='builder')markBuilderTrajectory(c);
    const ordinaryWork=workerRole(c)==='upgrader'||!c.room.storage||!ctrl||!ctrl.my||ctrl.ticksToDowngrade<4000||ctrl.level===1||constructionJobs(c.room).length||structures(c.room).some(s=>[STRUCTURE_CONTAINER,STRUCTURE_ROAD].includes(s.structureType)&&s.hits<s.hitsMax*.55);
    if(ordinaryWork&&c.memory.role!=='hauler')require('logistics').release(c);
    const maintenanceWorker=!assignment||workerRole(c)==='repairman'||!assignment.repairmen.some(o=>o!==c&&o.getActiveBodyparts(WORK)>0);
    if(maintenanceWorker&&!(ctrl&&ctrl.my&&(ctrl.level===1||ctrl.ticksToDowngrade<4000))&&repairCritical(c)){
        setWorkerState(c,'work');return;
    }
    // Initial carried energy can upgrade while the same tick also withdraws,
    // picks up or moves. Refuel/readiness and seat routing must not hide work.
    if(assignment&&assignment.upgraders.includes(c)&&energy(c)>0&&ctrl&&range(c,ctrl)<=3){
        setWorkerState(c,'work');upgrade(c);
    }
    if(assignment&&assignment.upgraders.includes(c)){
        const upgradeAssignment={...assignment,primary:assignment.upgraders};
        if(stationUpgrade(c,upgradeAssignment)){delete c.memory.upgradeParking;return;}
        if(overflowUpgrade(c,upgradeAssignment))return;
    }
    if(!assignment||!assignment.upgraders.includes(c))delete c.memory.upgradeSeat;
    // Retired construction workers can distribute surplus without withdrawing and
    // returning it to storage as an endless idle job.
    if(c.room.storage&&workerRole(c)!=='upgrader'&&ctrl&&ctrl.my&&ctrl.ticksToDowngrade>=4000&&
        !constructionSites(c.room).length&&
        !structures(c.room).some(s=>[STRUCTURE_CONTAINER,STRUCTURE_ROAD].includes(s.structureType)&&s.hits<s.hitsMax*.55)&&
        (energy(c.room.storage)>0||allCreeps().some(o=>o.room.name===c.room.name&&o.memory.role==='miner'&&o.getActiveBodyparts(WORK)))){require('logistics').haul(c);return;}
    if(!energy(c)) c.memory.loaded=false;
    // Any carried energy can fund useful work; refill only after it runs out.
    if(workReady(c)){c.memory.loaded=true;setWorkerState(c,'work');}
    if(c.memory.loaded)delete c.memory.refuelTarget;
    if(!c.memory.loaded){
        const job=(criticalRepairs(c.room)[0]||{}).node||constructionJobs(c.room,!!assignment)[0];
        setWorkerState(c,'refuel');
        if(job&&workerSupply(c,job)||refuel(c)||!energy(c))return;
        c.memory.loaded=true;
        setWorkerState(c,'work');
    }
    if(ctrl&&ctrl.my&&(ctrl.ticksToDowngrade<4000 || ctrl.level===1)&&c.memory.role!=='bootstrap'){upgrade(c);return;}
    if(c.memory.role==='bootstrap'&&urgentFill(c))return;
    const sites=constructionJobs(c.room);
    if(ctrl&&ctrl.my&&ctrl.level===1){upgrade(c);return;}
    if(workerRole(c)==='builder'&&sites.length){
        const plan=developmentPlan(c.room),assigned=plan.requests.find(r=>r.creep===c&&!r.done);
        const t=assigned&&assigned.target;
        if(t){
            // Travel consumes no construction energy and must not be duty-throttled.
            if(range(c,t)>3){go(c,t,3);return;}
            if(buildAllowed(c)){build(c,t);return;}
        }
        // Every site's remaining work is already covered this tick. Existing
        // fueled builders can only fall back to maintenance here. Role
        // selection will return them to the upgrade pool on the next tick.
        if(ctrl&&ctrl.my&&workerRole(c)==='builder'){upgrade(c);return;}
    }
    const broken=structures(c.room).filter(s=>[STRUCTURE_CONTAINER,STRUCTURE_ROAD].includes(s.structureType)&&s.hits<s.hitsMax*.55);
    const b=near(c,broken);if(b){if(c.repair(b)===ERR_NOT_IN_RANGE)go(c,b,3);return;}
    if((workerRole(c)==='builder'||workerRole(c)==='repairman')&&!constructionJobs(c.room).length&&!criticalRepairs(c.room).length){
        setWorkerRole(c,'upgrader');c.memory.workerRoleSince=Game.time;clearBuilderTrajectory(c);delete c.memory.workJob;
        setWorkerState(c,'work');
    }
    if(c.room.storage&&c.room.storage.store.getFreeCapacity(E)>0){give(c,c.room.storage);return;}
    upgrade(c);
}

// Sole construction intent gateway. Admission uses engine constraints and
// semantic dependencies; physical site capacity is shared across rooms/tick.
let constructionIntentTick=-1,constructionIntents=[],constructionResults={};
function runConstruction(room,requests=[]) {
    if(constructionIntentTick!==Game.time){constructionIntentTick=Game.time;constructionIntents=[];constructionResults={};}
    const m=economyMemory(room),result={tick:Game.time,requested:requests.length,accepted:0,rejected:{},lastError:null};
    const reject=(reason,request,code)=>{result.rejected[reason]=(result.rejected[reason]||0)+1;if(code!==undefined)result.lastError={id:request.id,reason,code};};
    if(!room.controller||!room.controller.my){result.rejected['not-owned']=requests.length;m.construction=result;return result;}
    const built=structures(room),sites=constructionSites(room),pending=constructionIntents.filter(i=>i.room===room.name);
    const at=new Map(),counts={};
    const knownSites=new Set(sites.map(s=>s.pos.x+':'+s.pos.y+':'+s.structureType));
    for(const node of built.concat(sites,pending.filter(i=>!knownSites.has(i.x+':'+i.y+':'+i.structureType)))){
        const type=node.structureType,key=(node.pos?node.pos.x:node.x)+50*(node.pos?node.pos.y:node.y);
        counts[type]=(counts[type]||0)+1;if(!at.has(key))at.set(key,[]);at.get(key).push(node);
    }
    const siteTiles=new Set(sites.concat(pending).map(s=>(s.pos?s.pos.x:s.x)+50*(s.pos?s.pos.y:s.y)));
    const level=room.controller.level,terrain=room.getTerrain(),seen=new Set(),minerals=typeof FIND_MINERALS==='number'?room.find(FIND_MINERALS):[];
    const quota=typeof CONTROLLER_STRUCTURES==='object'?CONTROLLER_STRUCTURES:{};
    const maximum=typeof MAX_CONSTRUCTION_SITES==='number'?MAX_CONSTRUCTION_SITES:100;
    // An accepted intent can be reflected in fixtures immediately; deduplicate
    // by room/tile/type so the live and fixture accounting agree.
    const globalSites=Object.values(Game.constructionSites||{}),globalKeys=new Set(globalSites.filter(s=>s.pos).map(s=>(s.pos.roomName||s.room&&s.room.name)+':'+s.pos.x+':'+s.pos.y+':'+s.structureType));
    let globalCount=globalSites.length+constructionIntents.filter(i=>!globalKeys.has(i.room+':'+i.x+':'+i.y+':'+i.structureType)).length;
    const dependencyReady=d=>typeof d==='string'?built.some(s=>s.id===d||s.structureType===d):d&&built.some(s=>s.structureType===(d.structureType||d.type)&&s.pos.x===d.x&&s.pos.y===d.y);
    for(const request of requests.slice().sort((a,b)=>(b.priority||0)-(a.priority||0))){
        const type=request.structureType||request.type,x=request.x,y=request.y,key=x+50*y,requestKey=room.name+':'+x+':'+y+':'+type;
        if(seen.has(requestKey))continue;seen.add(requestKey);
        if(request.enabled===false){reject('disabled',request);continue;}
        if(type===STRUCTURE_RAMPART){reject('rampart-disabled',request);continue;}
        if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||x>49||y<0||y>49||!quota[type]){reject('invalid-request',request);continue;}
        if(level<(request.minRCL||request.rcl||1)){reject('rcl',request);continue;}
        if((request.dependencies||[]).some(d=>!dependencyReady(d))){reject('dependency',request);continue;}
        const here=at.get(key)||[];
        if(here.some(s=>s.structureType===type)){reject('already-present',request);continue;}
        if(siteTiles.has(key)){reject('site-conflict',request);continue;}
        const mineral=minerals.some(s=>range(s,{x,y})===0),extractor=typeof STRUCTURE_EXTRACTOR==='string'&&type===STRUCTURE_EXTRACTOR;
        if((terrain.get(x,y)&TERRAIN_MASK_WALL)&&!(extractor&&mineral)||extractor&&!mineral||mineral&&!extractor||sources(room).some(s=>range(s,{x,y})===0)||range(room.controller,{x,y})===0){reject('terrain-conflict',request);continue;}
        if(here.some(s=>s.structureType!==STRUCTURE_RAMPART&&!(s.structureType===STRUCTURE_ROAD&&type===STRUCTURE_CONTAINER)&&!(s.structureType===STRUCTURE_CONTAINER&&type===STRUCTURE_ROAD))){reject('structure-conflict',request);continue;}
        if((counts[type]||0)>=(quota[type][level]||0)){reject('quota',request);continue;}
        if(globalCount>=maximum){reject('global-site-cap',request);continue;}
        const code=request.name?room.createConstructionSite(x,y,type,request.name):room.createConstructionSite(x,y,type);
        if(code!==OK){reject('engine-rejected',request,code);continue;}
        const accepted={room:room.name,x,y,structureType:type};constructionIntents.push(accepted);counts[type]=(counts[type]||0)+1;
        at.set(key,here.concat(accepted));siteTiles.add(key);globalCount++;result.accepted++;
    }
    constructionResults[room.name]=result;m.construction=result;return result;
}

module.exports={upgrade,baseUpgradePolicy,economyMemory,routeTravel,updateEconomy,upgradePolicy,workerRole,isWorker,setWorkerRole,upgraderAssignment,workerAssignment,workerBodyWork,setWorkerState,markBuilderTrajectory,upgradeAllowed,walkable,controllerStation,stationUpgrade,overflowUpgrade,workerSupply,workReady,developmentPlan,recordDevelopment,finishDevelopment,buildAllowed,build,refuel,urgentFill,constructionJobs,criticalRepairs,repairCritical,runConstruction,work,mine};
