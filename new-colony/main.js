'use strict';
// Frontier24: energy throughput first; room plans live in Memory.frontier.
const VERSION = '2026-09-25.11';
const E = RESOURCE_ENERGY;
const vals = o => Object.keys(o).map(k => o[k]);
// Plans and station seats are plain local coordinates, which the engine's
// RoomPosition.getRangeTo(object) overload does not accept. Normalize both ends
// directly while preserving its known-different-room Infinity behavior.
const range = (a,b) => {
    const p=a.pos||a,q=b.pos||b;
    return p.roomName&&q.roomName&&p.roomName!==q.roomName?Infinity:Math.max(Math.abs(p.x-q.x),Math.abs(p.y-q.y));
};
const energy = o => o.store ? o.store[E] || 0 : o.amount || 0;
function near(c,arr) {
    if(!arr.length){movementCount('emptyChoices');return null;}
    // An adjacent target already satisfies the action range. All other new
    // choices still use real pathfinding rather than assuming range is a route.
    const adjacent=arr.find(t=>range(c,t)<=1);
    if(adjacent){movementCount('adjacentChoices');return adjacent;}
    movementCount('targetSearches');return c.pos.findClosestByPath(arr);
}
function go(c,t,r=1) {
    if (!t) return;
    const p=t.pos || t;
    // Waiting for fatigue or working in place is not failed movement.
    if(c.fatigue){movementCount('fatigueWaits');c.memory.stuck=0;return ERR_TIRED;}
    const key=c.pos.roomName+':'+c.pos.x+','+c.pos.y;
    const target=p.roomName+':'+p.x+','+p.y+':'+r;
    c.memory.stuck=c.memory.moveAttempt===Game.time-1&&c.memory.moveTarget===target&&c.memory.last===key ? (c.memory.stuck||0)+1:0;
    c.memory.last=key;
    c.memory.moveTarget=target;
    c.memory.moveAttempt=Game.time;
    movementCount('moveCalls');if(c.memory.stuck)movementCount('blockedSteps');
    // Changing ignoreCreeps alone does not invalidate moveTo's serialized path.
    // Replan around occupants after two actual failed steps, with a short retry
    // cadence if congestion persists. Keep normal successful routes cached.
    if(c.memory.stuck>=2&&c.memory.stuck%3===2){delete c.memory._move;movementCount('pathResets');}
    return c.moveTo(p,{range:r,reusePath:15,maxRooms:p.roomName===c.room.name?1:16,ignoreCreeps:c.memory.stuck<2});
}
function take(c,t) { const r=t.resourceType?c.pickup(t):c.withdraw(t,E); if(r===ERR_NOT_IN_RANGE)go(c,t); return r; }
function give(c,t) { const r=c.transfer(t,E); if(r===ERR_NOT_IN_RANGE)go(c,t); return r; }
function upgrade(c) { const t=c.room.controller; if(t&&t.my){const result=c.upgradeController(t);recordDevelopment(c,'upgrade',result);if(result===ERR_NOT_IN_RANGE)go(c,t,3);} }
function alive(c) {return c.spawning || (c.ticksToLive||0)>c.body.length*3+35;}
function sources(room) { return room.find(FIND_SOURCES); }
function stores(room) { return room.find(FIND_STRUCTURES,{filter:s=>s.store}); }
let miningCacheTick=-1,miningCache={};
function miningSpots(room,source) {
    if(miningCacheTick!==Game.time){miningCacheTick=Game.time;miningCache={};}
    const key=room.name+':'+source.id;if(miningCache[key])return miningCache[key];
    const terrain=room.getTerrain(),spots=[];
    for(let y=source.pos.y-1;y<=source.pos.y+1;y++)for(let x=source.pos.x-1;x<=source.pos.x+1;x++){
        if(x<1||y<1||x>48||y>48||(x===source.pos.x&&y===source.pos.y)||(terrain.get(x,y)&TERRAIN_MASK_WALL))continue;
        if(room.lookForAt(LOOK_STRUCTURES,x,y).some(s=>OBSTACLE_OBJECT_TYPES.includes(s.structureType)||(s.structureType===STRUCTURE_RAMPART&&!s.my&&!s.isPublic)))continue;
        spots.push({x,y,roomName:room.name});
    }
    return miningCache[key]=spots;
}
function baseUpgradePolicy(room) {
    const level=room.controller.level;
    if(level===1)return {target:2,mode:'bootstrap'};
    if(level<=3&&!room.storage){
        const capacity=level===2?550:800,workPerSource=level===2?4:5;
        const miners=vals(Game.creeps).filter(c=>!c.spawning&&c.room.name===room.name&&c.memory.role==='miner');
        const underMined=sources(room).some(s=>miners.filter(c=>c.memory.source===s.id&&range(c,s)<=1).reduce((n,c)=>n+c.getActiveBodyparts(WORK),0)<workPerSource);
        if(room.energyCapacityAvailable<capacity||underMined)return {target:2,mode:'infrastructure'};
    }
    const expansion=Memory.frontier&&Memory.frontier.expansion;
    const expanding=!!(expansion&&expansion.home===room.name&&!['complete','blocked'].includes(expansion.state));
    const reserve=room.storage?energy(room.storage):0;
    const memory=Memory.frontier&&Memory.frontier.rooms&&Memory.frontier.rooms[room.name];
    const previous=memory&&memory.economyControl&&memory.economyControl.baseMode;
    // Keep stock movement around 15k from repeatedly bypassing the 100-tick
    // decision interval. A new room retains the original 15k starting threshold.
    const threshold=previous==='reserve'?18000:previous==='growth'?12000:15000;
    const reserving=room.storage&&(expanding||reserve<threshold);
    const target=room.controller.level===8?15:reserving?6:reserve>30000?16:10;
    return {target,mode:room.controller.level===8?'rcl8':reserving?'reserve':'growth'};
}
// Slow, bounded control of production, transport and useful expenditure. Route
// estimates are capacity planning, never reported as measured energy throughput.
function economyMemory(room) {
    Memory.frontier=Memory.frontier||{rooms:{},intel:{}};
    Memory.frontier.rooms=Memory.frontier.rooms||{};
    return Memory.frontier.rooms[room.name]||(Memory.frontier.rooms[room.name]={});
}
function routeTravel(room,source) {
    const m=economyMemory(room),plan=m.plan;
    const route=plan&&(plan.roadRoutes||[]).find(r=>r.sourceId===source.id||r.id==='source:'+source.id);
    if(route&&route.complete&&route.tiles&&route.tiles.length){
        const roads=new Set(room.find(FIND_STRUCTURES,{filter:s=>s.structureType===STRUCTURE_ROAD}).map(s=>s.pos.x+50*s.pos.y));
        const terrain=room.getTerrain();
        // Haulers use equal MOVE/CARRY: plains and roads cost one step, loaded
        // unpaved swamp costs five. Empty return is conservatively also charged.
        return route.tiles.reduce((n,k)=>n+(!roads.has(k)&&(terrain.get(k%50,Math.floor(k/50))&TERRAIN_MASK_SWAMP)?5:1),0);
    }
    const spawn=room.find(FIND_MY_SPAWNS)[0];
    return spawn&&spawn.pos?Math.ceil(range(spawn,source)*1.5):15;
}
function updateEconomy(room) {
    const m=economyMemory(room),base=baseUpgradePolicy(room),old=m.economyControl;
    if(old&&Game.time-old.at<100&&old.baseMode===base.mode)return old;
    const all=vals(Game.creeps).filter(c=>c.memory.home===room.name),ss=sources(room),plan=m.plan;
    const telemetry=Memory.frontier.telemetry&&Memory.frontier.telemetry.rooms&&Memory.frontier.telemetry.rooms[room.name];
    const recent=telemetry&&Game.time-telemetry.tick<=100?telemetry:null;
    const controllerRoute=plan&&(plan.roadRoutes||[]).find(r=>r.id==='controller'&&r.complete);
    const core=plan&&(plan.roadCore||plan.anchor),spawn=room.find(FIND_MY_SPAWNS)[0];
    const tail=controllerRoute?controllerRoute.tiles.length:core?Math.max(2,range(room.controller,core)-3):spawn&&spawn.pos?Math.max(2,range(spawn,room.controller)-3):4;
    const routes=ss.map(source=>{
        const assigned=all.filter(c=>c.memory.role==='miner'&&c.memory.source===source.id);
        const currentWork=assigned.filter(c=>!c.memory.replaces).reduce((n,c)=>n+c.getActiveBodyparts(WORK),0);
        const work=Math.max(currentWork,...assigned.map(c=>c.getActiveBodyparts(WORK)),0);
        const activeWork=assigned.filter(c=>!c.spawning&&c.room&&c.room.name===room.name&&range(c,source)<=1).reduce((n,c)=>n+c.getActiveBodyparts(WORK),0);
        const rate=Math.min((source.energyCapacity||SOURCE_ENERGY_CAPACITY)/ENERGY_REGEN_TIME,work*HARVEST_POWER);
        return {id:source.id,rate,activeRate:Math.min((source.energyCapacity||SOURCE_ENERGY_CAPACITY)/ENERGY_REGEN_TIME,activeWork*HARVEST_POWER),roundTrip:2*(routeTravel(room,source)+tail)+4};
    });
    const sustainedBacklog=!!(recent&&(recent.mining||[]).some(s=>s.backlogSince!==null&&s.backlogSince!==undefined&&Game.time-s.backlogSince>=100));
    const harvest=routes.reduce((n,r)=>n+r.activeRate,0),plannedHarvest=routes.reduce((n,r)=>n+r.rate,0);
    const rawCarry=Math.max(6,Math.min(36,Math.ceil(routes.reduce((n,r)=>n+r.rate*r.roundTrip,0)*1.2/50)+(sustainedBacklog?2:0)));
    let carry=old?old.carry:rawCarry,lowerSince=old&&old.lowerSince;
    if(rawCarry>carry){carry=Math.min(rawCarry,carry+4);lowerSince=null;}
    else if(rawCarry<carry){lowerSince=lowerSince===null||lowerSince===undefined?Game.time:lowerSince;if(Game.time-lowerSince>=300)carry=Math.max(rawCarry,carry-2);}
    else lowerSince=null;
    const upkeep=all.reduce((n,c)=>n+c.body.reduce((v,p)=>v+(BODYPART_COST[p.type||p]||0),0)/(c.body.some(p=>(p.type||p)===CLAIM)?600:1500),0);
    const expansion=Memory.frontier.expansion,expanding=!!(expansion&&expansion.home===room.name&&!['complete','blocked'].includes(expansion.state));
    const stock=stores(room).filter(s=>[STRUCTURE_CONTAINER,STRUCTURE_STORAGE].includes(s.structureType)).reduce((n,s)=>n+energy(s),0);
    const reserve=room.storage?energy(room.storage):stock;
    const ledger=Memory.frontier.energy&&Memory.frontier.energy.rooms&&Memory.frontier.energy.rooms[room.name];
    const measured=ledger&&ledger.windows&&ledger.windows['300'];
    const trusted=measured&&!measured.warmingUp&&measured.coverage>=1&&measured.observedTicks>=300&&measured.tick!==undefined&&Game.time-measured.tick<=100;
    const drawdownOnly=trusted&&Array.isArray(measured.blocked)&&measured.blocked.length>0&&measured.blocked.every(reason=>reason==='stock-drawdown');
    const feedback=trusted&&(measured.eligible||drawdownOnly)?measured:null;
    // Replacements and repairs get a recurring budget before useful expenditure.
    const reserveRate=expanding?3:room.storage&&reserve<15000?2:!room.storage&&reserve<room.energyCapacityAvailable*2?1:0;
    const income=feedback&&Number.isFinite(feedback.harvestRate)?Math.min(harvest,feedback.harvestRate):harvest;
    const useful=Math.max(2,income-upkeep-1-reserveRate);
    const sites=constructionJobs(room),building=sites.length>0;
    const infrastructure=base.mode==='infrastructure';
    let buildRate=building?Math.min(15,Math.max(0,useful-2)):0;
    let target=infrastructure&&building?2:Math.max(2,Math.min(room.controller.level===8?15:20,Math.floor(useful-buildRate)));
    let feedbackReason=feedback?'measured-sustainable-budget':null;
    if(feedback&&drawdownOnly&&reserve<(room.storage?15000:room.energyCapacityAvailable*2)){
        const previousUseful=old?old.target+old.buildEnergyTarget:target+buildRate;
        const ceiling=Math.max(2,Math.min(useful,previousUseful-2));
        target=Math.max(2,Math.min(target,ceiling-(building?Math.min(buildRate,ceiling-2):0)));
        buildRate=Math.min(buildRate,Math.max(0,ceiling-target));feedbackReason='measured-reserve-drawdown';
    }
    // A low 300-tick sample is pending only. Additional discretionary demand
    // requires the ledger's complete 1500-tick low-efficiency signal and stock.
    if(feedback&&feedback.eligible&&ledger.indicator&&ledger.indicator.status==='active'&&!building&&!sustainedBacklog&&reserve>(room.storage?18000:room.energyCapacityAvailable*3)&&feedback.inventoryDelta>=0){
        target=Math.min(room.controller.level===8?15:20,Math.max(target,(old?old.target:target)+2));feedbackReason='measured-idle-surplus';
    }
    // A storage surplus can fund a bounded burst while feedback warms up.
    if(!building&&room.storage&&reserve>30000&&!expanding)target=Math.max(target,16);
    if(!ss.length){target=base.target;buildRate=building?5:0;}
    if(old&&old.baseMode===base.mode)target=Math.max(old.target-2,Math.min(old.target+2,target));
    buildRate=Math.min(buildRate,Math.max(0,useful-target));
    const builderWork=building?Math.max(1,Math.ceil(buildRate/BUILD_POWER)):0;
    const reason=sustainedBacklog?'sustained-source-backlog':feedbackReason|| (infrastructure&&building?'capacity-and-mining-infrastructure':building?'planned-construction-first':reserveRate?'reserve-and-renewal':'sustainable-upgrade');
    return m.economyControl={at:Game.time,baseMode:base.mode,mode:base.mode,reason,target,carry,rawCarry,lowerSince:lowerSince===undefined?null:lowerSince,
        developmentBudget:+(feedbackReason==='measured-reserve-drawdown'?target+buildRate:Math.max(useful,target+buildRate)).toFixed(2),builderWork,feedbackTicks:feedback?feedback.observedTicks:0,incomeBasis:feedback?'measured-harvest':'active-work-potential',harvestPotential:harvest,plannedHarvest,upkeep:+upkeep.toFixed(2),reserveRate,usefulTarget:+useful.toFixed(2),buildEnergyTarget:+buildRate.toFixed(2),routes};
}
function upgradePolicy(room) {
    const base=baseUpgradePolicy(room),m=Memory.frontier&&Memory.frontier.rooms&&Memory.frontier.rooms[room.name],control=m&&m.economyControl;
    return control&&control.baseMode===base.mode&&Game.time-control.at<200?{target:control.target,mode:control.mode}:base;
}
function upgraderAssignment(room) {
    const policy=upgradePolicy(room),primary=[],support=[];
    const peers=vals(Game.creeps).filter(o=>!o.spawning&&o.room.name===room.name&&o.memory.role==='upgrader').sort((a,b)=>a.name.localeCompare(b.name));
    let work=0;
    // Stable names keep the same workers at the controller throughout this stage.
    for(const c of peers){if(policy.mode==='infrastructure'&&work>=policy.target)support.push(c);else{primary.push(c);work+=c.getActiveBodyparts(WORK);}}
    return {policy,primary,support};
}
function upgradeAllowed(c,assignment=upgraderAssignment(c.room)) {
    const plan=developmentPlan(c.room);
    if(plan){
        // Travel must continue even when there is no executable upgrade yet.
        if(range(c,c.room.controller)>3)return true;
        const request=plan.requests.find(r=>r.creep===c&&r.kind==='upgrade');
        if(request)request.asked=true;
        return !!(request&&request.grant&&!request.done&&!request.failed);
    }
    const peers=assignment.primary;
    const total=peers.reduce((n,o)=>n+o.getActiveBodyparts(WORK),0),target=assignment.policy.target;
    if(total<=target)return true;
    const before=peers.slice(0,peers.indexOf(c)).reduce((n,o)=>n+o.getActiveBodyparts(WORK),0);
    // Rotate duty so oversized existing cohorts also leave energy for storage and expansion.
    return (Game.time+before)%total<target;
}
function walkable(room,p) {
    return p.x>0&&p.y>0&&p.x<49&&p.y<49&&!(room.getTerrain().get(p.x,p.y)&TERRAIN_MASK_WALL)&&
        !room.lookForAt(LOOK_STRUCTURES,p.x,p.y).some(s=>OBSTACLE_OBJECT_TYPES.includes(s.structureType)||s.structureType===STRUCTURE_RAMPART&&!s.my&&!s.isPublic)&&
        !sources(room).some(s=>range(s,p)===0)&&(!room.controller||range(room.controller,p)!==0);
}
function controllerStation(room) {
    const ctrl=room.controller;if(!ctrl||!ctrl.my)return null;
    const m=economyMemory(room),plan=m.plan,ss=sources(room);
    const nodes=stores(room).filter(s=>[STRUCTURE_CONTAINER,STRUCTURE_LINK].includes(s.structureType)&&range(s,ctrl)<=3&&!ss.some(src=>range(src,s)<=1));
    // Keep the container's four seats while it exists. A later link can feed
    // adjacent seats; losing the container rebuilds the station around the link.
    nodes.sort((a,b)=>Number(a.structureType===STRUCTURE_LINK)-Number(b.structureType===STRUCTURE_LINK)||range(a,ctrl)-range(b,ctrl));
    const node=nodes[0];if(!node){delete m.upgradeStation;return null;}
    const key=nodes.map(s=>s.id).join(',')+':'+ctrl.level+':'+(plan&&plan.version||0)+':'+(plan&&plan.structures||[]).length;
    let station=m.upgradeStation;
    if(!station||station.key!==key||station.until<=Game.time||station.until>Game.time+25||
        ![station.port,...station.seats].every(p=>walkable(room,p))){
        const future=new Set((plan&&plan.structures||[]).filter(s=>OBSTACLE_OBJECT_TYPES.includes(s.type)).map(s=>s.x+50*s.y));
        const roads=new Set((plan&&plan.structures||[]).filter(s=>s.type===STRUCTURE_ROAD).map(s=>s.x+50*s.y));
        const core=plan&&(plan.roadCore||plan.anchor)||room.find(FIND_MY_SPAWNS)[0]?.pos||{x:25,y:25};
        const options=[];
        for(let y=node.pos.y-1;y<=node.pos.y+1;y++)for(let x=node.pos.x-1;x<=node.pos.x+1;x++){
            const p={x,y};if(walkable(room,p)&&!future.has(x+50*y)&&range(ctrl,p)<=3)options.push(p);
        }
        options.sort((a,b)=>Number(roads.has(b.x+50*b.y))-Number(roads.has(a.x+50*a.y))||range(a,core)-range(b,core)||range(ctrl,b)-range(ctrl,a));
        const port=options.shift();if(!port){delete m.upgradeStation;return null;}
        // Planned approach roads stay open, including the second access route.
        const seats=options.filter(p=>!roads.has(p.x+50*p.y));
        station=m.upgradeStation={key,node:node.id,port,seats,until:Game.time+25};
    }
    return {...station,node,nodes};
}
function stationUpgrade(c,assignment) {
    const station=controllerStation(c.room),avoid=c.memory.stationAvoid;
    if(!station||avoid&&avoid.until>Game.time&&avoid.id===station.node.id){delete c.memory.upgradeSeat;return false;}
    const peers=assignment.primary,used=new Set(),key=p=>p.x+50*p.y;
    for(const peer of peers){const seat=peer.memory.upgradeSeat;
        if(seat&&seat.id===station.node.id&&station.seats.some(p=>key(p)===key(seat))&&!used.has(key(seat)))used.add(key(seat));
        else delete peer.memory.upgradeSeat;
    }
    for(const peer of peers)if(!peer.memory.upgradeSeat){
        const seat=station.seats.filter(p=>!used.has(key(p))).sort((a,b)=>range(peer,a)-range(peer,b))[0];
        if(seat){peer.memory.upgradeSeat={id:station.node.id,x:seat.x,y:seat.y};used.add(key(seat));}
    }
    const seat=c.memory.upgradeSeat;if(!seat)return false;
    delete c.memory.haulSupply;delete c.memory.refuelTarget;
    const held=energy(c),work=c.getActiveBodyparts(WORK),capacity=held+c.store.getFreeCapacity(E);
    if(!held&&!station.nodes.some(s=>energy(s)>0)){
        if(c.memory.stationEmptySince===undefined)c.memory.stationEmptySince=Game.time;
        if(Game.time-c.memory.stationEmptySince>=20){c.memory.stationAvoid={id:station.node.id,until:Game.time+25};delete c.memory.upgradeSeat;return false;}
    }else delete c.memory.stationEmptySince;
    // Withdrawal and upgrading use separate intents. An empty creep cannot
    // issue upgrade at tick start merely because its withdrawal will succeed.
    if(held<=Math.min(capacity/2,Math.max(work*3,1))){
        const supply=station.nodes.filter(s=>range(c,s)<=1&&energy(s)>0).sort((a,b)=>Number(b.structureType===STRUCTURE_LINK)-Number(a.structureType===STRUCTURE_LINK))[0];
        if(supply)c.withdraw(supply,E);
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
function workerSupply(c,job) {
    const room=c.room,station=controllerStation(room),old=c.memory.workSupply;
    let target=old&&old.job===job.id&&old.room===room.name&&Game.getObjectById(old.id);
    const excluded=s=>station&&station.nodes.some(n=>n.id===s.id);
    const avoid=c.memory.refuelAvoid,allowed=s=>!excluded(s)&&(!avoid||avoid.until<=Game.time||avoid.id!==s.id);
    if(target&&(!target.store||!allowed(target)))target=null;
    const depleted=target&&energy(target)<=0;
    if(depleted){
        if(old.emptySince===undefined)old.emptySince=Game.time;
        // Keep the fixed building's refill request alive while the worker can
        // still use general self-refuel recovery during a short stock outage.
        if(Game.time-old.emptySince<20)return false;
        target=null;
    }else if(target)delete old.emptySince;
    if(!target){
        const candidates=stores(room).filter(s=>[STRUCTURE_CONTAINER,STRUCTURE_STORAGE,STRUCTURE_LINK].includes(s.structureType)&&energy(s)>0&&allowed(s));
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
    const result=c.withdraw(target,E);
    if(result===OK){task.progress=Game.time;return true;}
    if(result===ERR_NOT_IN_RANGE&&Game.time-task.progress<=15&&go(c,target)!==ERR_NO_PATH)return true;
    c.memory.refuelAvoid={id:target.id,until:Game.time+15};delete c.memory.refuelTarget;delete c.memory.workSupply;return false;
}
function workReady(c) {
    const held=energy(c),free=c.store.getFreeCapacity(E),capacity=held+free;
    if(c.memory.loaded||free===0)return true;
    if(c.memory.role==='builder')return held>=Math.ceil(capacity*.9);
    return c.memory.role==='upgrader'&&held>=Math.min(capacity,Math.max(Math.ceil(capacity/2),c.getActiveBodyparts(WORK)*10));
}
// The slow policy reserves priorities, not exclusive spending rights. Only
// fueled, in-range work competes for a shared, bounded development allowance.
// Heap plans last one tick; Memory retains just credits for indivisible intents.
let developmentTick=-1,developmentPlans={};
function developmentPlan(room) {
    const m=economyMemory(room),control=m.economyControl;
    if(!control||Game.time-control.at>=200||!Number.isFinite(control.target)||!Number.isFinite(control.buildEnergyTarget)||
        !room.controller||room.controller.level===1||room.controller.ticksToDowngrade<4000)return null;
    if(developmentTick!==Game.time){developmentTick=Game.time;developmentPlans={};}
    const cached=developmentPlans[room.name];if(cached&&cached.room===room&&cached.memory===m)return cached;
    const assignment=upgraderAssignment(room),job=constructionJobs(room)[0],supportJob=assignment.support.length?constructionJobs(room,true)[0]:null;
    const station=controllerStation(room),requests=[];
    for(const c of vals(Game.creeps)){
        if(c.spawning||c.room.name!==room.name||!energy(c))continue;
        const work=c.getActiveBodyparts(WORK);if(!work)continue;
        const yielding=c.memory.yieldSource&&Game.getObjectById(c.memory.yieldSource);
        if(yielding&&range(c,yielding)<=1)continue;
        let kind,target,cost;
        if(assignment.primary.includes(c)){
            const seated=station&&c.memory.upgradeSeat&&c.memory.upgradeSeat.id===station.node.id;
            if(room.controller.upgradeBlocked||range(c,room.controller)>3||!seated&&!workReady(c))continue;
            kind='upgrade';target=room.controller;cost=Math.min(work,energy(c));
        }else if(['builder','bootstrap'].includes(c.memory.role)||assignment.support.includes(c)){
            target=assignment.support.includes(c)?supportJob:job;
            if(!target||range(c,target)>3||!workReady(c)||c.memory.role==='bootstrap'&&room.energyAvailable<room.energyCapacityAvailable)continue;
            kind='build';cost=Math.min(work*BUILD_POWER,energy(c),Number.isFinite(target.progressTotal)?Math.max(0,target.progressTotal-target.progress):Infinity);
        }
        if(cost>0)requests.push({creep:c,kind,target,cost});
    }
    const demand=kind=>requests.filter(r=>r.kind===kind).reduce((n,r)=>n+r.cost,0);
    const buildDemand=demand('build'),upgradeDemand=Math.min(room.controller.level===8?15:Infinity,demand('upgrade'));
    const total=Math.max(0,Number.isFinite(control.developmentBudget)?control.developmentBudget:control.target+control.buildEnergyTarget);
    let buildShare=Math.min(control.buildEnergyTarget,buildDemand),upgradeShare=Math.min(control.target,upgradeDemand);
    let spare=Math.max(0,total-buildShare-upgradeShare);
    const buildLoan=Math.min(spare,buildDemand-buildShare);buildShare+=buildLoan;spare-=buildLoan;
    upgradeShare+=Math.min(spare,upgradeDemand-upgradeShare);
    const maxCost=Math.max(1,...requests.map(r=>r.cost)),prior=m.developmentCredit;
    const credit=prior&&prior.tick===Game.time-1?prior:{credit:0,build:0,upgrade:0};
    // Carry at most one action's rounding remainder. Idle periods cannot bank a
    // large future burst or debt that deprives newly ready priority work.
    const state=m.developmentCredit={tick:Game.time,credit:Math.min(total+maxCost,Math.max(0,credit.credit)+total),
        build:buildDemand?Math.max(-maxCost,Math.min(maxCost,credit.build))+buildShare:0,
        upgrade:upgradeDemand?Math.max(-maxCost,Math.min(maxCost,credit.upgrade))+upgradeShare:0};
    const plan={room,memory:m,state,requests,total,buildDemand,upgradeDemand,spent:{build:0,upgrade:0},siteSpent:{}};
    developmentPlans[room.name]=plan;
    // Rotate equal-cost workers, while role balances preserve the original
    // priority shares when both roles can use them. Either role may borrow.
    requests.sort((a,b)=>a.creep.name.localeCompare(b.creep.name));
    const shift=requests.length?Game.time%requests.length:0;requests.push(...requests.splice(0,shift));
    let available=state.credit;const balance={build:state.build,upgrade:state.upgrade},sites={};let upgrades=0;
    const remaining=requests.slice();
    while(remaining.length){
        const choices=remaining.map(r=>({r,cost:Math.min(r.cost,r.kind==='build'&&Number.isFinite(r.target.progressTotal)?Math.max(0,r.target.progressTotal-r.target.progress-(sites[r.target.id]||0)):r.kind==='upgrade'?Math.max(0,upgradeDemand-upgrades):Infinity)}))
            .filter(q=>q.cost>0&&q.cost<=available).sort((a,b)=>balance[b.r.kind]/b.cost-balance[a.r.kind]/a.cost);
        if(!choices.length)break;
        const {r,cost}=choices[0];r.grant=cost;available-=cost;balance[r.kind]-=cost;
        if(r.kind==='build')sites[r.target.id]=(sites[r.target.id]||0)+cost;else upgrades+=cost;
        remaining.splice(remaining.indexOf(r),1);
    }
    return plan;
}
function recordDevelopment(c,kind,result) {
    const plan=developmentPlans[c.room.name];if(developmentTick!==Game.time||!plan||plan.room!==c.room)return;
    const request=plan.requests.find(r=>r.creep===c&&r.kind===kind);if(!request||request.done||request.failed)return;
    if(result!==OK){request.failed=true;return;}
    const cost=Math.min(request.cost,kind==='build'&&Number.isFinite(request.target.progressTotal)?Math.max(0,request.target.progressTotal-request.target.progress-(plan.siteSpent[request.target.id]||0)):kind==='upgrade'&&c.room.controller.level===8?Math.max(0,15-plan.spent.upgrade):Infinity);
    request.done=true;plan.state.credit-=cost;plan.state[kind]-=cost;plan.spent[kind]+=cost;
    if(kind==='build')plan.siteSpent[request.target.id]=(plan.siteSpent[request.target.id]||0)+cost;
}
function finishDevelopment(room) {
    const plan=developmentPlan(room);if(!plan)return;
    // Failed or superseded intents do not spend energy. Give their headroom to
    // ready workers that were denied earlier, regardless of creep loop order.
    const remaining=plan.requests.filter(r=>r.asked&&!r.done&&!r.failed).sort((a,b)=>plan.state[b.kind]/b.cost-plan.state[a.kind]/a.cost);
    for(const r of remaining){
        const cost=Math.min(r.cost,r.kind==='build'&&Number.isFinite(r.target.progressTotal)?Math.max(0,r.target.progressTotal-r.target.progress-(plan.siteSpent[r.target.id]||0)):Infinity);
        if(!cost||cost>plan.state.credit||r.kind==='upgrade'&&room.controller.level===8&&plan.spent.upgrade+cost>15)continue;
        const result=r.kind==='build'?r.creep.build(r.target):r.creep.upgradeController(r.target);recordDevelopment(r.creep,r.kind,result);
    }
    // Intent costs are diagnostic predictions; the event ledger remains the
    // authority for actual energy use. This is one bounded current-tick record.
    plan.memory.development={tick:Game.time,budget:plan.total,buildReady:plan.buildDemand,upgradeReady:plan.upgradeDemand,
        buildIntentEnergy:plan.spent.build,upgradeIntentEnergy:plan.spent.upgrade,credit:Math.max(0,plan.state.credit)};
}
function buildAllowed(c) {
    if(!['builder','bootstrap','upgrader'].includes(c.memory.role))return true;
    const plan=developmentPlan(c.room);if(!plan)return true;
    const request=plan.requests.find(r=>r.creep===c&&r.kind==='build');
    if(request)request.asked=true;
    return !!(request&&request.grant&&!request.done&&!request.failed);
}
function refuel(c,harvest=true) {
    const station=controllerStation(c.room),dedicated=station&&!(c.memory.role==='upgrader'&&upgraderAssignment(c.room).primary.includes(c));
    const protectedStock=t=>dedicated&&station.nodes.some(n=>n.id===t.id);
    const peers=c.room.find(FIND_MY_CREEPS).filter(o=>o.name!==c.name);
    const free=p=>!peers.some(o=>{
        const reserved=o.memory.refuelTarget;
        return o.pos.x===p.x&&o.pos.y===p.y||o.memory.role==='miner'&&o.memory.spot&&o.memory.spot.x===p.x&&o.memory.spot.y===p.y||
            reserved&&reserved.kind==='harvest'&&reserved.room===c.room.name&&reserved.x===p.x&&reserved.y===p.y&&!o.memory.loaded&&o.store.getFreeCapacity(E)>0&&Game.time-reserved.progress<=15;
    });
    const position=c.pos.x+','+c.pos.y;
    let task=c.memory.refuelTarget,target=task&&Game.getObjectById(task.id);
    if(task&&task.position!==position){task.position=position;task.progress=Game.time;}
    const stalled=task&&!c.fatigue&&Game.time-task.progress>15;
    if(task&&(!target||protectedStock(target)||task.room!==c.room.name||stalled||(task.kind==='harvest'? !harvest||target.energy<=0||!miningSpots(c.room,target).some(p=>p.x===task.x&&p.y===task.y&&free(p)):energy(target)<=0))){
        if(stalled)c.memory.refuelAvoid={id:task.id,until:Game.time+10};
        delete c.memory.refuelTarget;task=null;target=null;
    }
    if(!task){
        const avoid=c.memory.refuelAvoid,allowed=t=>!avoid||avoid.until<=Game.time||avoid.id!==t.id;
        const dropped=c.room.find(FIND_DROPPED_RESOURCES,{filter:d=>d.resourceType===E&&d.amount>=20&&allowed(d)});
        const stock=stores(c.room).filter(s=>[STRUCTURE_CONTAINER,STRUCTURE_STORAGE,STRUCTURE_LINK].includes(s.structureType)&&energy(s)>=20&&allowed(s)&&!protectedStock(s));
        const loot=c.room.find(FIND_TOMBSTONES).concat(c.room.find(FIND_RUINS)).filter(s=>energy(s)>0&&allowed(s));
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
    const result=task.kind==='harvest'?c.harvest(target):target.resourceType?c.pickup(target):c.withdraw(target,E);
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
    const plan=Memory.frontier&&Memory.frontier.rooms&&Memory.frontier.rooms[room.name]&&Memory.frontier.rooms[room.name].plan;
    const roads=new Map((plan&&plan.structures||[]).filter(s=>s.type===STRUCTURE_ROAD).map(s=>[s.x+50*s.y,s]));
    const priority={spawn:110,tower:100,container:96,extension:90,storage:80,link:70,road:40,rampart:30};
    const jobs=room.find(FIND_MY_CONSTRUCTION_SITES).map(site=>{
        const road=site.structureType===STRUCTURE_ROAD&&roads.get(site.pos.x+50*site.pos.y);
        const economy=!!(road&&road.roadClass==='economy');
        return {site,road,economy,priority:economy?94:priority[site.structureType]||10};
    }).filter(j=>!supportOnly||j.economy||[STRUCTURE_SPAWN,STRUCTURE_TOWER,STRUCTURE_EXTENSION,STRUCTURE_CONTAINER].includes(j.site.structureType));
    jobs.sort((a,b)=>b.priority-a.priority||Number(!!(b.economy&&b.road.roadSwamp))-Number(!!(a.economy&&a.road.roadSwamp))||(b.site.progress||0)-(a.site.progress||0)||(a.economy&&b.economy?(a.road.roadOrder||0)-(b.road.roadOrder||0):0));
    return jobs.map(j=>j.site);
}
function work(c) {
    const ctrl=c.room.controller;
    if(c.memory.yieldSource){
        const source=Game.getObjectById(c.memory.yieldSource);
        if(source&&range(c,source)<=1){const home=c.room.find(FIND_MY_SPAWNS)[0]||ctrl;if(home)go(c,home);return;}
        delete c.memory.yieldSource;
    }
    delete c.memory.haulSupply;
    const assignment=c.memory.role==='upgrader'?upgraderAssignment(c.room):null;
    if(assignment&&assignment.primary.includes(c)&&stationUpgrade(c,assignment))return;
    if(!assignment||!assignment.primary.includes(c))delete c.memory.upgradeSeat;
    // Retired construction workers can distribute surplus without withdrawing and
    // returning it to storage as an endless idle job.
    if(c.room.storage&&c.memory.role!=='upgrader'&&ctrl&&ctrl.my&&ctrl.ticksToDowngrade>=4000&&
        !c.room.find(FIND_MY_CONSTRUCTION_SITES).length&&
        !c.room.find(FIND_STRUCTURES,{filter:s=>[STRUCTURE_CONTAINER,STRUCTURE_ROAD].includes(s.structureType)&&s.hits<s.hitsMax*.55}).length&&
        (energy(c.room.storage)>0||vals(Game.creeps).some(o=>o.room.name===c.room.name&&o.memory.role==='miner'&&o.getActiveBodyparts(WORK)))){haul(c);return;}
    if(!energy(c)) c.memory.loaded=false;
    // A completed 90% hauling batch must let a builder resume work; otherwise
    // supply closes while the worker keeps travelling for its final few energy.
    if(workReady(c))c.memory.loaded=true;
    if(c.memory.loaded)delete c.memory.refuelTarget;
    if(!c.memory.loaded){
        const job=constructionJobs(c.room,!!assignment)[0];
        if(job&&workerSupply(c,job)||refuel(c)||!energy(c))return;
        c.memory.loaded=true;
    }
    if(ctrl&&ctrl.my&&(ctrl.ticksToDowngrade<4000 || ctrl.level===1)&&c.memory.role!=='bootstrap'){upgrade(c);return;}
    if(c.memory.role==='bootstrap'&&urgentFill(c))return;
    let infrastructureSites;
    if(c.memory.role==='upgrader'){
        if(!assignment.support.includes(c)){if(upgradeAllowed(c,assignment))upgrade(c);return;}
        infrastructureSites=constructionJobs(c.room,true);
        // Between construction and miner arrival, help fund the replacement body.
        // With no remaining infrastructure job, existing workers can still upgrade.
        if(!infrastructureSites.length){if(!urgentFill(c))upgrade(c);return;}
    }
    const sites=infrastructureSites||constructionJobs(c.room);
    if(ctrl&&ctrl.my&&ctrl.level===1){upgrade(c);return;}
    if(sites.length){
        const t=sites[0];
        // Travel consumes no construction energy and must not be duty-throttled.
        if(range(c,t)>3){go(c,t,3);return;}
        if(buildAllowed(c)){const result=c.build(t);recordDevelopment(c,'build',result);if(result===ERR_NOT_IN_RANGE)go(c,t,3);}
        return;
    }
    const broken=c.room.find(FIND_STRUCTURES,{filter:s=>[STRUCTURE_CONTAINER,STRUCTURE_ROAD].includes(s.structureType)&&s.hits<s.hitsMax*.55});
    const b=near(c,broken);if(b){if(c.repair(b)===ERR_NOT_IN_RANGE)go(c,b,3);return;}
    if(c.room.storage&&c.room.storage.store.getFreeCapacity(E)>0){give(c,c.room.storage);return;}
    if(c.memory.role==='builder'&&ctrl&&ctrl.my&&ctrl.level>1&&upgradePolicy(c.room).mode==='growth'){
        // Completed infrastructure leaves this body working at the controller.
        // Join the regular upgrade cohort so its WORK consumes the same budget
        // and is counted by spawning. Start next tick: earlier workers may have
        // already acted using this tick's original cohort size.
        c.memory.role='upgrader';return;
    }
    upgrade(c);
}
function mine(c) {
    const s=Game.getObjectById(c.memory.source);if(!s)return;
    if(c.memory.replaces){
        const previous=Game.creeps[c.memory.replaces];
        if(previous&&previous.memory.role==='miner'&&previous.memory.source===s.id){
            // The old miner keeps producing throughout spawn and travel. Retire it
            // only when the replacement can step directly into the mining tile.
            if(range(c,previous)>1){go(c,previous);return;}
            if(c.fatigue||previous.fatigue)return;
            previous.memory.role='builder';previous.memory.loaded=energy(previous)>0;previous.memory.yieldSource=s.id;
            delete previous.memory.source;delete previous.memory.spot;
        }
        delete c.memory.replaces;
    }
    const others=vals(Game.creeps).filter(o=>o.name!==c.name&&o.memory.role==='miner'&&o.memory.source===s.id);
    const containers=s.pos.findInRange(FIND_STRUCTURES,1,{filter:t=>t.structureType===STRUCTURE_CONTAINER});
    const plan=Memory.frontier&&Memory.frontier.rooms&&Memory.frontier.rooms[c.room.name]&&Memory.frontier.rooms[c.room.name].plan;
    const planned=plan&&plan.sourcePlans&&plan.sourcePlans.find(p=>p.id===s.id);
    const opts=miningSpots(c.room,s).filter(p=>!others.some(o=>o.memory.spot&&o.memory.spot.x===p.x&&o.memory.spot.y===p.y));
    const score=p=>containers.some(t=>t.pos.x===p.x&&t.pos.y===p.y)?-100:containers.some(t=>range(t,p)<=1)?-50:planned&&planned.x===p.x&&planned.y===p.y?-20:0;
    opts.sort((a,b)=>score(a)-score(b)||range(c,a)-range(c,b));
    let spot=c.memory.spot;
    if(!spot||!opts.some(p=>p.x===spot.x&&p.y===spot.y)||opts.length&&score(opts[0])<score(spot))spot=c.memory.spot=opts[0];
    if(!spot)return;
    if(c.pos.x!==spot.x||c.pos.y!==spot.y){
        if(!c.fatigue&&range(c,spot)<=1){
            const blocker=c.room.find(FIND_MY_CREEPS).find(o=>o.room.name===c.room.name&&!o.spawning&&o.pos.x===spot.x&&o.pos.y===spot.y&&['bootstrap','builder','upgrader'].includes(o.memory.role));
            if(blocker){blocker.memory.yieldSource=s.id;delete blocker.memory.refuelTarget;}
        }
        go(c,new RoomPosition(spot.x,spot.y,c.room.name),0);return;
    }
    const link=c.pos.findInRange(FIND_MY_STRUCTURES,1,{filter:t=>t.structureType===STRUCTURE_LINK&&t.store.getFreeCapacity(E)>0})[0];
    const box=containers.find(t=>range(c,t)<=1);
    if(energy(c)){
        if(box&&box.hits<box.hitsMax*.7){c.repair(box);return;}
        else if(link)c.transfer(link,E);
        else if(box&&box.store.getFreeCapacity(E)>0)c.transfer(box,E);
        else c.drop(E);
    }
    c.harvest(s);
}
function deliveryNeeds(room,includeStorage=true) {
    const stock=stores(room),ss=sources(room),ctrl=room.controller,needs=[];
    const add=(node,high,priority)=>{if(node&&node.store.getFreeCapacity(E)>0)needs.push({node,high:Math.min(high,energy(node)+node.store.getFreeCapacity(E)),priority});};
    for(const s of stock)if(s.my&&[STRUCTURE_SPAWN,STRUCTURE_EXTENSION].includes(s.structureType))add(s,energy(s)+s.store.getFreeCapacity(E),0);
    const threatened=room.find(FIND_HOSTILE_CREEPS).length>0;
    for(const s of stock)if(s.my&&s.structureType===STRUCTURE_TOWER)add(s,threatened?900:400,1);
    const station=controllerStation(room),assignment=upgraderAssignment(room),m=economyMemory(room);
    // A borrower must also receive fuel: size the controller buffer for the
    // maximum useful share its existing WORK can consume, not just its floor.
    const control=m.economyControl,ceiling=control&&Game.time-control.at<200?(control.developmentBudget??(control.target+(control.buildEnergyTarget||0))):assignment.policy.target;
    const rate=Math.min(ceiling,room.controller.level===8?15:Infinity,assignment.primary.reduce((n,c)=>n+c.getActiveBodyparts(WORK),0));
    const carriers=vals(Game.creeps).filter(c=>!c.spawning&&c.room.name===room.name&&c.memory.role==='hauler');
    const batch=Math.max(100,...carriers.map(c=>energy(c)+c.store.getFreeCapacity(E)));
    // Existing round trips include empty return, pickup, delivery and terrain.
    // They are conservative planning estimates, not measured travel times.
    const routes=m.economyControl&&m.economyControl.routes||[];
    const lead=Math.max(10,...(routes.length?routes.map(r=>r.roundTrip||0):ss.map(s=>2*(routeTravel(room,s)+4)+4)));
    if(station){
        const node=station.node,capacity=energy(node)+node.store.getFreeCapacity(E);
        const low=Math.min(capacity*.65,Math.max(25,rate*(lead+5))),high=Math.min(capacity,Math.max(100,low+batch));
        let request=m.controllerSupply;
        if(!request||request.id!==node.id)request=m.controllerSupply={id:node.id,active:false};
        if(energy(node)<=low)request.active=true;else if(energy(node)>=high)request.active=false;
        // Retain the high watermark for already committed batches after recovery.
        if(request.active)add(node,high,energy(node)<Math.max(25,rate*10)?2:4);
    }else delete m.controllerSupply;
    const jobIds=new Set(constructionJobs(room).map(s=>s.id)),workNodes=new Map();
    for(const c of vals(Game.creeps)){
        const binding=c.memory.workSupply;
        if(c.room.name!==room.name||!binding||!jobIds.has(binding.job))continue;
        const node=Game.getObjectById(binding.id);
        if(node&&node.structureType===STRUCTURE_CONTAINER&&(!station||!station.nodes.some(s=>s.id===node.id))&&!ss.some(s=>range(s,node)<=1))
            workNodes.set(node.id,{node,capacity:Math.max(batch,(workNodes.get(node.id)?.capacity||0)+energy(c)+c.store.getFreeCapacity(E))});
    }
    for(const {node,capacity} of workNodes.values())add(node,capacity,3);
    // The hub is an inbound link receiver. Refilling it by hauler would send
    // received energy back through the same link network in a hauling loop.
    const hub=linkNetwork(room).hub;
    for(const s of stock)if(s.my&&s.structureType===STRUCTURE_LINK&&s.id!==hub?.id&&ctrl&&range(s,ctrl)>3&&!ss.some(src=>range(src,s)<=2))add(s,600,5);
    if(includeStorage&&room.storage)add(room.storage,energy(room.storage)+room.storage.store.getFreeCapacity(E),6);
    return needs.filter(n=>energy(n.node)<n.high);
}
function validDelivery(c,task) {
    const target=task&&Game.getObjectById(task.id);
    return task&&task.room===c.room.name&&task.expires>Game.time&&task.amount>0&&
        (task.sent===undefined||task.sent===Game.time)&&target&&target.structureType&&target.store&&target.store.getFreeCapacity(E)>0;
}
function haulTarget(c,includeStorage=true) {
    const room=c.room,blocked=c.memory.haulBlocked||{};
    for(const id in blocked)if(blocked[id]<=Game.time)delete blocked[id];
    let task=c.memory.haulDelivery;
    if(!validDelivery(c,task)||task.sent!==undefined&&task.sent<Game.time||blocked[task.id]){delete c.memory.haulDelivery;task=null;}
    const reserved=id=>vals(Game.creeps).reduce((n,peer)=>{
        const t=peer.memory.haulDelivery;
        return n+(peer.name!==c.name&&t&&t.id===id&&validDelivery(peer,t)?t.amount:0);
    },0);
    const capacity=energy(c)+c.store.getFreeCapacity(E),load=c.memory.loaded?energy(c):capacity;
    const needs=deliveryNeeds(room,includeStorage).filter(n=>!blocked[n.node.id]&&n.node.id!==c.memory.withdrawnFrom)
        .map(n=>({...n,amount:Math.max(0,n.high-energy(n.node)-reserved(n.node.id))})).filter(n=>n.amount>0);
    // Finish a batch inside its priority class; small normal gaps wait for the
    // next batch, while spawn/defense/controller emergency gaps remain urgent.
    needs.sort((a,b)=>a.priority-b.priority||Number(b.node.id===task?.id)-Number(a.node.id===task?.id)||range(c,a.node)-range(c,b.node));
    for(const request of needs){
        const committed=task&&request.node.id===task.id;
        if(!committed&&request.priority>2&&request.priority<6&&request.amount<Math.min(50,Math.ceil(load/2)))continue;
        if(!committed&&!near(c,[request.node]))continue;
        if(!committed){
            movementCount(task?'deliverySwitches':'deliveryStarts');
            task=c.memory.haulDelivery={id:request.node.id,room:room.name,amount:Math.min(load,Math.floor(request.amount)),priority:request.priority,
                phase:energy(c)?'deliver':'pickup',expires:Game.time+200,position:c.pos.x+','+c.pos.y,progress:Game.time};
        }else task.amount=Math.min(task.amount,Math.floor(request.amount));
        return request.node;
    }
    delete c.memory.haulDelivery;return null;
}
function clearStationTraffic(c) {
    const station=controllerStation(c.room);if(!station)return;
    const reserved=[station.port,...station.seats];
    if(!reserved.some(p=>range(c,p)===0))return;
    const options=[];
    for(let y=c.pos.y-1;y<=c.pos.y+1;y++)for(let x=c.pos.x-1;x<=c.pos.x+1;x++){
        const p={x,y};if(walkable(c.room,p)&&!reserved.some(s=>range(s,p)===0)&&
            !c.room.find(FIND_MY_CREEPS).some(o=>o.name!==c.name&&range(o,p)===0))options.push(p);
    }
    const p=options.sort((a,b)=>range(station.node,b)-range(station.node,a))[0];
    if(p)go(c,new RoomPosition(p.x,p.y,c.room.name),0);
}
function collectHaul(c) {
    const position=c.pos.x+','+c.pos.y;
    let task=c.memory.haulPickup,target=task&&Game.getObjectById(task.id);
    if(task&&(task.position!==position||c.fatigue)){task.position=position;task.progress=Game.time;}
    const stalled=task&&Game.time-task.progress>=15;
    if(task&&(!target||task.room!==c.room.name||energy(target)<=0||stalled)){
        if(stalled)c.memory.haulPickupAvoid={id:task.id,until:Game.time+15};
        delete c.memory.haulPickup;task=null;target=null;
    }
    if(!task){
        const ss=sources(c.room),stock=stores(c.room),avoid=c.memory.haulPickupAvoid;
        const allowed=t=>(!avoid||avoid.until<=Game.time||avoid.id!==t.id)&&t.id!==c.memory.haulDelivery?.id;
        const allDrops=c.room.find(FIND_DROPPED_RESOURCES,{filter:d=>d.resourceType===E&&d.amount>0}),drops=allDrops.filter(d=>d.amount>=25);
        const boxes=stock.filter(s=>energy(s)>=25&&s.structureType===STRUCTURE_CONTAINER&&ss.some(src=>range(src,s)<=1));
        const loot=c.room.find(FIND_TOMBSTONES).concat(c.room.find(FIND_RUINS)).filter(s=>energy(s)>0);
        const pressure=new Map(ss.map(src=>[src.id,stock.filter(s=>s.structureType===STRUCTURE_CONTAINER&&range(src,s)<=1).reduce((n,s)=>n+energy(s),0)+allDrops.filter(d=>range(src,d)<=2).reduce((n,d)=>n+energy(d),0)]));
        const free=c.store.getFreeCapacity(E);
        const score=t=>{const src=ss.find(s=>range(s,t)<=2);return Math.min(energy(t),free)/(range(c,t)+3)*(1+(src?pressure.get(src.id):energy(t))/500);};
        const hub=linkNetwork(c.room).hub,receivers=hub&&energy(hub)>=25?[hub]:[];
        const choices=drops.concat(boxes,loot,receivers).filter(allowed).sort((a,b)=>score(b)-score(a));
        target=choices[0]||(!energy(c)&&c.memory.haulDelivery&&c.room.storage&&energy(c.room.storage)>0&&allowed(c.room.storage)?c.room.storage:null);
        if(!target)return false;
        task=c.memory.haulPickup={id:target.id,room:c.room.name,position,progress:Game.time};
    }
    const delivery=c.memory.haulDelivery;
    if(delivery)delivery.source=target.id;
    const amount=Math.min(c.store.getFreeCapacity(E),delivery?Math.max(0,delivery.amount-energy(c)):c.store.getFreeCapacity(E));
    if(!amount)return false;
    const result=target.resourceType?c.pickup(target):c.withdraw(target,E,Math.min(amount,energy(target)));
    if(result===OK){c.memory.withdrawnFrom=target.id;task.progress=Game.time;return true;}
    if(result===ERR_NOT_IN_RANGE&&go(c,target)!==ERR_NO_PATH)return true;
    c.memory.haulPickupAvoid={id:task.id,until:Game.time+15};delete c.memory.haulPickup;return false;
}
function deliverHaul(c,target) {
    const id=target.id||target.name,position=c.pos.x+','+c.pos.y;
    let task=c.memory.haulDelivery;
    if(!task||task.id!==id||task.room!==c.room.name)return false;
    task.phase='deliver';
    if(task.position!==position||c.fatigue||range(c,target)<=1){task.position=position;task.progress=Game.time;}
    let blocked=range(c,target)>1&&!c.fatigue&&Game.time-task.progress>=4;
    if(!blocked){
        const amount=Math.min(task.amount,energy(c),target.store.getFreeCapacity(E));
        const result=c.transfer(target,E,amount);
        if(result===OK){
            // Keep this intent reserved until the next tick's actual Store is
            // visible. Releasing now would dispatch another truck into the gap.
            task.amount=amount;task.sent=Game.time;task.progress=Game.time;clearStationTraffic(c);return true;
        }
        if(result===ERR_NOT_IN_RANGE){
            const station=controllerStation(c.room),port=station&&station.node.id===id&&station.port;
            if(go(c,port?new RoomPosition(port.x,port.y,c.room.name):target,port?0:1)!==ERR_NO_PATH)return true;
        }
        else if(result===ERR_TIRED)return true;
        blocked=true;
    }
    if(blocked){c.memory.haulBlocked=c.memory.haulBlocked||{};c.memory.haulBlocked[id]=Game.time+15;delete c.memory.haulDelivery;}
    return false;
}
function haul(c) {
    if(!energy(c)){c.memory.loaded=false;delete c.memory.withdrawnFrom;}
    let target=haulTarget(c);
    const capacity=energy(c)+c.store.getFreeCapacity(E);
    if(energy(c)>0&&(energy(c)>=Math.ceil(capacity*.9)||c.memory.haulDelivery&&energy(c)>=c.memory.haulDelivery.amount))c.memory.loaded=true;
    if(c.memory.loaded)delete c.memory.haulPickup;
    if(!c.memory.loaded){
        if(collectHaul(c))return;
        if(energy(c))c.memory.loaded=true;else{clearStationTraffic(c);return;}
    }
    for(let attempt=0;attempt<2;attempt++){
        target=haulTarget(c);if(!target){delete c.memory.haulDelivery;clearStationTraffic(c);return;}
        if(deliverHaul(c,target))return;
    }
}
function body(role,budget) {
    if(role==='miner'){
        for(const b of [[WORK,WORK,WORK,WORK,WORK,CARRY,MOVE,MOVE,MOVE],[WORK,WORK,WORK,WORK,CARRY,MOVE,MOVE],[WORK,WORK,WORK,CARRY,MOVE,MOVE],[WORK,WORK,CARRY,MOVE],[WORK,CARRY,MOVE]])if(b.reduce((s,p)=>s+BODYPART_COST[p],0)<=budget)return b;
    }
    if(role==='hauler'){const n=Math.max(1,Math.min(8,Math.floor(budget/100)));return Array(n).fill(CARRY).concat(Array(n).fill(MOVE));}
    if(role==='upgrader'){
        for(const b of [[WORK,WORK,WORK,WORK,WORK,WORK,CARRY,CARRY,MOVE,MOVE,MOVE,MOVE],[WORK,WORK,WORK,WORK,CARRY,CARRY,MOVE,MOVE,MOVE],[WORK,WORK,CARRY,CARRY,MOVE,MOVE],[WORK,CARRY,MOVE]])if(b.reduce((s,p)=>s+BODYPART_COST[p],0)<=budget)return b;
    }
    const n=Math.max(1,Math.min(4,Math.floor(budget/200)));return Array(n).fill(WORK).concat(Array(n).fill(CARRY),Array(n).fill(MOVE));
}
function minerReplacement(room,all,spawn) {
    const next=body('miner',Math.min(room.energyCapacityAvailable,1000));if(!next)return null;
    const cost=next.reduce((n,p)=>n+BODYPART_COST[p],0);if(room.energyAvailable<cost)return null;
    const nextWork=next.filter(p=>p===WORK).length;
    for(const source of sources(room)){
        if(miningSpots(room,source).length!==1)continue;
        const assigned=all.filter(c=>c.memory.role==='miner'&&c.memory.source===source.id);
        if(assigned.length!==1||assigned[0].spawning)continue;
        const old=assigned[0],oldWork=old.getActiveBodyparts(WORK);
        const sourceRate=(source.energyCapacity||SOURCE_ENERGY_CAPACITY)/ENERGY_REGEN_TIME;
        const gain=Math.min(sourceRate,nextWork*HARVEST_POWER)-Math.min(sourceRate,oldWork*HARVEST_POWER);
        const payback=gain>0?cost/gain:Infinity;
        // Charge the entire new body to the extra harvest, with travel/spawn slack.
        if(old.ticksToLive>payback+next.length*CREEP_SPAWN_TIME+range(spawn,source)*3+50)return {source:source.id,replaces:old.name};
    }
    return null;
}
function minerRenewal(room,roster,spawn) {
    const next=body('miner',Math.min(room.energyCapacityAvailable,1000));
    if(!next)return null;
    const queue=room.find(FIND_MY_SPAWNS).reduce((n,s)=>Math.max(n,s.spawning&&s.spawning.remainingTime||0),0);
    const requests=[];
    for(const source of sources(room)){
        const assigned=roster.filter(c=>c.memory.role==='miner'&&c.memory.source===source.id);
        if(assigned.some(c=>c.spawning||c.memory.replaces))continue;
        const work=assigned.reduce((n,c)=>n+c.getActiveBodyparts(WORK),0);
        for(const old of assigned){
            if(work-old.getActiveBodyparts(WORK)>=5)continue;
            // Deadline includes the new body (not the old body's size), conservative
            // miner travel, one peer replacement, and a handover margin.
            const travel=routeTravel(room,source)*2;
            const lead=next.length*CREEP_SPAWN_TIME+travel+queue+next.length*CREEP_SPAWN_TIME+20;
            const slack=(old.ticksToLive||0)-lead;
            if(slack<=0)requests.push({source:source.id,replaces:old.name,slack});
        }
    }
    requests.sort((a,b)=>a.slack-b.slack);
    return requests[0]||null;
}
function spawnRoom(room) {
    const roster=vals(Game.creeps).filter(c=>c.memory.home===room.name);
    const all=roster.filter(alive);
    const control=updateEconomy(room);
    const upWork=all.filter(c=>c.memory.role==='upgrader').reduce((s,c)=>s+c.getActiveBodyparts(WORK),0);
    const policy=upgradePolicy(room),desiredUp=policy.target;
    if(Memory.frontier&&Memory.frontier.rooms){const m=Memory.frontier.rooms[room.name]||(Memory.frontier.rooms[room.name]={});m.economy={upgradeWorkTarget:desiredUp,upgradeWork:upWork,mode:policy.mode,reason:control.reason,carryTarget:control.carry,builderWorkTarget:control.builderWork,harvestPotential:control.harvestPotential,usefulEnergyTarget:control.usefulTarget,buildEnergyTarget:control.buildEnergyTarget,reserveRate:control.reserveRate,upkeep:control.upkeep,feedbackTicks:control.feedbackTicks,incomeBasis:control.incomeBasis,decisionTick:control.at,routes:control.routes};}
    const sp=room.find(FIND_MY_SPAWNS).find(s=>!s.spawning);if(!sp)return;
    const count=role=>all.filter(c=>c.memory.role===role).length;
    const workers=count('bootstrap')+count('builder');
    let role,extra={};
    const miners=count('miner'),haulers=count('hauler'),renewal=minerRenewal(room,roster,sp);
    if((!count('bootstrap')||workers<2)&&!miners)role='bootstrap';
    else if(haulers<1&&miners>0)role='hauler';
    else if(renewal){role='miner';extra={source:renewal.source,replaces:renewal.replaces};}
    else if(count('upgrader')<1)role='upgrader';
    else {
        const ss=sources(room).slice().sort((a,b)=>all.filter(c=>c.memory.role==='miner'&&c.memory.source===a.id).length-all.filter(c=>c.memory.role==='miner'&&c.memory.source===b.id).length);
        for(const s of ss){
            const assigned=all.filter(c=>c.memory.role==='miner'&&c.memory.source===s.id);
            const work=assigned.reduce((n,c)=>n+c.getActiveBodyparts(WORK),0);
            const slots=miningSpots(room,s);
            if(work<5&&assigned.length<Math.min(3,slots.length)){role='miner';extra.source=s.id;break;}
        }
    }
    if(!role){const replacement=minerReplacement(room,all,sp);if(replacement){role='miner';extra=replacement;}}
    const carry=all.filter(c=>c.memory.role==='hauler').reduce((s,c)=>s+c.getActiveBodyparts(CARRY),0);
    const desiredCarry=control.carry;
    const support=policy.mode==='infrastructure'?upgraderAssignment(room).support:[];
    const builderWork=all.filter(c=>c.memory.role==='builder'||c.memory.role==='bootstrap'||support.includes(c)).reduce((n,c)=>n+c.getActiveBodyparts(WORK),0);
    const roomEconomy=economyMemory(room).economy;roomEconomy.carry=carry;roomEconomy.builderWork=builderWork;
    if(!role&&carry<desiredCarry)role='hauler';
    if(!role&&builderWork<control.builderWork&&room.find(FIND_MY_CONSTRUCTION_SITES).length)role='builder';
    if(!role&&room.controller.level>=2&&!count('scout')&&global.frontierExpansion){global.frontierExpansion.spawn(room,sp,all);return;}
    if(!role&&upWork<desiredUp)role='upgrader';
    if(!role&&global.frontierExpansion){global.frontierExpansion.spawn(room,sp,all);return;}
    if(!role)return;
    const emergency=all.length<2||role==='hauler'&&haulers===0||role==='bootstrap'&&miners===0;
    let budget=emergency?room.energyAvailable:Math.min(room.energyCapacityAvailable,1000);
    if(role==='bootstrap')budget=Math.min(budget,400);
    if(role==='hauler'&&!emergency)budget=Math.min(budget,Math.max(2,desiredCarry-carry)*100);
    if(role==='builder')budget=Math.min(budget,Math.max(1,control.builderWork-builderWork)*200);
    const b=body(role,budget);if(!b)return;
    const cost=b.reduce((s,p)=>s+BODYPART_COST[p],0);if(room.energyAvailable<cost)return;
    const name=role+'-'+Game.time+'-'+room.name;
    sp.spawnCreep(b,name,{memory:Object.assign({role,home:room.name},extra)});
}
function defend(room){
    const hostile=room.find(FIND_HOSTILE_CREEPS);
    for(const t of room.find(FIND_MY_STRUCTURES,{filter:s=>s.structureType===STRUCTURE_TOWER})){
        const enemy=t.pos.findClosestByRange(hostile);if(enemy){t.attack(enemy);continue;}
        const hurt=t.pos.findClosestByRange(FIND_MY_CREEPS,{filter:c=>c.hits<c.hitsMax});if(hurt)t.heal(hurt);
        else if(energy(t)>650){const weak=t.pos.findClosestByRange(FIND_STRUCTURES,{filter:s=>s.structureType===STRUCTURE_RAMPART&&s.my&&s.hits<20000});if(weak)t.repair(weak);}
    }
    if(hostile.some(c=>c.getActiveBodyparts(ATTACK)||c.getActiveBodyparts(RANGED_ATTACK)||c.getActiveBodyparts(WORK))&&room.controller.safeModeAvailable&&!room.controller.safeMode){
        if(room.find(FIND_MY_SPAWNS).some(s=>hostile.some(c=>range(c,s)<6)))room.controller.activateSafeMode();
    }
}
function linkNetwork(room) {
    const ls=room.find(FIND_MY_STRUCTURES,{filter:s=>s.structureType===STRUCTURE_LINK}),plan=economyMemory(room).plan;
    const tags=new Map((plan&&plan.structures||[]).filter(s=>s.type===STRUCTURE_LINK).map(s=>[s.x+50*s.y,s.tag||'']));
    const tag=l=>tags.get(l.pos.x+50*l.pos.y)||'';
    const hub=ls.find(l=>tag(l)==='hub-link');
    const controller=ls.find(l=>tag(l)==='controller-link')||ls.find(l=>l!==hub&&room.controller&&range(l,room.controller)<=3);
    const ss=sources(room),inputs=ls.filter(l=>l!==hub&&l!==controller&&(tag(l).startsWith('source-link-')||ss.some(s=>range(s,l)<=2)));
    return {hub,controller,inputs};
}
function links(room){
    const {hub,controller,inputs}=linkNetwork(room),free=new Map([hub,controller].filter(Boolean).map(l=>[l.id,l.store.getFreeCapacity(E)]));
    const send=(from,to)=>{
        if(!from||!to||from.cooldown||energy(from)<=100||(free.get(to.id)||0)<=100)return false;
        const amount=Math.min(energy(from),free.get(to.id));
        if(from.transferEnergy(to,amount)!==OK)return false;
        free.set(to.id,free.get(to.id)-amount);return true;
    };
    for(const source of inputs)if(!send(source,controller))send(source,hub);
    send(hub,controller);
}
// Rebuildable, bounded heap counters; no prototype hooks or per-creep histories.
// Published every 20 ticks so subsequent CPU investigations have attribution.
let cpuWindow=null;
function cpuNow(){return Game.cpu&&typeof Game.cpu.getUsed==='function'?Game.cpu.getUsed():null;}
function movementCount(name){if(cpuWindow)cpuWindow.movement[name]=(cpuWindow.movement[name]||0)+1;}
function cpuAdd(group,name,value){
    if(!cpuWindow||value===null)return;
    const bucket=cpuWindow[group],stat=bucket[name]||(bucket[name]={calls:0,total:0,max:0});
    stat.calls++;stat.total+=value;stat.max=Math.max(stat.max,value);
}
function measured(group,name,run){
    const start=cpuNow();
    try{return run();}finally{if(start!==null)cpuAdd(group,name,cpuNow()-start);}
}
function finishCpu(start){
    if(start===null)return;
    const end=cpuNow();cpuWindow.samples++;
    cpuAdd('totals','loop',end-start);cpuAdd('totals','entry',start);cpuAdd('totals','tick',end);
    if(Game.time%20!==0)return;
    const compact=group=>Object.fromEntries(Object.entries(cpuWindow[group]).map(([name,s])=>[name,{calls:s.calls,mean:+(s.total/s.calls).toFixed(4),perTick:+(s.total/cpuWindow.samples).toFixed(4),max:+s.max.toFixed(4)}]));
    const movement=Object.fromEntries(Object.entries(cpuWindow.movement).map(([name,total])=>[name,{total,perTick:+(total/cpuWindow.samples).toFixed(4)}]));
    const stats={from:cpuWindow.from,tick:Game.time,samples:cpuWindow.samples,mean:+(cpuWindow.totals.loop.total/cpuWindow.samples).toFixed(4),max:+cpuWindow.totals.loop.max.toFixed(4),totals:compact('totals'),stages:compact('stages'),roles:compact('roles'),movement};
    if(typeof RawMemory!=='undefined'&&typeof RawMemory.get==='function')stats.memoryBytes=RawMemory.get().length;
    const previous=Memory.frontier.performance;
    stats.history=previous&&Array.isArray(previous.history)?previous.history.slice(-59):[];
    stats.history.push({tick:Game.time,samples:stats.samples,mean:stats.mean,max:stats.max,memoryMean:stats.stages.memory&&stats.stages.memory.perTick||0,moves:cpuWindow.movement.moveCalls||0,targetSwitches:cpuWindow.movement.deliverySwitches||0,pathResets:cpuWindow.movement.pathResets||0});
    Memory.frontier.performance=stats;
    cpuWindow=null;
}
module.exports.loop=function(){
    const cpuStart=cpuNow();
    if(cpuStart!==null&&!cpuWindow)cpuWindow={from:Game.time,samples:0,totals:{},stages:{},roles:{},movement:{}};
    Memory.frontier=Memory.frontier||{rooms:{},intel:{},version:VERSION};
    Memory.creeps=Memory.creeps||{};
    for(const name in Memory.creeps)if(!Game.creeps[name])delete Memory.creeps[name];
    if(cpuStart!==null)cpuAdd('stages','memory',cpuNow()-cpuStart);
    let planner,expansion,monitor;
    const moduleStart=cpuNow();
    try{planner=require('planner');}catch(e){if(Game.time%100===0)console.log('[Frontier planner load] '+e);}
    try{expansion=require('expansion');global.frontierExpansion=expansion;}catch(e){if(Game.time%100===0)console.log('[Frontier expansion load] '+e);}
    try{monitor=require('monitor');}catch(e){if(Game.time%100===0)console.log('[Frontier monitor load] '+e);}
    if(moduleStart!==null)cpuAdd('stages','modules',cpuNow()-moduleStart);
    const owned=vals(Game.rooms).filter(r=>r.controller&&r.controller.my);
    for(const room of owned)for(const [name,run] of [['defense',defend],['links',links],['spawn',spawnRoom],['planner',planner&&planner.run]])if(run){try{measured('stages',name,()=>run(room));}catch(e){console.log('[Frontier '+name+' '+room.name+'] '+e.stack);}}
    for(const room of owned)try{measured('stages','development',()=>developmentPlan(room));}catch(e){console.log('[Frontier development '+room.name+'] '+e.stack);}
    for(const c of vals(Game.creeps)){if(c.spawning)continue;try{
        measured('roles',c.memory.role||'unknown',()=>{
            if(c.memory.role==='miner')mine(c);else if(c.memory.role==='hauler')haul(c);
            else if(['scout','claimer','pioneer'].includes(c.memory.role)&&expansion)expansion.run(c,{go,work,refuel,upgrade});else work(c);
        });
    }catch(e){console.log('[Frontier creep '+c.name+'] '+e.stack);}}
    for(const room of owned)try{measured('stages','development',()=>finishDevelopment(room));}catch(e){console.log('[Frontier development '+room.name+'] '+e.stack);}
    if(expansion)try{measured('stages','strategy',()=>expansion.tick(owned));}catch(e){console.log('[Frontier expansion] '+e.stack);}
    if(monitor)try{measured('stages','monitor',()=>monitor.tick(owned));}catch(e){console.log('[Frontier monitor] '+e.stack);}
    if(Game.time%20===0){const last=Memory.frontier.status;Memory.frontier.status={tick:Game.time,version:VERSION,gcl:Game.gcl,cpu:Game.cpu.getUsed(),bucket:Game.cpu.bucket,rooms:owned.map(r=>{const p=last&&last.rooms.find(p=>p.name===r.name);return{name:r.name,rcl:r.controller.level,progress:r.controller.progress,total:r.controller.progressTotal,upgradePerTick:p&&p.rcl===r.controller.level?(r.controller.progress-p.progress)/(Game.time-last.tick):0,energy:r.energyAvailable,capacity:r.energyCapacityAvailable,creeps:vals(Game.creeps).filter(c=>c.memory.home===r.name).length,storage:r.storage?energy(r.storage):0};})};}
    for(const r of owned)r.visual.text('Frontier | RCL '+r.controller.level+' | '+Math.round((r.controller.progress||0)/(r.controller.progressTotal||1)*100)+'% | '+vals(Game.creeps).filter(c=>c.room.name===r.name).length+' creeps',25,1,{font:.6,color:'#a8efbd'});
    finishCpu(cpuStart);
};
