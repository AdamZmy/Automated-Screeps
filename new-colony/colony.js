'use strict';
const {vals,range,energy,allCreeps,sources,stores,spawns,structures,constructionSites,hostiles}=require('runtime');
function baseUpgradePolicy(room) {
    const level=room.controller.level;
    if(level===1)return {target:2,mode:'bootstrap'};
    if(level<=3&&!room.storage){
        const capacity=level===2?550:800,workPerSource=level===2?4:5;
        const miners=allCreeps().filter(c=>!c.spawning&&c.room.name===room.name&&c.memory.role==='miner');
        const underMined=sources(room).some(s=>miners.filter(c=>c.memory.source===s.id&&range(c,s)<=1).reduce((n,c)=>n+c.getActiveBodyparts(WORK),0)<workPerSource);
        if(room.energyCapacityAvailable<capacity||underMined)return {target:2,mode:'infrastructure'};
    }
    const expansion=Memory.frontier&&Memory.frontier.expansion;
    const expanding=!!(expansion&&expansion.home===room.name&&!['complete','blocked','cancelled','aborting'].includes(expansion.state));
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
let routeTick=-1,routeEstimates=new Map();
function routeTravel(room,source) {
    if(routeTick!==Game.time){routeTick=Game.time;routeEstimates=new Map();}
    const m=economyMemory(room),plan=m.plan,collection=structures(room),key=room.name+':'+source.id;
    const cached=routeEstimates.get(key);
    if(cached&&cached.room===room&&cached.source===source&&cached.plan===plan&&cached.collection===collection)return cached.travel;
    const save=travel=>{routeEstimates.set(key,{room,source,plan,collection,travel});return travel;};
    const route=plan&&(plan.roadRoutes||[]).find(r=>r.sourceId===source.id||r.id==='source:'+source.id);
    if(route&&route.complete&&route.tiles&&route.tiles.length){
        const roads=new Set(collection.filter(s=>s.structureType===STRUCTURE_ROAD).map(s=>s.pos.x+50*s.pos.y));
        const terrain=room.getTerrain();
        // Haulers use equal MOVE/CARRY: plains and roads cost one step, loaded
        // unpaved swamp costs five. Empty return is conservatively also charged.
        return save(route.tiles.reduce((n,k)=>n+(!roads.has(k)&&(terrain.get(k%50,Math.floor(k/50))&TERRAIN_MASK_SWAMP)?5:1),0));
    }
    const spawn=spawns(room)[0];
    return save(spawn&&spawn.pos?Math.ceil(range(spawn,source)*1.5):15);
}
let economyTick=-1,economyCache={};
function updateEconomy(room) {
    const m=economyMemory(room),old=m.economyControl;
    if(economyTick!==Game.time){economyTick=Game.time;economyCache={};}
    const cached=economyCache[room.name];if(cached&&cached.room===room&&cached.memory===m&&cached.value===old)return old;
    const remember=value=>{economyCache[room.name]={room,memory:m,value};return value;};
    const base=baseUpgradePolicy(room);
    const status=policy(room),event=criticalSignature(room,status);
    if(old&&Game.time-old.at<100&&old.baseMode===base.mode&&old.eventSignature===event)return remember(old);
    const all=allCreeps().filter(c=>c.memory.home===room.name),ss=sources(room),plan=m.plan;
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
    const expansion=Memory.frontier.expansion,expanding=!!(expansion&&expansion.home===room.name&&!['complete','blocked','cancelled','aborting'].includes(expansion.state));
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
    const sites=constructionSites(room).filter(s=>s.structureType!==STRUCTURE_RAMPART),building=sites.length>0;
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
    return remember(m.economyControl={at:Game.time,eventSignature:event,phase:status.phase,security:status.security,cpuMode:status.cpuMode,confidence:feedback?'observed':'estimated',stockDrawdownPlan:reserve>0&&building?{available:reserve,reason:'fund-active-construction'}:null,baseMode:base.mode,mode:base.mode,reason,target,carry,rawCarry,lowerSince:lowerSince===undefined?null:lowerSince,
        developmentBudget:+(feedbackReason==='measured-reserve-drawdown'?target+buildRate:Math.max(useful,target+buildRate)).toFixed(2),builderWork,feedbackTicks:feedback?feedback.observedTicks:0,incomeBasis:feedback?'measured-harvest':'active-work-potential',harvestPotential:harvest,plannedHarvest,upkeep:+upkeep.toFixed(2),reserveRate,usefulTarget:+useful.toFixed(2),buildEnergyTarget:+buildRate.toFixed(2),routes});
}
function upgradePolicy(room) {
    const base=baseUpgradePolicy(room),m=Memory.frontier&&Memory.frontier.rooms&&Memory.frontier.rooms[room.name],control=m&&m.economyControl;
    return control&&control.baseMode===base.mode&&Game.time-control.at<200?{target:control.target,mode:control.mode}:base;
}

// Phase, immediate security and measured CPU pressure are orthogonal. The health
// signature is cheap and lets a death, lost node, new/completed site or RCL
// transition bypass the normal economic interval without rescanning path costs.
let policyTick=-1,policyCache={};
function policy(room) {
    const m=economyMemory(room),performance=Memory.frontier&&Memory.frontier.performance;
    const cpuRecovery=!!(Game.cpu&&performance&&performance.mean>Game.cpu.limit&&Game.cpu.bucket<Game.cpu.limit*50);
    if(policyTick!==Game.time){policyTick=Game.time;policyCache={};}
    const cached=policyCache[room.name];if(cached&&cached.room===room&&cached.memory===m&&cached.cpuRecovery===cpuRecovery)return cached.value;
    const all=allCreeps().filter(c=>c.memory.home===room.name);
    const productive=role=>all.some(c=>c.memory.role===role&&(c.spawning||c.getActiveBodyparts(role==='hauler'?CARRY:WORK)>0));
    const missingSources=sources(room).filter(s=>!all.some(c=>c.memory.role==='miner'&&c.memory.source===s.id&&(c.spawning||c.getActiveBodyparts(WORK)>0))).map(s=>s.id);
    const bootstrap=room.controller.level===1;
    const recovery=missingSources.length>0||!productive('hauler')||!productive('upgrader');
    const threatened=hostiles(room).some(c=>!c.getActiveBodyparts||[ATTACK,RANGED_ATTACK,WORK,HEAL,CLAIM].some(p=>c.getActiveBodyparts(p)>0));
    const value={tick:Game.time,phase:bootstrap?'bootstrap':recovery?'recovery':room.controller.level===8?'mature':'growth',
        security:threatened?'threatened':'normal',cpuMode:cpuRecovery?'recovery':'normal',missingSources,
        reason:bootstrap?'initial-controller':recovery?'essential-role-gap':room.controller.level===8?'controller-mature':'economy-closed'};
    m.colonyPolicy=value;policyCache[room.name]={room,memory:m,cpuRecovery,value};return value;
}
function criticalSignature(room,status) {
    const all=allCreeps().filter(c=>c.memory.home===room.name);
    const roster=all.map(c=>[c.name,c.memory.role,c.memory.source||'',Number(!!c.spawning),c.getActiveBodyparts(WORK),c.getActiveBodyparts(CARRY)].join(':')).sort();
    const nodes=structures(room).filter(s=>[STRUCTURE_SPAWN,STRUCTURE_CONTAINER,STRUCTURE_STORAGE,STRUCTURE_LINK].includes(s.structureType)).map(s=>s.id).sort();
    const sites=constructionSites(room).filter(s=>s.structureType!==STRUCTURE_RAMPART).map(s=>s.id).sort();
    return [room.controller.level,status.phase,status.security,status.cpuMode,roster.join(','),nodes.join(','),sites.join(',')].join('|');
}
module.exports={baseUpgradePolicy,economyMemory,routeTravel,updateEconomy,upgradePolicy,policy};
