'use strict';
const {vals,range,energy,alive,allCreeps,spawns,sources,stores,miningSpots}=require('runtime');
const {controllerStation,constructionJobs,upgraderAssignment,criticalRepairs}=require('development');
const {upgradePolicy,economyMemory,updateEconomy,routeTravel,policy:colonyPolicy}=require('colony');
const mining=require('mining');
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
let contextTick=-1,demandContexts={};
function demandContext(room) {
    if(contextTick!==Game.time){contextTick=Game.time;demandContexts={};}
    const jobs=constructionJobs(room),station=controllerStation(room),fixture=room.objects?room.objects.length:0;
    const remaining=jobs.length?jobs.reduce((n,s)=>n+(Number.isFinite(s.progressTotal)?Math.max(0,s.progressTotal-s.progress):Infinity),0):0;
    const jobKey=jobs[0]?jobs[0].id+':'+jobs[0].pos.x+':'+jobs[0].pos.y:'';
    const old=demandContexts[room.name];
    if(old&&old.room===room&&old.jobs===jobs&&old.station===station&&old.fixture===fixture&&old.remaining===remaining&&old.jobKey===jobKey)return old;
    const nodes=stores(room).filter(s=>[STRUCTURE_CONTAINER,STRUCTURE_STORAGE,STRUCTURE_LINK].includes(s.structureType));
    return demandContexts[room.name]={room,jobs,job:jobs[0],station,fixture,nodes,spawn:spawns(room)[0],choices:{},
        remaining,jobKey};
}
function* candidateChoices(room,context,role,limit,stationary) {
    const key=role+':'+limit+':'+Number(stationary),task=role==='builder'?context.job:room.controller;
    let options=context.choices[key];
    if(!options){const largest=body(role,limit,{stationary});options=context.choices[key]={maxWork:largest?largest.filter(p=>p===WORK).length:0,choices:[]};}
    for(let work=1;work<=options.maxWork;work++){
        let choice=options.choices[work-1];
        if(!choice){
            const candidate=body(role,limit,{stationary,workLimit:work}),price=candidate.reduce((n,p)=>n+BODYPART_COST[p],0);
            const duty=workerDuty(room,candidate,task,stationary,context.nodes);
            choice=options.choices[work-1]={body:candidate,price,duty,capacity:candidate.filter(p=>p===WORK).length*duty*(role==='builder'?BUILD_POWER:1)};
        }
        yield choice;
    }
}
function workforceDemand(room,control,all) {
    const context=demandContext(room),{station,job,nodes,remaining}=context,budget=room.energyCapacityAvailable;
    const pool=Math.max(0,Math.min(control.usefulTarget,control.developmentBudget));
    const options={stationary:!!(station&&station.seats.length)};
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
        for(const candidate of candidateChoices(room,context,role,limit,stationary)){
            const rate=target(candidate.price),choice={...candidate,rate};
            if(retained+candidate.capacity>=rate)return choice;
            if(!best||candidate.capacity>best.capacity)best=choice;
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
    if(role==='miner')return null;
    if(role==='hauler'){if(budget<100)return null;const n=Math.max(1,Math.min(25,Math.floor(budget/100)));return Array(n).fill(CARRY).concat(Array(n).fill(MOVE));}
    if(role==='upgrader'||role==='builder'){
        // Fixed workers pay movement only on their initial journey. Mobile
        // workers keep a two-tick plain step and enough fuel for useful batches.
        for(let work=Math.min(50,Math.floor(budget/BODYPART_COST[WORK]),Math.floor(options.workLimit===undefined?50:options.workLimit));work>=1;work--){
            const carry=Math.max(1,Math.ceil(work*(role==='builder'?1.2:options.stationary?.25:.4)));
            const move=Math.max(1,Math.ceil((work+carry)/(options.stationary?4:2)));
            if(work+carry+move<=50&&work*BODYPART_COST[WORK]+carry*BODYPART_COST[CARRY]+move*BODYPART_COST[MOVE]<=budget)
                return Array(work).fill(WORK).concat(Array(carry).fill(CARRY),Array(move).fill(MOVE));
        }
        return budget>=200?[WORK,CARRY,MOVE]:null;
    }
    if(budget<200)return null;
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
    const next=body('miner',room.energyCapacityAvailable);if(!next)return null;
    const available=spawns(room).map(s=>s.spawning&&s.spawning.remainingTime||0);
    // Reserve a peer source renewal in addition to the earliest free spawn.
    const queue=(available.length?Math.min(...available):0)+Math.max(0,Math.ceil(sources(room).length/Math.max(1,available.length))-1)*next.length*CREEP_SPAWN_TIME;
    return mining.replacementNeeds(room,roster,next,queue)[0]||null;
}
const price=parts=>parts.reduce((n,p)=>n+(BODYPART_COST[p.type||p]||0),0);
const demandKey=r=>r.owner+'|'+r.slotKey;
let spawnTick=-1,spawnReservations={};
function roomSpawnState(room) {
    if(spawnTick!==Game.time){spawnTick=Game.time;spawnReservations={};}
    const old=spawnReservations[room.name];
    if(old&&old.room===room)return old;
    return spawnReservations[room.name]={room,used:new Set(),spent:0};
}
function reconcileBirths(room,roster) {
    const m=economyMemory(room),state=m.workforce||(m.workforce={pending:{},waiting:{}});
    state.pending=state.pending||{};state.waiting=state.waiting||{};
    const active=spawns(room),pending=[];
    for(const [key,birth] of Object.entries(state.pending)){
        const creep=Game.creeps[birth.name],spawn=active.find(s=>(s.id||s.name)===birth.spawn);
        if(creep){state.lastConfirmed={tick:Game.time,name:birth.name,owner:birth.owner,slotKey:birth.slotKey,spawning:!!creep.spawning};delete state.pending[key];continue;}
        const observed=spawn&&spawn.spawning&&spawn.spawning.name===birth.name;
        // OK is only a pending intent. The next real snapshot must contain the
        // creep or the named spawn work; otherwise release it for recovery.
        if(Game.time>birth.at&&!observed||Game.time>birth.at+birth.body.length*CREEP_SPAWN_TIME+1){delete state.pending[key];continue;}
        birth.status=observed?'observed-spawning':'accepted-intent';
        pending.push({name:birth.name,memory:birth.memory,body:birth.body,spawning:true,ticksToLive:1500,room,
            getActiveBodyparts:type=>birth.body.filter(p=>(p.type||p)===type).length});
    }
    return {state,roster:roster.concat(pending)};
}
function nextSlot(role,roster) {
    const occupied=new Set(roster.filter(c=>c.memory.role===role&&(c.spawning||(c.ticksToLive||0)>0)).map(c=>c.memory.spawnSlot).filter(Boolean));
    // Existing pre-migration workers count as occupied slots without mutation.
    const legacy=roster.filter(c=>c.memory.role===role&&(c.spawning||(c.ticksToLive||0)>0)&&!c.memory.spawnSlot).length;
    for(let n=0;n<legacy;n++)occupied.add(role+':'+n);
    let n=0;while(occupied.has(role+':'+n))n++;return role+':'+n;
}
function roomRequests(room,roster,control,demand) {
    const all=roster.filter(c=>c.spawning||(c.ticksToLive||0)>0),requests=[],count=role=>all.filter(c=>c.memory.role===role).length;
    const miners=roster.filter(c=>c.memory.role==='miner'&&(c.spawning||(c.ticksToLive||0)>0)&&c.getActiveBodyparts(WORK)>0).length,haulers=count('hauler'),carry=all.filter(c=>c.memory.role==='hauler').reduce((n,c)=>n+c.getActiveBodyparts(CARRY),0);
    const owner='colony:'+room.name,add=(role,parts,priority,essential,reason,memory={},slotKey=nextSlot(role,roster),neededAt=Game.time)=>{
        if(!parts)return;requests.push({id:owner+':'+slotKey,owner,slotKey,home:room.name,role,body:parts,memory,priority,neededAt,essential,reason});
    };
    const immediate=room.energyAvailable,capacity=room.energyCapacityAvailable;
    const missingUp=!all.some(c=>c.memory.role==='upgrader'&&c.getActiveBodyparts(WORK)>0);
    const support=upgradePolicy(room).mode==='infrastructure'?upgraderAssignment(room).support:[];
    const builders=all.filter(c=>['builder','bootstrap'].includes(c.memory.role)||support.includes(c));
    const construction=constructionJobs(room).length>0||criticalRepairs(room).length>0;
    const missingBuild=construction&&!builders.some(c=>c.getActiveBodyparts(WORK)>0);
    if((!count('bootstrap')||count('bootstrap')+count('builder')<2)&&!miners)
        add('bootstrap',body('bootstrap',Math.min(immediate,400)),1100,true,'restore-harvest-and-spawn');
    if(!haulers&&miners)add('hauler',body('hauler',immediate),1050,true,'restore-energy-transport');
    const nextMiner=body('miner',capacity),spawnList=spawns(room),availability=spawnList.map(s=>s.spawning&&s.spawning.remainingTime||0);
    const queue=(availability.length?Math.min(...availability):0)+Math.max(0,Math.ceil(sources(room).length/Math.max(1,spawnList.length))-1)*(nextMiner?nextMiner.length*CREEP_SPAWN_TIME:0);
    const operations=mining.operations(room,roster),renewals=mining.replacementNeeds(room,roster,nextMiner,queue,operations);
    for(const renewal of renewals){
        const operation=operations.find(o=>o.sourceId===renewal.source);
        const parts=operation&&operation.activeWork===0?body('miner',immediate)||nextMiner:nextMiner;
        requests.push({id:renewal.owner+':'+renewal.slotKey,owner:renewal.owner,slotKey:renewal.slotKey,home:room.name,role:'miner',body:parts,
            memory:{source:renewal.source,replaces:renewal.replaces,operationId:operation.id},priority:1000,essential:true,
            neededAt:renewal.neededAt,latestStart:renewal.latestStart,travelTicks:renewal.travel,reason:'source-renewal-deadline'});
    }
    for(const operation of operations){
        const assigned=operation.assigned.filter(c=>c.spawning||(c.ticksToLive||0)>0),work=assigned.filter(c=>!c.memory.replaces).reduce((n,c)=>n+c.getActiveBodyparts(WORK),0);
        if(work>=operation.requiredWork||assigned.length>=operation.seats.length)continue;
        if(renewals.some(r=>r.source===operation.sourceId))continue;
        const parts=!assigned.length?body('miner',immediate)||nextMiner:nextMiner;
        const slotKey='source:'+operation.sourceId+':seat:'+assigned.length;
        requests.push({id:operation.id+':'+slotKey,owner:operation.owner,slotKey,home:room.name,role:'miner',body:parts,
            memory:{source:operation.sourceId,operationId:operation.id},priority:!assigned.length?1020:750,essential:!assigned.length,
            neededAt:Game.time,reason:!assigned.length?'restore-source-harvesting':'source-capacity-gap'});
    }
    // Distinct consumer roles are independent recovery obligations (W005).
    if(missingUp)add('upgrader',body('upgrader',immediate,{stationary:!!demand.stationSeats,workLimit:Math.max(1,control.target)}),950,true,'restore-controller-work');
    if(missingBuild)add('builder',demand.builderBody&&price(demand.builderBody)<=immediate?demand.builderBody:body('builder',immediate)||demand.builderBody,925,true,'restore-construction-or-maintenance');
    if(!requests.some(r=>r.role==='miner')){
        const replacement=minerReplacement(room,all,spawnList[0]);
        if(replacement){const old=roster.find(c=>c.name===replacement.replaces),operation=operations.find(o=>o.sourceId===replacement.source);
            const slotKey=old&&old.memory.spawnSlot||'source:'+replacement.source+':seat:0';
            requests.push({id:operation.id+':'+slotKey,owner:operation.owner,slotKey,home:room.name,role:'miner',body:nextMiner,
                memory:{...replacement,operationId:operation.id},priority:700,neededAt:Game.time,essential:false,reason:'profitable-miner-upgrade'});
        }
    }
    if(haulers&&carry<control.carry)add('hauler',body('hauler',Math.min(capacity,Math.max(2,control.carry-carry)*100)),500,false,'transport-capacity-gap');
    if(!missingBuild&&demand.build)add('builder',demand.builderBody,400,false,'effective-construction-gap');
    if(!missingUp&&demand.upgrade)add('upgrader',demand.upgradeBody,300,false,'effective-upgrade-gap');
    return requests;
}
function workerRenewals(room,roster,control) {
    const requests=[],owner='colony:'+room.name,sp=spawns(room)[0];
    const timeline=spawns(room).map(s=>s.spawning&&s.spawning.remainingTime||0);if(!timeline.length)return requests;
    const sourceTrips=control.routes||[],haulTravel=sourceTrips.length?Math.max(...sourceTrips.map(r=>r.roundTrip/2)):sp&&sp.pos?Math.max(1,range(sp,room.controller)):1;
    const current=roster.filter(c=>c.spawning||(c.ticksToLive||0)>0),replaced=new Set(current.map(c=>c.memory.replaces).filter(Boolean));
    const projected=current.slice();
    const job=constructionJobs(room)[0],maxLead={},repairs=criticalRepairs(room),roles=new Set(current.map(c=>c.memory.role));
    for(const role of ['hauler','upgrader','builder']){
        if(!roles.has(role))continue;
        const parts=body(role,room.energyCapacityAvailable,{stationary:role==='upgrader'&&!!controllerStation(room)});
        if(!parts){maxLead[role]=0;continue;}
        const moving=parts.filter(p=>p===MOVE).length,loaded=parts.length-moving;
        const target=role==='builder'?job||room.controller:room.controller;
        const travel=role==='hauler'?haulTravel:sp&&sp.pos?Math.max(0,range(sp,target)-3)*Math.max(1,Math.ceil(loaded/moving)):haulTravel;
        maxLead[role]=parts.length*CREEP_SPAWN_TIME+travel;
    }
    const candidates=current.filter(c=>!c.spawning&&['hauler','upgrader','builder'].includes(c.memory.role)&&!replaced.has(c.name)).sort((a,b)=>a.ticksToLive-b.ticksToLive||a.name.localeCompare(b.name));
    for(const old of candidates){
        const role=old.memory.role;
        if(old.ticksToLive>Math.min(...timeline)+maxLead[role])continue;
        if(role==='builder'&&!job&&!repairs.length)continue;
        const without=projected.filter(c=>c!==old),demand=role==='hauler'?null:workforceDemand(room,control,without);
        const carry=without.filter(c=>c.memory.role==='hauler').reduce((n,c)=>n+c.getActiveBodyparts(CARRY),0);
        let parts=role==='hauler'&&carry<control.carry?body(role,Math.min(room.energyCapacityAvailable,Math.max(2,control.carry-carry)*100)):
            role==='upgrader'&&demand.upgrade?demand.upgradeBody:role==='builder'&&demand.build?demand.builderBody:role==='builder'&&repairs.length&&!without.some(c=>c.memory.role==='builder'&&(c.spawning||c.ticksToLive>maxLead.builder)&&c.getActiveBodyparts(WORK)>0)?body('builder',Math.min(room.energyCapacityAvailable,300)):null;
        if(!parts)continue;
        const task=role==='builder'?constructionJobs(room)[0]||room.controller:room.controller;
        const work=parts.filter(p=>p===WORK).length,carrying=parts.filter(p=>p===CARRY).length,moving=parts.filter(p=>p===MOVE).length;
        const travel=role==='hauler'?haulTravel:sp&&sp.pos?Math.max(0,range(sp,task)-3)*Math.max(1,Math.ceil((work+carrying)/moving)):haulTravel;
        const first=timeline.indexOf(Math.min(...timeline)),birth=parts.length*CREEP_SPAWN_TIME,lead=timeline[first]+birth+travel;
        if(old.ticksToLive>lead)continue;
        const peers=current.filter(c=>c.memory.role===role).sort((a,b)=>a.name.localeCompare(b.name));
        const slotKey=old.memory.spawnSlot||role+':'+peers.indexOf(old);
        const surviving=without.some(c=>c.memory.role===role&&(c.spawning||c.ticksToLive>lead)&&c.getActiveBodyparts(role==='hauler'?CARRY:WORK)>0);
        const request={id:owner+':'+slotKey,owner,slotKey,home:room.name,role,body:parts,memory:{replaces:old.name},priority:surviving?600:1000,
            neededAt:Game.time+old.ticksToLive,latestStart:Game.time+old.ticksToLive-birth-travel,travelTicks:travel,essential:!surviving,reason:role+'-renewal-deadline'};
        requests.push(request);timeline[first]+=birth;
        // Planned replacement substitutes capacity in subsequent projections;
        // it is never added to current delivered/harvested energy estimates.
        projected.splice(projected.indexOf(old),1,{name:'requested:'+old.name,memory:{role},body:parts,spawning:true,ticksToLive:1500,
            getActiveBodyparts:type=>parts.filter(p=>p===type).length});
    }
    return requests;
}
let busyPlans={};
function busyPlanKey(room,control,roster,active,recovering) {
    // Absolute death and spawn-completion ticks stay constant during ordinary
    // progress. Unexpected lifespan changes, body damage and role transfers
    // invalidate the plan just like policy or infrastructure changes.
    return [control.at,control.eventSignature,control.target,control.carry,control.buildEnergyTarget,control.usefulTarget,control.developmentBudget,
        room.energyCapacityAvailable,Number(recovering),Number(room.controller.ticksToDowngrade<4000),
        criticalRepairs(room).map(r=>r.node.id).join(','),
        active.map(s=>(s.id||s.name)+':'+(s.spawning?s.spawning.name+':'+(Game.time+s.spawning.remainingTime):'free')).join(','),
        roster.map(c=>[c.name,c.memory.role,c.memory.source||'',c.memory.replaces||'',c.getActiveBodyparts(WORK),c.getActiveBodyparts(CARRY),
            c.spawning?'spawning':Game.time+(c.ticksToLive||0)].join(':')).join(',')].join('|');
}
function spawnRoom(room,externalRequests=[]) {
    const reconciled=reconcileBirths(room,allCreeps(true).filter(c=>c.memory.home===room.name)),roster=reconciled.roster,state=reconciled.state;
    const all=roster.filter(c=>c.spawning||(c.ticksToLive||0)>0),control=updateEconomy(room),policy=upgradePolicy(room),m=economyMemory(room);
    const reserved=roomSpawnState(room),active=spawns(room),recovering=colonyPolicy(room).cpuMode==='recovery';
    const busy=!active.some((s,i)=>!s.spawning&&!reserved.used.has(s.id||s.name||String(i)));
    const key=busy?busyPlanKey(room,control,roster,active,recovering):null,cached=busyPlans[room.name];
    let demand,internal;
    if(busy&&cached&&cached.key===key&&cached.at<=Game.time&&m.economy){
        demand=cached.demand;internal=cached.internal;state.planReused=true;
    }else{
        demand=workforceDemand(room,control,all);
        const renewals=workerRenewals(room,roster,control);
        const ordinary=roomRequests(room,roster,control,demand).filter(r=>!renewals.some(n=>n.role===r.role)&&!roster.some(c=>c.spawning&&c.memory.role===r.role&&c.memory.replaces&&r.reason.endsWith('gap')));
        internal=ordinary.concat(renewals);state.planningTick=Game.time;state.planReused=false;
        if(busy)busyPlans[room.name]={at:Game.time,key,demand,internal};else delete busyPlans[room.name];
    }
    const capacity=role=>all.filter(c=>c.memory.role===role).reduce((n,c)=>n+c.getActiveBodyparts(role==='hauler'?CARRY:WORK),0);
    m.economy={upgradeWorkTarget:demand.upgradeWork,upgradeWork:capacity('upgrader'),mode:policy.mode,reason:control.reason,carryTarget:control.carry,
        carry:capacity('hauler'),builderWork:capacity('builder')+capacity('bootstrap'),builderWorkTarget:demand.builderWork,upgradeEffectiveRate:demand.effectiveUp,
        upgradeEnergyTarget:demand.upgradeRate,stationSeats:demand.stationSeats,builderEffectiveRate:demand.effectiveBuild,harvestPotential:control.harvestPotential,
        usefulEnergyTarget:control.usefulTarget,buildEnergyTarget:control.buildEnergyTarget,reserveRate:control.reserveRate,upkeep:control.upkeep,
        feedbackTicks:control.feedbackTicks,incomeBasis:control.incomeBasis,decisionTick:control.at,routes:control.routes};
    m.economy.spawnHold=recovering?'cpu-recovery':null;
    const unique=new Map();
    for(const request of internal.concat(externalRequests||[])){
        if(!request||request.home!==room.name||!request.owner||!request.slotKey||!request.role||!Array.isArray(request.body)||!request.body.length||request.body.length>50||request.body.some(p=>!BODYPART_COST[p])||request.expiresAt!==undefined&&request.expiresAt<Game.time)continue;
        const key=demandKey(request),previous=unique.get(key);
        if(!previous||(request.priority||0)>(previous.priority||0))unique.set(key,request);
    }
    const wanted=new Set(unique.keys());for(const key of Object.keys(state.waiting))if(!wanted.has(key))delete state.waiting[key];
    const requests=[];
    for(const [key,request] of unique){
        const occupied=roster.some(c=>c.memory.role===request.role&&c.name!==request.memory?.replaces&&(c.spawning||(c.ticksToLive||0)>0)&&c.memory.spawnOwner===request.owner&&c.memory.spawnSlot===request.slotKey);
        if(occupied||state.pending[key]){delete state.waiting[key];continue;}
        const wait=state.waiting[key]||(state.waiting[key]={since:Game.time});
        wait.reason=recovering&&!request.essential?'cpu-recovery':busy?'all-spawns-busy':'queued';
        const travel=request.travelTicks||0,latest=request.latestStart===undefined?(request.neededAt===undefined?Game.time:request.neededAt)-request.body.length*CREEP_SPAWN_TIME-travel:request.latestStart;
        requests.push({...request,key,latestStart:latest,waitingSince:wait.since});
    }
    // Waiting earns one priority point per engine spawn-part interval, within
    // essential/discretionary classes. Old optional work eventually overtakes
    // fresh optional work; it never promotes itself above a broken lifeline.
    const priority=r=>(r.priority||0)+Math.floor((Game.time-r.waitingSince)/CREEP_SPAWN_TIME);
    requests.sort((a,b)=>Number(!!b.essential)-Number(!!a.essential)||(a.essential&&b.essential?a.latestStart-b.latestStart:0)||priority(b)-priority(a)||a.latestStart-b.latestStart||a.waitingSince-b.waitingSince||a.key.localeCompare(b.key));
    const accepted=[];
    for(let index=0;index<active.length;index++){
        const spawn=active[index],spawnKey=spawn.id||spawn.name||String(index);
        if(spawn.spawning||reserved.used.has(spawnKey))continue;
        let budget=Math.max(0,room.energyAvailable-reserved.spent);
        for(const [requestIndex,request] of requests.entries()){
            if(request.done||recovering&&!request.essential)continue;
            const cost=price(request.body),wait=state.waiting[request.key];
            if(cost>budget){wait.reason='insufficient-energy';continue;}
            // A lower job must leave funds and spawn time for an unaffordable
            // critical request whose latest start is already due.
            const blocked=requests.find((r,i)=>i<requestIndex&&!r.done&&r.essential&&price(r.body)>budget&&r.latestStart<=Game.time+request.body.length*CREEP_SPAWN_TIME);
            if(blocked){wait.reason='critical-deadline-reservation';continue;}
            const name=request.role+'-'+Game.time+'-'+room.name+'-'+index;
            const memory={...request.memory,role:request.role,home:room.name,owner:request.owner,spawnOwner:request.owner,spawnSlot:request.slotKey,
                birthRoom:room.name,bornAt:Game.time};
            const code=spawn.spawnCreep(request.body,name,{memory});
            state.lastAttempt={tick:Game.time,id:request.id,owner:request.owner,slotKey:request.slotKey,spawn:spawnKey,code,reason:request.reason};
            if(code!==OK){wait.reason='spawn-error:'+code;continue;}
            request.done=true;reserved.used.add(spawnKey);reserved.spent+=cost;
            state.pending[request.key]={name,spawn:spawn.id||spawn.name,at:Game.time,owner:request.owner,slotKey:request.slotKey,body:request.body,memory,status:'accepted-intent'};
            delete state.waiting[request.key];accepted.push({name,role:request.role,slotKey:request.slotKey,cost});break;
        }
    }
    state.tick=Game.time;state.queued=requests.filter(r=>!r.done).map(r=>({id:r.id,owner:r.owner,slotKey:r.slotKey,role:r.role,priority:r.priority,neededAt:r.neededAt,
        latestStart:r.latestStart,waitingSince:r.waitingSince,reason:state.waiting[r.key]&&state.waiting[r.key].reason,essential:!!r.essential}));
    return accepted;
}
module.exports={workerDuty,workforceDemand,body,minerReplacement,minerRenewal,roomRequests,workerRenewals,reconcileBirths,spawnRoom};
