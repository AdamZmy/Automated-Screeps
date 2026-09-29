'use strict';
const {range,allCreeps,spawns,sources,stores,miningSpots}=require('runtime');
const {controllerStation,constructionJobs,workerAssignment,workerRole,isWorker,criticalRepairs}=require('development');
const {upgradePolicy,economyMemory,updateEconomy,policy:colonyPolicy}=require('colony');
const mining=require('mining');
const isWorkerRole=role=>role==='worker'||role==='upgrader'||role==='builder'||role==='repairman';
function workerWorkTarget(room,control) {
    const planned=control&&Number.isFinite(control.plannedHarvest)?control.plannedHarvest:0;
    const theoretical=sources(room).reduce((n,s)=>n+(s.energyCapacity||SOURCE_ENERGY_CAPACITY)/ENERGY_REGEN_TIME,0);
    // Planned harvest includes miners in transit. When no miner has been
    // observed yet, retain one WORK for bootstrap rather than spawning no
    // consumer at all. The room's two normal sources cap this at 20 WORK.
    const level=planned>0?(theoretical>0?Math.min(planned,theoretical):planned):theoretical;
    return Math.max(sources(room).length?1:0,Math.min(20,Math.ceil(level)));
}
function workerWork(all) {
    return (all||[]).filter(c=>isWorker(c)||c.memory&&c.memory.role==='bootstrap')
        .reduce((n,c)=>n+c.getActiveBodyparts(WORK),0);
}
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
    return demandContexts[room.name]={room,jobs,job:jobs[0],station,fixture,nodes,spawn:spawns(room)[0],
        remaining,jobKey};
}
function workforceDemand(room,control,all) {
    const context=demandContext(room),{station,job,nodes,remaining}=context,budget=room.energyCapacityAvailable;
    const assignment=workerAssignment(room),target=workerWorkTarget(room,control),current=workerWork(all),
        fullBody=body('worker',budget),fullWork=fullBody?fullBody.filter(p=>(p.type||p)===WORK).length:0,
        deficit=Math.max(0,target-current),nextWork=Math.min(fullWork,deficit),workerBody=nextWork?body('worker',budget,{workLimit:nextWork}):null;
    const upgraders=assignment.upgraders;
    const builders=assignment.builders.concat(all.filter(c=>c.memory.role==='bootstrap'));
    const repairmen=assignment.repairmen;
    const effectiveUp=upgraders.reduce((n,c)=>n+c.getActiveBodyparts(WORK)*workerDuty(room,c.body,room.controller,!!(station&&station.seats.length),nodes),0);
    const effectiveBuild=job?builders.reduce((n,c)=>n+c.getActiveBodyparts(WORK)*BUILD_POWER*workerDuty(room,c.body,job,false,nodes),0):0;
    const upgradeWork=upgraders.reduce((n,c)=>n+c.getActiveBodyparts(WORK),0);
    const builderWork=assignment.builders.reduce((n,c)=>n+c.getActiveBodyparts(WORK),0);
    const repairWork=repairmen.reduce((n,c)=>n+c.getActiveBodyparts(WORK),0);
    // This is the engine-equivalent instantaneous demand. It is intentionally
    // exposed because BUILD_POWER is higher than one energy per WORK in the
    // actual game, even though staffing is sized by the unified WORK pool.
    const workerEnergyDemand=upgradeWork+repairWork+(builderWork+all.filter(c=>c.memory.role==='bootstrap').reduce((n,c)=>n+c.getActiveBodyparts(WORK),0))*BUILD_POWER;
    const workerDutyRate=workerBody?workerDuty(room,workerBody,job||room.controller,false,nodes):1;
    const spawn=spawns(room)[0];
    const buildLead=workerBody?workerBody.length*CREEP_SPAWN_TIME+(job&&spawn&&spawn.pos?range(spawn,job)*2:0)+20:0;
    // One worker body is used for every future consumer. The final body is
    // capped by the exact remaining WORK deficit, so the room converges to
    // its harvest WORK target instead of adding a whole extra worker.
    return {worker:!!workerBody,workerBody,workerWork:nextWork,workerWorkTarget:target,
        workerCount:fullWork?Math.ceil(target/fullWork):0,
        upgrade:!!workerBody,upgradeBody:workerBody,builderBody:workerBody,
        upgradeWork,builderWork,repairWork,workerEnergyDemand,
        upgradeRate:+effectiveUp.toFixed(2),effectiveUp:+effectiveUp.toFixed(2),effectiveBuild:+effectiveBuild.toFixed(2),
        build:!!(job&&workerBody&&remaining>effectiveBuild*buildLead),
        builderWorkTarget:job?Math.ceil((control.buildEnergyTarget||0)/BUILD_POWER):0,
        stationSeats:station&&station.seats?station.seats.length:0,workerDuty:+workerDutyRate.toFixed(3)};
}
function body(role,budget,options={}) {
    if(role==='miner'){
        for(const b of [[WORK,WORK,WORK,WORK,WORK,CARRY,MOVE,MOVE,MOVE],[WORK,WORK,WORK,WORK,CARRY,MOVE,MOVE],[WORK,WORK,WORK,CARRY,MOVE,MOVE],[WORK,WORK,CARRY,MOVE],[WORK,CARRY,MOVE]])if(b.reduce((s,p)=>s+BODYPART_COST[p],0)<=budget)return b;
    }
    if(role==='miner')return null;
    if(role==='hauler'){if(budget<100)return null;const n=Math.max(1,Math.min(25,Math.floor(budget/100)));return Array(n).fill(CARRY).concat(Array(n).fill(MOVE));}
    if(role==='worker'||role==='upgrader'||role==='builder'||role==='repairman'){
        // All development workers use one mobile body template. Work roles
        // are runtime state, so builders and repairmen cannot get a different
        // birth body from upgraders. The legacy names are accepted only as
        // body-builder aliases; all live spawn requests use role "worker".
        for(let work=Math.min(50,Math.floor(budget/BODYPART_COST[WORK]),Math.floor(options.workLimit===undefined?50:options.workLimit));work>=1;work--){
            const carry=Math.max(1,Math.ceil(work*.5));
            const move=Math.max(1,Math.ceil((work+carry)/2));
            if(work+carry+move<=50&&work*BODYPART_COST[WORK]+carry*BODYPART_COST[CARRY]+move*BODYPART_COST[MOVE]<=budget)
                return Array(work).fill(WORK).concat(Array(carry).fill(CARRY),Array(move).fill(MOVE));
        }
        return budget>=200?[WORK,CARRY,MOVE]:null;
    }
    if(role!=='bootstrap')return null;
    if(budget<200)return null;
    const n=Math.max(1,Math.min(4,Math.floor(budget/200)));return Array(n).fill(WORK).concat(Array(n).fill(CARRY),Array(n).fill(MOVE));
}
const HAULER_CAPACITY_FRACTION=.5;
function standardHaulerBudget(room) {
    const capacity=Number(room&&room.energyCapacityAvailable);
    if(!Number.isFinite(capacity)||capacity<100)return 0;
    // Keep ordinary transport bodies stable within an RCL. Round only through
    // body(), which can spend complete CARRY+MOVE pairs; emergency recovery
    // below may still use the currently available energy.
    return Math.max(100,Math.floor(capacity*HAULER_CAPACITY_FRACTION));
}
function standardHaulerBody(room) {
    const budget=standardHaulerBudget(room);return budget?body('hauler',budget):null;
}
function emergencyHaulerBody(room) {
    return body('hauler',Number(room&&room.energyAvailable)||0);
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
    const matches=c=>role==='worker'?isWorker(c):c.memory.role===role;
    const occupied=new Set(roster.filter(c=>matches(c)&&(c.spawning||(c.ticksToLive||0)>0)).map(c=>c.memory.spawnSlot).filter(Boolean));
    // Existing pre-migration workers count as occupied slots without mutation.
    const legacy=roster.filter(c=>matches(c)&&(c.spawning||(c.ticksToLive||0)>0)&&!c.memory.spawnSlot).length;
    for(let n=0;n<legacy;n++)occupied.add(role+':'+n);
    let n=0;while(occupied.has(role+':'+n))n++;return role+':'+n;
}
function roomRequests(room,roster,control,demand) {
    const all=roster.filter(c=>c.spawning||(c.ticksToLive||0)>0),requests=[],count=role=>all.filter(c=>c.memory.role===role).length;
    const workerCount=all.filter(isWorker).length;
    const miners=roster.filter(c=>c.memory.role==='miner'&&(c.spawning||(c.ticksToLive||0)>0)&&c.getActiveBodyparts(WORK)>0).length,haulers=count('hauler'),carry=all.filter(c=>c.memory.role==='hauler').reduce((n,c)=>n+c.getActiveBodyparts(CARRY),0);
    const owner='colony:'+room.name,add=(role,parts,priority,essential,reason,memory={},slotKey=nextSlot(role,roster),neededAt=Game.time)=>{
        if(!parts)return;requests.push({id:owner+':'+slotKey,owner,slotKey,home:room.name,role,body:parts,memory,priority,neededAt,essential,reason});
    };
    const immediate=room.energyAvailable,capacity=room.energyCapacityAvailable;
    const currentWorkerWork=workerWork(all),workerTarget=demand.workerWorkTarget||workerWorkTarget(room,control);
    if((!count('bootstrap')||count('bootstrap')+workerCount<2)&&!miners)
        add('bootstrap',body('bootstrap',Math.min(immediate,400)),1100,true,'restore-harvest-and-spawn');
    if(!haulers&&miners){
        const standard=standardHaulerBody(room),rescue=emergencyHaulerBody(room);
        add('hauler',standard&&price(standard)<=immediate?standard:rescue,1050,true,'restore-energy-transport');
    }
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
    // Development has one birth role. Construction is a temporary runtime
    // role assigned by development.workerAssignment(), never a second spawn
    // obligation that can inflate total WORK after a site completes.
    const affordableWorkerBody=demand.workerWork?body('worker',immediate,{workLimit:demand.workerWork}):null;
    // A partial pool is still operational; only a completely empty pool is a
    // lifeline. The remaining WORK deficit is discretionary so it does not
    // starve miner or hauler recovery.
    const workerEssential=currentWorkerWork===0;
    // A live worker already provides some controller/build capacity. Let
    // source and transport recovery take precedence over topping up the
    // remaining WORK deficit; the worker request remains queued for the next
    // available spawn slot.
    const workerPriority=currentWorkerWork===0?925:600;
    if(currentWorkerWork<workerTarget&&(affordableWorkerBody||demand.workerBody))
        add('worker',affordableWorkerBody||demand.workerBody,workerPriority,workerEssential,'worker-work-capacity-gap',
            {unitType:'worker',workRole:'upgrader',workerState:'refuel'});
    if(!requests.some(r=>r.role==='miner')){
        const replacement=minerReplacement(room,all,spawnList[0]);
        if(replacement){const old=roster.find(c=>c.name===replacement.replaces),operation=operations.find(o=>o.sourceId===replacement.source);
            const slotKey=old&&old.memory.spawnSlot||'source:'+replacement.source+':seat:0';
            requests.push({id:operation.id+':'+slotKey,owner:operation.owner,slotKey,home:room.name,role:'miner',body:nextMiner,
                memory:{...replacement,operationId:operation.id},priority:700,neededAt:Game.time,essential:false,reason:'profitable-miner-upgrade'});
        }
    }
    if(haulers&&carry<control.carry)add('hauler',standardHaulerBody(room),500,false,'transport-capacity-gap');
    return requests;
}
function workerRenewals(room,roster,control) {
    const requests=[],owner='colony:'+room.name,sp=spawns(room)[0];
    const timeline=spawns(room).map(s=>s.spawning&&s.spawning.remainingTime||0);if(!timeline.length)return requests;
    const current=roster.filter(c=>c.spawning||(c.ticksToLive||0)>0),replaced=new Set(current.map(c=>c.memory.replaces).filter(Boolean));
    const job=constructionJobs(room)[0],workerTarget=workerWorkTarget(room,control),full=body('worker',room.energyCapacityAvailable),fullWork=full?full.filter(p=>p===WORK).length:0;
    const haulers=current.filter(c=>c.memory.role==='hauler'&&!c.spawning&&!replaced.has(c.name)).sort((a,b)=>a.ticksToLive-b.ticksToLive||a.name.localeCompare(b.name));
    const sourceTrips=control.routes||[],haulTravel=sourceTrips.length?Math.max(...sourceTrips.map(r=>r.roundTrip/2)):sp&&sp.pos?Math.max(1,range(sp,room.controller)):1;
    const standard=standardHaulerBody(room),haulPlans=[],standardCarry=standard?standard.filter(p=>p===CARRY).length:0;
    let futureCarry=0;
    const peers=current.filter(c=>c.memory.role==='hauler').sort((a,b)=>a.name.localeCompare(b.name));
    for(const old of haulers){
        if(!standard)break;
        // Count transport at this death, not the temporary overlap of today's
        // fleet. Equal-deadline predecessors all disappear together; accepted
        // or observed successors and planned standard births cover later gaps.
        const carry=current.filter(c=>c.memory.role==='hauler'&&(c.spawning||c.ticksToLive>old.ticksToLive))
            .reduce((n,c)=>n+c.getActiveBodyparts(CARRY),0)+futureCarry;
        if(carry>=control.carry)continue;
        const travel=haulTravel,birth=standard.length*CREEP_SPAWN_TIME;
        const slotKey=old.memory.spawnSlot||'hauler:'+peers.indexOf(old);
        haulPlans.push({id:owner+':'+slotKey,owner,slotKey,home:room.name,role:'hauler',body:standard,memory:{replaces:old.name},priority:1000,
            neededAt:Game.time+old.ticksToLive,latestStart:Game.time+old.ticksToLive-birth-travel,travelTicks:travel,essential:true,
            emergencyAtDeadline:true,reason:'hauler-renewal-deadline'});
        futureCarry+=standardCarry;
    }
    // Work backwards from arrival deadlines to reserve serial spawn time for
    // peers. Prefer a spawn released later when both can meet the deadline,
    // leaving the earlier/free spawn available to the older predecessor.
    const ends=timeline.map(()=>Infinity);
    for(let i=haulPlans.length-1;i>=0;i--){
        const request=haulPlans[i],birth=request.body.length*CREEP_SPAWN_TIME;
        const starts=ends.map(end=>Math.min(request.latestStart,end-birth));
        const feasible=starts.map((start,index)=>({start,index})).filter(s=>s.start>=Game.time+timeline[s.index]);
        const choices=feasible.length?feasible:starts.map((start,index)=>({start,index}));
        choices.sort((a,b)=>b.start-a.start||timeline[b.index]-timeline[a.index]||a.index-b.index);
        const choice=choices[0];request.latestStart=choice.start;ends[choice.index]=choice.start;
    }
    for(const request of haulPlans){
        const first=timeline.indexOf(Math.min(...timeline));
        if(request.latestStart>Game.time+timeline[first])continue;
        requests.push(request);timeline[first]+=request.body.length*CREEP_SPAWN_TIME;
    }
    if(!fullWork)return requests;
    const projected=current.slice();
    const candidates=current.filter(c=>!c.spawning&&isWorker(c)&&!replaced.has(c.name))
        .sort((a,b)=>a.ticksToLive-b.ticksToLive||a.name.localeCompare(b.name));
    for(const old of candidates){
        const moving=Math.max(1,full.filter(p=>p===MOVE).length),loaded=full.length-moving;
        const task=job||room.controller,travel=sp&&sp.pos?Math.max(0,range(sp,task)-3)*Math.max(1,Math.ceil(loaded/moving)):haulTravel;
        const first=timeline.indexOf(Math.min(...timeline)),birth=full.length*CREEP_SPAWN_TIME,lead=timeline[first]+birth+travel;
        if(old.ticksToLive>lead)continue;
        const without=projected.filter(c=>c!==old),deficit=Math.max(0,workerTarget-workerWork(without));
        if(!deficit)continue;
        const work=Math.min(fullWork,deficit),parts=body('worker',room.energyCapacityAvailable,{workLimit:work});
        if(!parts)continue;
        const actualMoving=Math.max(1,parts.filter(p=>p===MOVE).length),actualLoaded=parts.length-actualMoving;
        const actualTravel=sp&&sp.pos?Math.max(0,range(sp,task)-3)*Math.max(1,Math.ceil(actualLoaded/actualMoving)):haulTravel;
        const actualBirth=parts.length*CREEP_SPAWN_TIME,actualLead=timeline[first]+actualBirth+actualTravel;
        if(old.ticksToLive>actualLead)continue;
        const peers=current.filter(isWorker).sort((a,b)=>a.name.localeCompare(b.name));
        const slotKey=old.memory.spawnSlot||'worker:'+peers.indexOf(old);
        requests.push({id:owner+':'+slotKey,owner,slotKey,home:room.name,role:'worker',body:parts,
            memory:{unitType:'worker',workRole:'upgrader',replaces:old.name,workerState:'refuel'},priority:workerWork(without)===0?1000:700,
            neededAt:Game.time+old.ticksToLive,latestStart:Game.time+old.ticksToLive-actualBirth-actualTravel,travelTicks:actualTravel,
            essential:workerWork(without)===0,reason:'worker-renewal-deadline'});
        timeline[first]+=actualBirth;
        projected.splice(projected.indexOf(old),1,{name:'requested:'+old.name,memory:{role:'worker',unitType:'worker',workRole:'upgrader'},body:parts,spawning:true,ticksToLive:1500,
            getActiveBodyparts:type=>parts.filter(p=>p===type).length});
    }
    return requests;
}
let busyPlans={};
function busyPlanKey(room,control,roster,active,recovering) {
    // Absolute death and spawn-completion ticks stay constant during ordinary
    // progress. Unexpected lifespan changes, body damage and role transfers
    // invalidate the plan just like policy or infrastructure changes.
    return [control.at,control.eventSignature,control.target,control.plannedHarvest,control.carry,control.buildEnergyTarget,control.usefulTarget,control.developmentBudget,
        room.energyCapacityAvailable,Number(recovering),Number(room.controller.ticksToDowngrade<4000),
        criticalRepairs(room).map(r=>r.node.id).join(','),
        active.map(s=>(s.id||s.name)+':'+(s.spawning?s.spawning.name+':'+(Game.time+s.spawning.remainingTime):'free')).join(','),
        roster.map(c=>[c.name,c.memory.role,c.memory.workRole||'',c.memory.source||'',c.memory.replaces||'',c.getActiveBodyparts(WORK),c.getActiveBodyparts(CARRY),
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
        const workerRenewalPending=renewals.some(n=>isWorkerRole(n.role));
        const ordinary=roomRequests(room,roster,control,demand).filter(r=>
            !(workerRenewalPending&&isWorkerRole(r.role))&&
            !(r.reason==='transport-capacity-gap'&&renewals.some(n=>n.role==='hauler'))&&
            !renewals.some(n=>n.role===r.role&&n.memory&&n.memory.replaces===r.memory?.replaces)&&
            !roster.some(c=>c.spawning&&c.memory.role===r.role&&c.memory.replaces&&r.reason.endsWith('gap')));
        internal=ordinary.concat(renewals);state.planningTick=Game.time;state.planReused=false;
        if(busy)busyPlans[room.name]={at:Game.time,key,demand,internal};else delete busyPlans[room.name];
    }
    const capacity=role=>all.filter(c=>c.memory.role===role).reduce((n,c)=>n+c.getActiveBodyparts(role==='hauler'?CARRY:WORK),0);
    const workerCapacity=role=>all.filter(c=>workerRole(c)===role).reduce((n,c)=>n+c.getActiveBodyparts(WORK),0);
    const totalWorkerWork=workerWork(all),workerTarget=demand.workerWorkTarget||workerWorkTarget(room,control);
    m.economy={workerWorkTarget:workerTarget,workerWork:totalWorkerWork,workerCount:demand.workerCount,
        upgradeWorkTarget:demand.upgradeWork,upgradeWork:workerCapacity('upgrader'),mode:policy.mode,reason:control.reason,carryTarget:control.carry,
        carry:capacity('hauler'),builderWork:workerCapacity('builder')+capacity('bootstrap'),repairmanWork:workerCapacity('repairman'),builderWorkTarget:demand.builderWorkTarget,workerEnergyDemand:demand.workerEnergyDemand,upgradeEffectiveRate:demand.effectiveUp,
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
        const occupied=roster.some(c=>
            (request.role==='worker'?isWorker(c):c.memory.role===request.role)&&
            c.name!==request.memory?.replaces&&(c.spawning||(c.ticksToLive||0)>0)&&
            c.memory.spawnOwner===request.owner&&c.memory.spawnSlot===request.slotKey);
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
            // Plans always retain the standard body and its queue deadline.
            // Decide rescue only at a real free spawn, using shared unspent
            // energy, so financing changes cannot shrink the planning window.
            const parts=request.role==='hauler'&&request.emergencyAtDeadline&&request.latestStart<=Game.time&&price(request.body)>budget?
                body('hauler',budget):request.body;
            const cost=parts?price(parts):Infinity,wait=state.waiting[request.key];
            if(cost>budget){wait.reason='insufficient-energy';continue;}
            // A lower job must leave funds and spawn time for an unaffordable
            // critical request whose latest start is already due.
            const blocked=requests.find((r,i)=>i<requestIndex&&!r.done&&r.essential&&price(r.body)>budget&&r.latestStart<=Game.time+parts.length*CREEP_SPAWN_TIME);
            if(blocked){wait.reason='critical-deadline-reservation';continue;}
            const name=request.role+'-'+Game.time+'-'+room.name+'-'+index;
            const memory={...request.memory,role:request.role,...(request.role==='worker'?{unitType:'worker',workRole:request.memory&&request.memory.workRole||'upgrader'}:{}),home:room.name,owner:request.owner,spawnOwner:request.owner,spawnSlot:request.slotKey,
                birthRoom:room.name,bornAt:Game.time};
            const code=spawn.spawnCreep(parts,name,{memory});
            state.lastAttempt={tick:Game.time,id:request.id,owner:request.owner,slotKey:request.slotKey,spawn:spawnKey,code,reason:request.reason};
            if(code!==OK){wait.reason='spawn-error:'+code;continue;}
            request.done=true;reserved.used.add(spawnKey);reserved.spent+=cost;
            state.pending[request.key]={name,spawn:spawn.id||spawn.name,at:Game.time,owner:request.owner,slotKey:request.slotKey,body:parts,memory,status:'accepted-intent'};
            delete state.waiting[request.key];accepted.push({name,role:request.role,slotKey:request.slotKey,cost});break;
        }
    }
    state.tick=Game.time;state.queued=requests.filter(r=>!r.done).map(r=>({id:r.id,owner:r.owner,slotKey:r.slotKey,role:r.role,priority:r.priority,neededAt:r.neededAt,
        latestStart:r.latestStart,waitingSince:r.waitingSince,reason:state.waiting[r.key]&&state.waiting[r.key].reason,essential:!!r.essential}));
    return accepted;
}
module.exports={workerDuty,workerWorkTarget,workerWork,workforceDemand,body,standardHaulerBudget,standardHaulerBody,emergencyHaulerBody,minerReplacement,minerRenewal,roomRequests,workerRenewals,reconcileBirths,spawnRoom};
