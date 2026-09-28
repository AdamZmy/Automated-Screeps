'use strict';
const {vals,range,energy,alive,allCreeps,spawns,sources,stores,miningSpots}=require('runtime');
const {controllerStation,constructionJobs,upgradePolicy,upgraderAssignment,economyMemory,updateEconomy,routeTravel}=require('development');
function workerDuty(room,parts,job,stationary=false,nodes=null) {
    const count=type=>parts.filter(p=>(p.type||p)===type).length;
    const work=count(WORK),carry=count(CARRY),move=count(MOVE);
    if(!work||!carry||!move)return 0;
    const step=Math.max(1,Math.ceil((work+carry)/move));
    const spawn=spawns(room)[0],travel=spawn&&spawn.pos?Math.max(0,range(spawn,job)-3)*step:10;
    const lifetime=Math.max(.5,(1500-travel)/1500);
    if(stationary)return lifetime; // prefuel and upgrade are concurrent intents
    nodes=nodes||stores(room).filter(s=>[STRUCTURE_CONTAINER,STRUCTURE_STORAGE,STRUCTURE_LINK].includes(s.structureType));
    const distance=nodes.length?Math.min(...nodes.map(s=>Math.max(0,range(s,job)-4))):10;
    const active=carry*50/(work*(job===room.controller?1:BUILD_POWER));
    // Work within range three and withdrawal within range one may share a tile.
    // Otherwise allow an out-and-back journey, plus the refill action itself.
    return lifetime*active/(active+2*Math.ceil(distance*1.5)*step+1);
}
function workforceDemand(room,control,all) {
    const station=controllerStation(room),job=constructionJobs(room)[0],budget=room.energyCapacityAvailable;
    const pool=Math.max(0,Math.min(control.usefulTarget,control.developmentBudget));
    const options={stationary:!!(station&&station.seats.length)};
    const remaining=job?constructionJobs(room).reduce((n,s)=>n+(Number.isFinite(s.progressTotal)?Math.max(0,s.progressTotal-s.progress):Infinity),0):0;
    const nodes=stores(room).filter(s=>[STRUCTURE_CONTAINER,STRUCTURE_STORAGE,STRUCTURE_LINK].includes(s.structureType));
    const parts=b=>b?b.filter(p=>p===WORK).length:0;
    const cost=b=>b?b.reduce((n,p)=>n+BODYPART_COST[p],0):0;
    const upgraders=all.filter(c=>c.memory.role==='upgrader').sort((a,b)=>b.getActiveBodyparts(WORK)-a.getActiveBodyparts(WORK)||a.name.localeCompare(b.name));
    const seated=options.stationary?upgraders.slice(0,station.seats.length):upgraders;
    const effectiveUp=seated.reduce((n,c)=>n+c.getActiveBodyparts(WORK)*workerDuty(room,c.body,room.controller,options.stationary,nodes),0);
    const weakest=options.stationary&&upgraders.length>=station.seats.length?seated[seated.length-1]:null;
    const replacedRate=weakest?weakest.getActiveBodyparts(WORK)*workerDuty(room,weakest.body,room.controller,true,nodes):0;
    const support=upgradePolicy(room).mode==='infrastructure'?upgraderAssignment(room).support:[];
    const builders=all.filter(c=>c.memory.role==='builder'||c.memory.role==='bootstrap'||support.includes(c));
    const effectiveBuild=job?builders.reduce((n,c)=>n+c.getActiveBodyparts(WORK)*BUILD_POWER*workerDuty(room,c.body,job,false,nodes),0):0;
    // Compare legal role bodies against the exact capacity still missing, with
    // each candidate's own refill/travel duty and recurring lifetime cost. The
    // first sufficient body is cheapest; otherwise retain the best affordable
    // capacity. Full stations must recover the seat being replaced as well.
    const select=(role,limit,retained,task,stationary,target)=>{
        let best=null;
        const maxWork=parts(body(role,limit,{stationary}));
        for(let work=1;work<=maxWork;work++){
            const candidate=body(role,limit,{stationary,workLimit:work}),price=cost(candidate);
            const duty=workerDuty(room,candidate,task,stationary,nodes),rate=target(price);
            const capacity=parts(candidate)*duty*(role==='builder'?BUILD_POWER:1);
            const choice={body:candidate,duty,rate,capacity};
            if(retained+capacity>=rate)return choice;
            if(!best||capacity>best.capacity)best=choice;
        }
        return best||{body:null,duty:1,rate:target(0),capacity:0};
    };
    // A slow priority-share transition cannot cap staffing after sites end.
    const nextUp=select('upgrader',budget,effectiveUp-replacedRate,room.controller,options.stationary,
        price=>Math.max(2,Math.min(job?control.target:pool,pool)-price/1500));
    const {body:upgradeBody,duty:upgradeDuty,rate:upgradeRate}=nextUp;
    let upgrade=effectiveUp<upgradeRate&&!!upgradeBody;
    if(upgrade&&weakest){
        const gain=Math.min(upgradeRate-effectiveUp,nextUp.capacity-replacedRate);
        const horizon=Math.max(0,Math.min(weakest.ticksToLive||1500,1500)-upgradeBody.length*CREEP_SPAWN_TIME-50);
        // Allow one profitable stronger seat occupant, retaining the displaced
        // worker for ordinary work. A pending birth prevents duplicate upgrades.
        upgrade=!upgraders.some(c=>c.spawning)&&gain*horizon>cost(upgradeBody);
    }
    const nextBuild=job?select('builder',Math.min(budget,Math.max(300,remaining)),effectiveBuild,job,false,
        price=>Math.max(0,Math.min(control.buildEnergyTarget,pool-price/1500))):{body:null,duty:1,rate:0};
    const {body:builderBody,duty:buildDuty,rate:buildRate}=nextBuild;
    const spawn=spawns(room)[0];
    const buildLead=builderBody?builderBody.length*CREEP_SPAWN_TIME+(job&&spawn&&spawn.pos?range(spawn,job)*2:0)+20:0;
    return {upgrade,upgradeBody,builderBody,upgradeWork:Math.ceil(upgradeRate/Math.max(.2,upgradeDuty)),
        builderWork:job?Math.ceil(buildRate/(BUILD_POWER*Math.max(.2,buildDuty))):0,
        upgradeRate:+upgradeRate.toFixed(2),effectiveUp:+effectiveUp.toFixed(2),effectiveBuild:+effectiveBuild.toFixed(2),
        build:!!(job&&builderBody&&effectiveBuild<buildRate&&remaining>effectiveBuild*buildLead),stationSeats:options.stationary?station.seats.length:0};
}
function body(role,budget,options={}) {
    if(role==='miner'){
        for(const b of [[WORK,WORK,WORK,WORK,WORK,CARRY,MOVE,MOVE,MOVE],[WORK,WORK,WORK,WORK,CARRY,MOVE,MOVE],[WORK,WORK,WORK,CARRY,MOVE,MOVE],[WORK,WORK,CARRY,MOVE],[WORK,CARRY,MOVE]])if(b.reduce((s,p)=>s+BODYPART_COST[p],0)<=budget)return b;
    }
    if(role==='hauler'){const n=Math.max(1,Math.min(25,Math.floor(budget/100)));return Array(n).fill(CARRY).concat(Array(n).fill(MOVE));}
    if(role==='upgrader'||role==='builder'){
        // Fixed workers pay movement only on their initial journey. Mobile
        // workers keep a two-tick plain step and enough fuel for useful batches.
        for(let work=Math.min(50,Math.floor(options.workLimit===undefined?50:options.workLimit));work>=1;work--){
            const carry=Math.max(1,Math.ceil(work*(role==='builder'?1.2:options.stationary?.25:.4)));
            const move=Math.max(1,Math.ceil((work+carry)/(options.stationary?4:2)));
            const b=Array(work).fill(WORK).concat(Array(carry).fill(CARRY),Array(move).fill(MOVE));
            if(b.length<=50&&b.reduce((n,p)=>n+BODYPART_COST[p],0)<=budget)return b;
        }
        return budget>=200?[WORK,CARRY,MOVE]:null;
    }
    const n=Math.max(1,Math.min(4,Math.floor(budget/200)));return Array(n).fill(WORK).concat(Array(n).fill(CARRY),Array(n).fill(MOVE));
}
function minerReplacement(room,all,spawn) {
    const next=body('miner',room.energyCapacityAvailable);if(!next)return null;
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
    const next=body('miner',room.energyCapacityAvailable);
    if(!next)return null;
    const queue=spawns(room).reduce((n,s)=>Math.max(n,s.spawning&&s.spawning.remainingTime||0),0);
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
    const roster=allCreeps(true).filter(c=>c.memory.home===room.name);
    const all=roster.filter(alive);
    const control=updateEconomy(room);
    const upWork=all.filter(c=>c.memory.role==='upgrader').reduce((s,c)=>s+c.getActiveBodyparts(WORK),0);
    const policy=upgradePolicy(room),demand=workforceDemand(room,control,all),desiredUp=demand.upgradeWork;
    if(Memory.frontier&&Memory.frontier.rooms){const m=Memory.frontier.rooms[room.name]||(Memory.frontier.rooms[room.name]={});m.economy={upgradeWorkTarget:desiredUp,upgradeWork:upWork,mode:policy.mode,reason:control.reason,carryTarget:control.carry,builderWorkTarget:demand.builderWork,upgradeEffectiveRate:demand.effectiveUp,upgradeEnergyTarget:demand.upgradeRate,stationSeats:demand.stationSeats,builderEffectiveRate:demand.effectiveBuild,harvestPotential:control.harvestPotential,usefulEnergyTarget:control.usefulTarget,buildEnergyTarget:control.buildEnergyTarget,reserveRate:control.reserveRate,upkeep:control.upkeep,feedbackTicks:control.feedbackTicks,incomeBasis:control.incomeBasis,decisionTick:control.at,routes:control.routes};}
    const sp=spawns(room).find(s=>!s.spawning);if(!sp)return;
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
    if(!role&&demand.build)role='builder';
    // Observed overload can exhaust the bucket before a new small colony's
    // bodies expire. Stop discretionary births during recovery, not creep
    // actions. Mining renewal and missing essential roles remain protected.
    const performance=Memory.frontier&&Memory.frontier.performance;
    const cpuRecovery=Game.cpu&&performance&&performance.mean>Game.cpu.limit&&Game.cpu.bucket<Game.cpu.limit*50;
    roomEconomy.spawnHold=cpuRecovery?'cpu-recovery':null;
    const missingMine=role==='miner'&&!all.some(c=>c.memory.role==='miner'&&c.memory.source===extra.source&&c.getActiveBodyparts(WORK)>0);
    const missingWork=!all.some(c=>['upgrader','builder','bootstrap','pioneer'].includes(c.memory.role)&&c.getActiveBodyparts(WORK)>0);
    if(cpuRecovery&&!(role==='miner'&&(renewal||missingMine)||role==='hauler'&&haulers===0||role==='bootstrap'&&miners===0||
        (role==='upgrader'||role==='builder')&&missingWork))return;
    if(!role&&room.controller.level>=2&&!count('scout')&&global.frontierExpansion){global.frontierExpansion.spawn(room,sp,all);return;}
    if(!role&&demand.upgrade)role='upgrader';
    if(!role&&global.frontierExpansion){global.frontierExpansion.spawn(room,sp,all);return;}
    if(!role)return;
    const emergency=all.length<2||role==='hauler'&&haulers===0||role==='bootstrap'&&miners===0;
    let budget=emergency?room.energyAvailable:room.energyCapacityAvailable;
    if(role==='bootstrap')budget=Math.min(budget,400);
    if(role==='hauler'&&!emergency)budget=Math.min(budget,Math.max(2,desiredCarry-carry)*100);
    // Builders are sized for fuel/travel duty, not the last nominal WORK gap.
    const b=role==='upgrader'&&!emergency?demand.upgradeBody:role==='builder'&&!emergency?demand.builderBody:body(role,budget);if(!b)return;
    const cost=b.reduce((s,p)=>s+BODYPART_COST[p],0);if(room.energyAvailable<cost)return;
    const name=role+'-'+Game.time+'-'+room.name;
    sp.spawnCreep(b,name,{memory:Object.assign({role,home:room.name},extra)});
}

module.exports={workerDuty,workforceDemand,body,minerReplacement,minerRenewal,spawnRoom};
