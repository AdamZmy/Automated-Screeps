'use strict';
const {E,vals,range,energy,near,go,take,give,alive,allCreeps,roomCreeps,structures,myStructures,spawns,constructionSites,drops,tombstones,ruins,sources,stores,miningSpots}=require('runtime');
let upgradeIntentTick=-1,upgradeActors=new Set();
let upgraderCacheTick=-1,upgraderCache={};
let stationCacheTick=-1,stationCache={};
let constructionCacheTick=-1,constructionCache={};
function upgrade(c) {
    const t=c.room.controller;if(!t||!t.my)return;
    if(upgradeIntentTick!==Game.time){upgradeIntentTick=Game.time;upgradeActors=new Set();}
    if(upgradeActors.has(c))return;
    upgradeActors.add(c);
    const result=c.upgradeController(t);recordDevelopment(c,'upgrade',result);
    if(result===ERR_NOT_IN_RANGE)go(c,t,3);
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
    const rawCarry=Math.max(6,Math.ceil(routes.reduce((n,r)=>n+r.rate*r.roundTrip,0)*1.2/50)+(sustainedBacklog?2:0));
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
    if(upgraderCacheTick!==Game.time){upgraderCacheTick=Game.time;upgraderCache={};}
    if(upgraderCache[room.name]&&upgraderCache[room.name].room===room)return upgraderCache[room.name].value;
    const policy=upgradePolicy(room),primary=[],support=[];
    const peers=allCreeps().filter(o=>!o.spawning&&o.room.name===room.name&&o.memory.role==='upgrader').sort((a,b)=>a.name.localeCompare(b.name));
    let work=0;
    // Stable names keep the same workers at the controller throughout this stage.
    for(const c of peers){if(policy.mode==='infrastructure'&&work>=policy.target)support.push(c);else{primary.push(c);work+=c.getActiveBodyparts(WORK);}}
    const value={policy,primary,support};upgraderCache[room.name]={room,value};return value;
}
function upgradeAllowed(c,assignment=upgraderAssignment(c.room)) {
    // Staffing and supply use the economic plan. A fueled primary upgrader
    // never skips an executable action merely to enforce that planning rate.
    return assignment.primary.includes(c);
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
    if(blocking){if(parking)go(c,new RoomPosition(parking.x,parking.y,c.room.name),0);else clearStationTraffic(c);return true;}
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
    return energy(c)>0&&(c.memory.loaded||c.store.getFreeCapacity(E)===0||['builder','upgrader'].includes(c.memory.role));
}
// Readiness and accepted intents are diagnostics, not a spending valve. The
// ledger remains the authority for actual engine expenditure and RCL8 limits.
let developmentTick=-1,developmentPlans={};
function developmentPlan(room) {
    const m=economyMemory(room);
    if(developmentTick!==Game.time){developmentTick=Game.time;developmentPlans={};}
    const cached=developmentPlans[room.name];if(cached&&cached.room===room&&cached.memory===m)return cached;
    delete m.developmentCredit;
    const control=m.economyControl,assignment=upgraderAssignment(room),job=constructionJobs(room)[0],supportJob=assignment.support.length?constructionJobs(room,true)[0]:null;
    const requests=[];let upgradeReady=0;
    for(const c of allCreeps()){
        if(c.spawning||c.room.name!==room.name||!energy(c))continue;
        const work=c.getActiveBodyparts(WORK);if(!work)continue;
        const yielding=c.memory.yieldSource&&Game.getObjectById(c.memory.yieldSource);
        if(yielding&&range(c,yielding)<=1)continue;
        if(assignment.primary.includes(c)){
            if(!room.controller.upgradeBlocked&&range(c,room.controller)<=3)upgradeReady+=Math.min(work,energy(c));
            continue;
        }
        if(!['builder','bootstrap'].includes(c.memory.role)&&!assignment.support.includes(c))continue;
        const target=assignment.support.includes(c)?supportJob:job;
        if(!target||range(c,target)>3||c.memory.role==='bootstrap'&&room.energyAvailable<room.energyCapacityAvailable)continue;
        const cost=Math.min(work*BUILD_POWER,energy(c),Number.isFinite(target.progressTotal)?Math.max(0,target.progressTotal-target.progress):Infinity);
        if(cost>0)requests.push({creep:c,kind:'build',target,cost});
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
    if(!['builder','bootstrap','upgrader'].includes(c.memory.role))return true;
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
    const station=controllerStation(c.room),dedicated=station&&(protectController||!(c.memory.role==='upgrader'&&upgraderAssignment(c.room).primary.includes(c)));
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
    if(task&&(!target||protectedStock(target)||task.room!==c.room.name||stalled||(task.kind==='harvest'? !harvest||target.energy<=0||!miningSpots(c.room,target).some(p=>p.x===task.x&&p.y===task.y&&free(p)):energy(target)<=0))){
        if(stalled)c.memory.refuelAvoid={id:task.id,until:Game.time+10};
        delete c.memory.refuelTarget;task=null;target=null;
    }
    if(!task){
        const avoid=c.memory.refuelAvoid,allowed=t=>!avoid||avoid.until<=Game.time||avoid.id!==t.id;
        const dropped=drops(c.room).filter(d=>d.resourceType===E&&d.amount>0&&allowed(d));
        const stock=stores(c.room).filter(s=>[STRUCTURE_CONTAINER,STRUCTURE_STORAGE,STRUCTURE_LINK].includes(s.structureType)&&energy(s)>0&&allowed(s)&&!protectedStock(s));
        const loot=tombstones(c.room).concat(ruins(c.room)).filter(s=>energy(s)>0&&allowed(s));
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
    if(constructionCacheTick!==Game.time){constructionCacheTick=Game.time;constructionCache={};}
    const roomSites=constructionSites(room),cacheKey=room.name+':'+Number(supportOnly),cached=constructionCache[cacheKey];if(cached&&cached.room===room&&cached.sites===roomSites)return cached.value;
    const plan=Memory.frontier&&Memory.frontier.rooms&&Memory.frontier.rooms[room.name]&&Memory.frontier.rooms[room.name].plan;
    const roads=new Map((plan&&plan.structures||[]).filter(s=>s.type===STRUCTURE_ROAD).map(s=>[s.x+50*s.y,s]));
    const priority={spawn:110,tower:100,container:96,extension:90,storage:80,link:70,road:40,rampart:30};
    const jobs=roomSites.map(site=>{
        const road=site.structureType===STRUCTURE_ROAD&&roads.get(site.pos.x+50*site.pos.y);
        const economy=!!(road&&road.roadClass==='economy');
        return {site,road,economy,priority:economy?94:priority[site.structureType]||10};
    }).filter(j=>!supportOnly||j.economy||[STRUCTURE_SPAWN,STRUCTURE_TOWER,STRUCTURE_EXTENSION,STRUCTURE_CONTAINER].includes(j.site.structureType));
    jobs.sort((a,b)=>b.priority-a.priority||Number(!!(b.economy&&b.road.roadSwamp))-Number(!!(a.economy&&a.road.roadSwamp))||(b.site.progress||0)-(a.site.progress||0)||(a.economy&&b.economy?(a.road.roadOrder||0)-(b.road.roadOrder||0):0));
    const value=jobs.map(j=>j.site);constructionCache[cacheKey]={room,sites:roomSites,value};return value;
}
function work(c) {
    const ctrl=c.room.controller;
    if(c.memory.yieldSource){
        const source=Game.getObjectById(c.memory.yieldSource);
        if(source&&range(c,source)<=1){const home=spawns(c.room)[0]||ctrl;if(home)go(c,home);return;}
        delete c.memory.yieldSource;
    }
    delete c.memory.haulSupply;
    if(c.memory.role==='builder'&&c.getActiveBodyparts(WORK)>0&&ctrl&&ctrl.my&&ctrl.level>1&&
        !constructionSites(c.room).length&&
        !structures(c.room).some(s=>[STRUCTURE_CONTAINER,STRUCTURE_ROAD].includes(s.structureType)&&s.hits<s.hitsMax*.55)){
        c.memory.role='upgrader';delete c.memory.workSupply;
    }
    const assignment=c.memory.role==='upgrader'?upgraderAssignment(c.room):null;
    // Initial carried energy can upgrade while the same tick also withdraws,
    // picks up or moves. Refuel/readiness and seat routing must not hide work.
    if(assignment&&assignment.primary.includes(c)&&energy(c)>0&&ctrl&&range(c,ctrl)<=3)upgrade(c);
    if(assignment&&assignment.primary.includes(c)){
        if(stationUpgrade(c,assignment)){delete c.memory.upgradeParking;return;}
        if(overflowUpgrade(c,assignment))return;
    }
    if(!assignment||!assignment.primary.includes(c))delete c.memory.upgradeSeat;
    // Retired construction workers can distribute surplus without withdrawing and
    // returning it to storage as an endless idle job.
    if(c.room.storage&&c.memory.role!=='upgrader'&&ctrl&&ctrl.my&&ctrl.ticksToDowngrade>=4000&&
        !constructionSites(c.room).length&&
        !structures(c.room).some(s=>[STRUCTURE_CONTAINER,STRUCTURE_ROAD].includes(s.structureType)&&s.hits<s.hitsMax*.55)&&
        (energy(c.room.storage)>0||allCreeps().some(o=>o.room.name===c.room.name&&o.memory.role==='miner'&&o.getActiveBodyparts(WORK)))){require('logistics').haul(c);return;}
    if(!energy(c)) c.memory.loaded=false;
    // Any carried energy can fund useful work; refill only after it runs out.
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
        if(buildAllowed(c))build(c,t);
        return;
    }
    const broken=structures(c.room).filter(s=>[STRUCTURE_CONTAINER,STRUCTURE_ROAD].includes(s.structureType)&&s.hits<s.hitsMax*.55);
    const b=near(c,broken);if(b){if(c.repair(b)===ERR_NOT_IN_RANGE)go(c,b,3);return;}
    if(c.room.storage&&c.room.storage.store.getFreeCapacity(E)>0){give(c,c.room.storage);return;}
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
    const containers=structures(c.room).filter(t=>t.structureType===STRUCTURE_CONTAINER&&range(s,t)<=1);
    const plan=Memory.frontier&&Memory.frontier.rooms&&Memory.frontier.rooms[c.room.name]&&Memory.frontier.rooms[c.room.name].plan;
    const planned=plan&&plan.sourcePlans&&plan.sourcePlans.find(p=>p.id===s.id);
    const score=p=>containers.some(t=>t.pos.x===p.x&&t.pos.y===p.y)?-100:containers.some(t=>range(t,p)<=1)?-50:planned&&planned.x===p.x&&planned.y===p.y?-20:0;
    let spot=c.memory.spot;
    const atSpot=spot&&c.pos.x===spot.x&&c.pos.y===spot.y;
    const betterContainer=atSpot&&!containers.some(t=>t.pos.x===spot.x&&t.pos.y===spot.y)&&containers.some(t=>miningSpots(c.room,s).some(p=>p.x===t.pos.x&&p.y===t.pos.y));
    const review=(Game.time+c.name.split('').reduce((n,ch)=>n+ch.charCodeAt(0),0))%25===0;
    if(!atSpot||betterContainer||review){
        const others=allCreeps().filter(o=>o.name!==c.name&&o.memory.role==='miner'&&o.memory.source===s.id);
        const opts=miningSpots(c.room,s).filter(p=>!others.some(o=>o.memory.spot&&o.memory.spot.x===p.x&&o.memory.spot.y===p.y));
        opts.sort((a,b)=>score(a)-score(b)||range(c,a)-range(c,b));
        if(!spot||!opts.some(p=>p.x===spot.x&&p.y===spot.y)||opts.length&&score(opts[0])<score(spot))spot=c.memory.spot=opts[0];
    }
    if(!spot)return;
    if(c.pos.x!==spot.x||c.pos.y!==spot.y){
        if(!c.fatigue&&range(c,spot)<=1){
            const blocker=roomCreeps(c.room).find(o=>o.room.name===c.room.name&&!o.spawning&&o.pos.x===spot.x&&o.pos.y===spot.y&&['bootstrap','builder','upgrader'].includes(o.memory.role));
            if(blocker){blocker.memory.yieldSource=s.id;delete blocker.memory.refuelTarget;}
        }
        go(c,new RoomPosition(spot.x,spot.y,c.room.name),0);return;
    }
    const link=myStructures(c.room).find(t=>t.structureType===STRUCTURE_LINK&&t.store.getFreeCapacity(E)>0&&range(c,t)<=1);
    const box=containers.find(t=>range(c,t)<=1);
    if(energy(c)){
        if(box&&box.hits<box.hitsMax*.7){c.repair(box);return;}
        else if(link)c.transfer(link,E);
        else if(box&&box.store.getFreeCapacity(E)>0)c.transfer(box,E);
        else c.drop(E);
    }
    c.harvest(s);
}

module.exports={upgrade,baseUpgradePolicy,economyMemory,routeTravel,updateEconomy,upgradePolicy,upgraderAssignment,upgradeAllowed,walkable,controllerStation,stationUpgrade,overflowUpgrade,workerSupply,workReady,developmentPlan,recordDevelopment,finishDevelopment,buildAllowed,build,refuel,urgentFill,constructionJobs,work,mine};
