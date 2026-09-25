'use strict';
// Frontier24: energy throughput first; room plans live in Memory.frontier.
const VERSION = '2026-09-25.8';
const E = RESOURCE_ENERGY;
const vals = o => Object.keys(o).map(k => o[k]);
const range = (a,b) => a.pos ? a.pos.getRangeTo(b.pos || b) : Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
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
function upgrade(c) { const t=c.room.controller; if(t&&t.my&&c.upgradeController(t)===ERR_NOT_IN_RANGE)go(c,t,3); }
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
        builderWork,feedbackTicks:feedback?feedback.observedTicks:0,incomeBasis:feedback?'measured-harvest':'active-work-potential',harvestPotential:harvest,plannedHarvest,upkeep:+upkeep.toFixed(2),reserveRate,usefulTarget:+useful.toFixed(2),buildEnergyTarget:+buildRate.toFixed(2),routes};
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
    const peers=assignment.primary;
    const total=peers.reduce((n,o)=>n+o.getActiveBodyparts(WORK),0),target=assignment.policy.target;
    if(total<=target)return true;
    const before=peers.slice(0,peers.indexOf(c)).reduce((n,o)=>n+o.getActiveBodyparts(WORK),0);
    // Rotate duty so oversized existing cohorts also leave energy for storage and expansion.
    return (Game.time+before)%total<target;
}
function workReady(c) {
    const held=energy(c),free=c.store.getFreeCapacity(E),capacity=held+free;
    if(c.memory.loaded||free===0)return true;
    if(c.memory.role==='builder')return held>=Math.ceil(capacity*.9);
    return c.memory.role==='upgrader'&&held>=Math.min(capacity,Math.max(Math.ceil(capacity/2),c.getActiveBodyparts(WORK)*10));
}
function buildAllowed(c) {
    const m=Memory.frontier&&Memory.frontier.rooms&&Memory.frontier.rooms[c.room.name],control=m&&m.economyControl;
    if(!control||Game.time-control.at>=200||!['builder','bootstrap','upgrader'].includes(c.memory.role))return true;
    const support=upgraderAssignment(c.room).support;
    const job=constructionJobs(c.room)[0],supportJob=support.length?constructionJobs(c.room,true)[0]:null;
    const peers=vals(Game.creeps).filter(o=>{
        if(o.spawning||o.room.name!==c.room.name||!['builder','bootstrap'].includes(o.memory.role)&&!support.includes(o)||!energy(o))return false;
        const site=support.includes(o)?supportJob:job;
        if(!site||range(o,site)>3)return false;
        if(!workReady(o))return false;
        const yielding=o.memory.yieldSource&&Game.getObjectById(o.memory.yieldSource);
        if(yielding&&range(o,yielding)<=1)return false;
        return o.memory.role!=='bootstrap'||c.room.energyAvailable>=c.room.energyCapacityAvailable;
    }).sort((a,b)=>a.name.localeCompare(b.name));
    if(!peers.includes(c))return false;
    // Only bodies able to issue a build intent now share the spending allowance.
    // Traveling, refueling and retiring miners must not reserve idle WORK quota.
    const total=peers.reduce((n,o)=>n+o.getActiveBodyparts(WORK)*BUILD_POWER,0);
    if(total<=control.buildEnergyTarget)return true;
    const offset=peers.slice(0,peers.indexOf(c)).reduce((n,o)=>n+o.getActiveBodyparts(WORK)*BUILD_POWER,0);
    // Phase a 100-tick duty cycle across existing cohorts. The target is energy,
    // not WORK: construction spends BUILD_POWER energy for each active WORK.
    const allowedTicks=Math.floor(100*control.buildEnergyTarget/Math.max(1,total));
    return (Game.time*37+offset)%100<allowedTicks;
}
function refuel(c,harvest=true) {
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
    if(task&&(!target||task.room!==c.room.name||stalled||(task.kind==='harvest'? !harvest||target.energy<=0||!miningSpots(c.room,target).some(p=>p.x===task.x&&p.y===task.y&&free(p)):energy(target)<=0))){
        if(stalled)c.memory.refuelAvoid={id:task.id,until:Game.time+10};
        delete c.memory.refuelTarget;task=null;target=null;
    }
    if(!task){
        const avoid=c.memory.refuelAvoid,allowed=t=>!avoid||avoid.until<=Game.time||avoid.id!==t.id;
        const dropped=c.room.find(FIND_DROPPED_RESOURCES,{filter:d=>d.resourceType===E&&d.amount>=20&&allowed(d)});
        const stock=stores(c.room).filter(s=>[STRUCTURE_CONTAINER,STRUCTURE_STORAGE,STRUCTURE_LINK].includes(s.structureType)&&energy(s)>=20&&allowed(s));
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
    if(!c.memory.loaded){if(refuel(c)||!energy(c))return;c.memory.loaded=true;}
    if(ctrl&&ctrl.my&&(ctrl.ticksToDowngrade<4000 || ctrl.level===1)&&c.memory.role!=='bootstrap'){upgrade(c);return;}
    if(c.memory.role==='bootstrap'&&urgentFill(c))return;
    let infrastructureSites;
    if(c.memory.role==='upgrader'){
        const assignment=upgraderAssignment(c.room);
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
        if(buildAllowed(c)&&c.build(t)===ERR_NOT_IN_RANGE)go(c,t,3);
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
function haulTarget(c,includeStorage=true) {
    const room=c.room,stock=stores(room),ctrl=room.controller;
    const blocked=c.memory.haulBlocked||{};for(const id in blocked)if(blocked[id]<=Game.time)delete blocked[id];
    const delivery=c.memory.haulDelivery;
    const committed=arr=>delivery&&delivery.room===room.name&&arr.find(t=>(t.id||t.name)===delivery.id&&!blocked[delivery.id]);
    // Preserve a valid trip inside its priority class. Higher-priority classes
    // are still checked first every tick, so emergencies can preempt the trip.
    const reachable=arr=>committed(arr)||near(c,arr.filter(t=>!blocked[t.id||t.name]));
    let t=reachable(stock.filter(s=>s.my&&[STRUCTURE_SPAWN,STRUCTURE_EXTENSION].includes(s.structureType)&&s.store.getFreeCapacity(E)>0));if(t)return t;
    t=reachable(stock.filter(s=>s.my&&s.structureType===STRUCTURE_TOWER&&energy(s)<(room.find(FIND_HOSTILE_CREEPS).length?900:400)));if(t)return t;
    // Source containers are collection points, even if a controller happens to be nearby.
    const ss=sources(room),isSource=s=>ss.some(src=>range(src,s)<=1);
    const assignment=upgraderAssignment(room);
    const controllerRate=Math.min(assignment.policy.target,assignment.primary.reduce((n,o)=>n+o.getActiveBodyparts(WORK),0));
    const controllerLow=Math.max(25,controllerRate*10),controllerHigh=Math.min(1500,Math.max(100,controllerRate*50));
    const controllerBoxes=stock.filter(s=>s.structureType===STRUCTURE_CONTAINER&&!isSource(s)&&ctrl&&range(s,ctrl)<=3);
    // Protect a short controller reserve, but do not send every carrier to a
    // 1500-energy buffer while builders have only a few ticks of fuel left.
    t=reachable(controllerBoxes.filter(s=>energy(s)<controllerLow));if(t)return t;
    const building=room.find(FIND_MY_CONSTRUCTION_SITES).length>0;
    const support=building?assignment.support:[],requests=[];
    for(const worker of vals(Game.creeps).filter(o=>o.name!==c.name&&!o.spawning&&o.room.name===room.name&&(o.memory.role==='upgrader'||o.memory.role==='builder'&&building))){
        const held=energy(worker),free=worker.store.getFreeCapacity(E),capacity=held+free;
        if(!capacity)continue;
        const rate=Math.max(1,worker.getActiveBodyparts(WORK))*(worker.memory.role==='builder'||support.includes(worker)?BUILD_POWER:1);
        const low=Math.min(Math.floor(capacity/2),rate*10),high=Math.max(low+1,Math.ceil(capacity*.9));
        // Request a batch at low inventory; finish it near full instead of
        // attracting a hauler again for each tick's two-energy upgrade expense.
        if(held>=high)delete worker.memory.haulSupply;
        else if(held<=low)worker.memory.haulSupply=true;
        if(free>0&&worker.memory.haulSupply)requests.push({worker,ticks:held/rate});
    }
    requests.sort((a,b)=>a.ticks-b.ticks||range(c,a.worker)-range(c,b.worker));
    t=committed(requests.map(r=>r.worker));if(t)return t;
    for(const request of requests){t=reachable([request.worker]);if(t)return t;}
    t=reachable(controllerBoxes.filter(s=>energy(s)<controllerHigh));if(t)return t;
    t=reachable(stock.filter(s=>s.my&&s.structureType===STRUCTURE_LINK&&energy(s)<600&&ctrl&&range(s,ctrl)>3&&!ss.some(src=>range(src,s)<=2)));if(t)return t;
    if(includeStorage&&room.storage&&!blocked[room.storage.id]&&room.storage.id!==c.memory.withdrawnFrom&&room.storage.store.getFreeCapacity(E)>0)return room.storage;
    return null;
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
        const allowed=t=>!avoid||avoid.until<=Game.time||avoid.id!==t.id;
        const allDrops=c.room.find(FIND_DROPPED_RESOURCES,{filter:d=>d.resourceType===E&&d.amount>0}),drops=allDrops.filter(d=>d.amount>=25);
        const boxes=stock.filter(s=>energy(s)>=25&&s.structureType===STRUCTURE_CONTAINER&&ss.some(src=>range(src,s)<=1));
        const loot=c.room.find(FIND_TOMBSTONES).concat(c.room.find(FIND_RUINS)).filter(s=>energy(s)>0);
        const pressure=new Map(ss.map(src=>[src.id,stock.filter(s=>s.structureType===STRUCTURE_CONTAINER&&range(src,s)<=1).reduce((n,s)=>n+energy(s),0)+allDrops.filter(d=>range(src,d)<=2).reduce((n,d)=>n+energy(d),0)]));
        const free=c.store.getFreeCapacity(E);
        const score=t=>{const src=ss.find(s=>range(s,t)<=2);return Math.min(energy(t),free)/(range(c,t)+3)*(1+(src?pressure.get(src.id):energy(t))/500);};
        const choices=drops.concat(boxes,loot).filter(allowed).sort((a,b)=>score(b)-score(a));
        target=choices[0]||(!energy(c)&&haulTarget(c,false)&&c.room.storage&&energy(c.room.storage)>0&&allowed(c.room.storage)?c.room.storage:null);
        if(!target)return false;
        task=c.memory.haulPickup={id:target.id,room:c.room.name,position,progress:Game.time};
    }
    const result=target.resourceType?c.pickup(target):c.withdraw(target,E);
    if(result===OK){c.memory.withdrawnFrom=target.id;task.progress=Game.time;return true;}
    if(result===ERR_NOT_IN_RANGE&&go(c,target)!==ERR_NO_PATH)return true;
    c.memory.haulPickupAvoid={id:task.id,until:Game.time+15};delete c.memory.haulPickup;return false;
}
function deliverHaul(c,target) {
    const id=target.id||target.name,position=c.pos.x+','+c.pos.y;
    let task=c.memory.haulDelivery;
    if(!task||task.id!==id||task.room!==c.room.name){
        movementCount(task?'deliverySwitches':'deliveryStarts');
        task=c.memory.haulDelivery={id,room:c.room.name,position,progress:Game.time};
    }
    if(task.position!==position||c.fatigue||range(c,target)<=1){task.position=position;task.progress=Game.time;}
    let blocked=range(c,target)>1&&!c.fatigue&&Game.time-task.progress>=4;
    if(!blocked){
        const result=c.transfer(target,E);
        if(result===OK){task.progress=Game.time;return true;}
        if(result===ERR_NOT_IN_RANGE){if(go(c,target)!==ERR_NO_PATH)return true;}
        else if(result===ERR_TIRED)return true;
        blocked=true;
    }
    if(blocked){c.memory.haulBlocked=c.memory.haulBlocked||{};c.memory.haulBlocked[id]=Game.time+15;delete c.memory.haulDelivery;}
    return false;
}
function haul(c) {
    if(!energy(c)){c.memory.loaded=false;delete c.memory.withdrawnFrom;}
    const capacity=energy(c)+c.store.getFreeCapacity(E);
    if(energy(c)>0&&energy(c)>=Math.ceil(capacity*.9))c.memory.loaded=true;
    if(c.memory.loaded)delete c.memory.haulPickup;
    if(!c.memory.loaded){
        delete c.memory.haulDelivery;
        if(collectHaul(c))return;
        if(energy(c))c.memory.loaded=true;else return;
    }
    for(let attempt=0;attempt<2;attempt++){
        const target=haulTarget(c);if(!target){delete c.memory.haulDelivery;return;}
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
function links(room){
    const ls=room.find(FIND_MY_STRUCTURES,{filter:s=>s.structureType===STRUCTURE_LINK});
    const target=ls.find(l=>range(l,room.controller)<=3);if(!target)return;
    let free=target.store.getFreeCapacity(E);
    for(const l of ls)if(l.id!==target.id&&!l.cooldown&&energy(l)>100&&free>100){const n=Math.min(energy(l),free);if(l.transferEnergy(target,n)===OK)free-=n;}
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
    for(const c of vals(Game.creeps)){if(c.spawning)continue;try{
        measured('roles',c.memory.role||'unknown',()=>{
            if(c.memory.role==='miner')mine(c);else if(c.memory.role==='hauler')haul(c);
            else if(['scout','claimer','pioneer'].includes(c.memory.role)&&expansion)expansion.run(c,{go,work,refuel,upgrade});else work(c);
        });
    }catch(e){console.log('[Frontier creep '+c.name+'] '+e.stack);}}
    if(expansion)try{measured('stages','strategy',()=>expansion.tick(owned));}catch(e){console.log('[Frontier expansion] '+e.stack);}
    if(monitor)try{measured('stages','monitor',()=>monitor.tick(owned));}catch(e){console.log('[Frontier monitor] '+e.stack);}
    if(Game.time%20===0){const last=Memory.frontier.status;Memory.frontier.status={tick:Game.time,version:VERSION,gcl:Game.gcl,cpu:Game.cpu.getUsed(),bucket:Game.cpu.bucket,rooms:owned.map(r=>{const p=last&&last.rooms.find(p=>p.name===r.name);return{name:r.name,rcl:r.controller.level,progress:r.controller.progress,total:r.controller.progressTotal,upgradePerTick:p&&p.rcl===r.controller.level?(r.controller.progress-p.progress)/(Game.time-last.tick):0,energy:r.energyAvailable,capacity:r.energyCapacityAvailable,creeps:vals(Game.creeps).filter(c=>c.memory.home===r.name).length,storage:r.storage?energy(r.storage):0};})};}
    for(const r of owned)r.visual.text('Frontier | RCL '+r.controller.level+' | '+Math.round((r.controller.progress||0)/(r.controller.progressTotal||1)*100)+'% | '+vals(Game.creeps).filter(c=>c.room.name===r.name).length+' creeps',25,1,{font:.6,color:'#a8efbd'});
    finishCpu(cpuStart);
};
