'use strict';
const movement=require('movement');
const values=o=>Object.keys(o||{}).map(k=>o[k]);
const E=RESOURCE_ENERGY;
// These are the existing support authorization and economic gates, now named
// in one place. Configuration may lower the room ceiling, never expand it.
const POLICY=Object.freeze({maxRooms:3,maxConcurrent:1,candidateEvery:50,candidateLimit:6,scoutDepth:3,
    candidateAge:3000,threatAge:1500,routeRooms:3,minHomeRCL:4,minScoutRCL:2,minStorage:12000,
    minBucket:7000,maxCpuEMA:12,historySamples:6,minHomeSourceWork:4,minHomeCarry:8,
    minActiveTTL:100,pioneers:2,bootstrapTimeout:6000,stabilizationTimeout:6000,
    colonySourceWork:2,colonyRCL:2,colonyUpgradeEMA:.2,telemetryAge:100,stableTicks:100,cooldown:1000});
const terminal=e=>!e||['complete','blocked','aborting','cancelled'].includes(e.state);
function identity(e){if(!e.id)e.id='expansion:'+e.home+':'+e.target+':'+(e.started??Game.time);return e.id;}
function transition(e,state,reason){
    if(e.state!==state){e.previousState=e.state;e.state=state;e.stateSince=Game.time;e.lastProgress=Game.time;}
    if(reason)e.reason=reason;else delete e.reason;
}
function activeUnits(home){return values(Game.creeps).filter(c=>c.memory.home===home&&(c.spawning||c.ticksToLive>POLICY.minActiveTTL));}
function sourceCoverage(room,units,work,atSource=false){return room.find(FIND_SOURCES).every(s=>units.filter(c=>c.memory.role==='miner'&&c.memory.source===s.id&&(!atSource||!c.spawning&&c.room&&c.room.name===room.name&&c.pos&&Math.max(Math.abs(c.pos.x-s.pos.x),Math.abs(c.pos.y-s.pos.y))<=1)).reduce((n,c)=>n+c.getActiveBodyparts(WORK),0)>=work);}
function homeCovered(room){const units=activeUnits(room.name);return sourceCoverage(room,units,POLICY.minHomeSourceWork)&&units.filter(c=>c.memory.role==='hauler').reduce((n,c)=>n+c.getActiveBodyparts(CARRY),0)>=POLICY.minHomeCarry;}
function record(room){
    const c=room.controller,sources=room.find(FIND_SOURCES),enemies=room.find(FIND_HOSTILE_CREEPS);
    const previous=Memory.frontier.intel[room.name]||{};
    Memory.frontier.intel[room.name]={seen:Game.time,lastSeen:Game.time,source:'vision',owner:c&&c.owner&&c.owner.username,mine:!!(c&&c.my),reservation:c&&c.reservation&&c.reservation.username,controller:c?{x:c.pos.x,y:c.pos.y}:null,sources:sources.map(s=>({id:s.id,x:s.pos.x,y:s.pos.y})),exits:Game.map.describeExits(room.name)||{},hostiles:enemies.filter(e=>e.getActiveBodyparts(ATTACK)||e.getActiveBodyparts(RANGED_ATTACK)).length,terrain:previous.terrain};
    if(!previous.terrain){const terrain=room.getTerrain();let plain=0,swamp=0;for(let y=1;y<49;y++)for(let x=1;x<49;x++){const t=terrain.get(x,y);if(t===0)plain++;else if(t===TERRAIN_MASK_SWAMP)swamp++;}Memory.frontier.intel[room.name].terrain={plain,swamp};}
    // A scout records observations only. Full layouts are reviewed/archived
    // separately and active-room recovery runs in the optional planning stage.
}
function neighborhood(home,maxDepth=POLICY.scoutDepth){
    const rooms=[{name:home,depth:0}],seen=new Set([home]);
    for(let i=0;i<rooms.length;i++){const cur=rooms[i];if(cur.depth>=maxDepth)continue;
        for(const next of values(Game.map.describeExits(cur.name)))if(!seen.has(next)&&movement.allowed(next)){seen.add(next);rooms.push({name:next,depth:cur.depth+1});}
    }return rooms;
}
function scout(c){
    record(c.room);
    if(c.room.find(FIND_HOSTILE_CREEPS).some(e=>c.pos.getRangeTo(e)<=5)){delete c.memory.target;movement.travel(c,c.memory.home);return;}
    if(!c.memory.target||c.room.name===c.memory.target||c.memory.unreachable&&Game.time-c.memory.unreachable<10){
        const choices=neighborhood(c.memory.home).filter(r=>r.name!==c.room.name),intel=Memory.frontier.intel;
        choices.sort((a,b)=>((intel[a.name]?intel[a.name].seen:0)+a.depth*100)-((intel[b.name]?intel[b.name].seen:0)+b.depth*100));
        const next=choices.find(r=>Array.isArray(movement.route(c.room.name,r.name)));
        c.memory.target=next&&next.name;delete c.memory.unreachable;
    }
    if(c.memory.target)movement.travel(c,c.memory.target);
}
function candidates(home){
    const result=[];
    for(const name in Memory.frontier.intel){
        const i=Memory.frontier.intel[name],m=Memory.frontier.rooms[name];
        if(!i.controller||i.sources.length!==2||i.owner||i.reservation||i.hostiles||Game.time-i.seen>POLICY.candidateAge||!m||!m.plan||!m.plan.complete)continue;
        const r=movement.route(home,name);if(!Array.isArray(r)||r.length<1||r.length>POLICY.routeRooms)continue;
        const nearby=values(i.exits).filter(n=>Memory.frontier.intel[n]&&Memory.frontier.intel[n].sources.length===2&&!Memory.frontier.intel[n].owner).length;
        const threat=values(i.exits).filter(n=>Memory.frontier.intel[n]&&Memory.frontier.intel[n].owner&&!Memory.frontier.intel[n].mine).length;
        const paths=m.plan.sourcePlans||[];if(paths.length!==2)continue;
        const terrain=i.terrain||{},score=200+values(i.exits).length*12+nearby*20-r.length*30-threat*60-paths.reduce((s,p)=>s+(p.pathLength||0),0)+(terrain.plain||0)/100-(terrain.swamp||0)/100;
        result.push({room:name,score:Math.round(score),distance:r.length,seen:i.seen,
            assessment:{resources:2,route:r.length,risk:threat,layout:true}});
    }return result.sort((a,b)=>b.score-a.score);
}
function handover(e,room,spawn){
    if(!e.firstSpawn)e.firstSpawn={id:spawn.id||spawn.name,seen:Game.time};
    if(!e.handoverAt)e.handoverAt=Game.time;
    // Late arrivals are also handed over exactly once, without asking the
    // mother colony to replace their old mission slots.
    for(const c of values(Game.creeps))if(c.memory.role==='pioneer'&&c.memory.target===e.target&&c.room&&c.room.name===e.target){
        c.memory.home=e.target;c.memory.role='bootstrap';c.memory.handoverMission=identity(e);
        delete c.memory.target;delete c.memory.operationId;delete c.memory.slotKey;
    }
    transition(e,'stabilizing');e.deadline=e.firstSpawn.seen+POLICY.stabilizationTimeout;
}
function releaseUnit(c,h){
    delete c.memory.operationId;delete c.memory.slotKey;delete c.memory.travelExit;delete c.memory.travelExitAvoid;delete c.memory.travelExitRetry;delete c.memory._move;
    if(c.room.controller&&c.room.controller.my&&c.memory.role==='pioneer'){
        c.memory.home=c.room.name;c.memory.role='bootstrap';delete c.memory.target;h.work(c);return;
    }
    const home=c.memory.home;
    if(home&&c.room.name!==home){movement.travel(c,home,{owner:'expansion-abort'});return;}
    c.memory.role=c.getActiveBodyparts(WORK)?'bootstrap':'scout';delete c.memory.target;
    if(c.memory.role==='bootstrap')h.work(c);
}
function cancel(reason='cancelled'){
    const e=Memory.frontier.expansion;if(!e||e.state==='complete')return false;
    transition(e,'aborting',reason);e.cancelledAt=Game.time;e.releasedAt=Game.time;
    for(const c of values(Game.creeps))if(c.memory.operationId===identity(e)||['claimer','pioneer'].includes(c.memory.role)&&c.memory.target===e.target){
        delete c.memory.operationId;delete c.memory.slotKey;delete c.memory.travelExit;delete c.memory.travelExitAvoid;delete c.memory.travelExitRetry;delete c.memory._move;
    }
    return true;
}
function updateMission(e){
    if(!e||e.state==='complete')return;identity(e);
    if(e.cancelled||e.cancelRequested){cancel(e.reason||'cancelled');delete e.cancelRequested;return;}
    if(e.state==='aborting'){
        if(!values(Game.creeps).some(c=>['claimer','pioneer'].includes(c.memory.role)&&c.memory.target===e.target))transition(e,'cancelled',e.reason);
        return;
    }
    if(e.state==='cancelled')return;
    const target=Game.rooms[e.target],ctrl=target&&target.controller;
    if(ctrl&&ctrl.owner&&!ctrl.my){transition(e,'blocked','target claimed by another player');return;}
    const home=Game.rooms[e.home],username=home&&home.controller&&home.controller.owner&&home.controller.owner.username;
    if(ctrl&&ctrl.reservation&&username&&ctrl.reservation.username!==username){transition(e,'blocked','target reserved by another player');return;}
    const spawn=ctrl&&ctrl.my&&target.find(FIND_MY_SPAWNS)[0];
    if(e.state==='blocked'){
        if(e.reason==='bootstrap timeout; review required'&&spawn)handover(e,target,spawn);
        else return;
    }
    if(spawn)handover(e,target,spawn);
    if(e.firstSpawn){
        if(!spawn)return; // Lost visibility never resurrects support requests.
        const units=activeUnits(e.target),telemetry=Memory.frontier.telemetry&&Memory.frontier.telemetry.rooms[e.target];
        const born=units.find(c=>!c.spawning&&c.memory.birthRoom===e.target&&Number.isFinite(c.memory.bornAt)&&c.memory.bornAt>=(e.started||0));
        if(born&&!e.localBirth)e.localBirth={name:born.name||born.id,bornAt:born.memory.bornAt,observedAt:Game.time};
        const fresh=telemetry&&Number.isFinite(telemetry.tick)&&Game.time-telemetry.tick<=POLICY.telemetryAge;
        const stable=sourceCoverage(target,units,POLICY.colonySourceWork,true)&&units.some(c=>c.memory.role==='hauler'&&!c.spawning&&c.room&&c.room.name===e.target)&&target.controller.level>=POLICY.colonyRCL&&fresh&&telemetry.upgradeEMA>POLICY.colonyUpgradeEMA&&!!e.localBirth;
        if(stable){
            if(!Number.isFinite(e.stableSince))e.stableSince=Game.time;
            if(Game.time-e.stableSince>=POLICY.stableTicks){transition(e,'complete');e.completed=Game.time;console.log('[Frontier] Self-sustaining colony '+e.target);}
        }else delete e.stableSince;
        if(e.state!=='complete'&&Game.time>e.deadline)transition(e,'blocked','stabilization timeout; review required');
        return;
    }
    e.deadline=(e.started??Game.time)+POLICY.bootstrapTimeout;
    if(Game.time>e.deadline){transition(e,'blocked','bootstrap timeout; review required');return;}
    if(home&&!homeCovered(home)){
        if(e.state!=='paused')e.resumeState=e.state==='launching'?'claiming':e.state;
        transition(e,'paused','mother economy needs recovery');return;
    }
    if(e.state==='paused'){
        if(e.reason!=='mother economy needs recovery')return;
        transition(e,e.resumeState||'claiming');delete e.resumeState;
    }
    if(ctrl&&ctrl.my)transition(e,'bootstrapping');
    else if(['ready','launching'].includes(e.state))transition(e,'claiming');
}
function spawnRequests(room){
    const requests=[],active=activeUnits(room.name),e=Memory.frontier.expansion;
    if(e)updateMission(e);
    function request(role,body,target,slot,priority,reason){
        const operationId=target&&e?identity(e):undefined,slotKey=operationId?operationId+':'+slot:room.name+':'+slot;
        requests.push({id:slotKey,owner:'expansion',slotKey,home:room.name,role,body,
            memory:{role,home:room.name,...(target?{target,operationId}:{}),slotKey},priority,
            neededAt:Game.time,expiresAt:Game.time+POLICY.candidateEvery,reason,essential:false});
    }
    if(room.controller.level>=POLICY.minScoutRCL&&!active.some(c=>c.memory.role==='scout'))request('scout',[MOVE],null,'scout',30,'refresh-neighbor-intel');
    if(terminal(e)||e.home!==room.name||!['ready','claiming','bootstrapping'].includes(e.state)||e.firstSpawn)return requests;
    const targetRoom=Game.rooms[e.target];
    if(!targetRoom||!targetRoom.controller||!targetRoom.controller.my){
        if(!active.some(c=>c.memory.role==='claimer'&&c.memory.target===e.target))request('claimer',[CLAIM,MOVE],e.target,'claimer',40,'claim-ready-colony');
    }
    const pioneers=active.filter(c=>c.memory.role==='pioneer'&&c.memory.target===e.target);
    const occupied=new Set();
    for(const pioneer of pioneers){
        const slot=pioneer.memory.slotKey,match=slot&&slot.match(/:pioneer:(\d+)$/);
        if(match)occupied.add(Number(match[1]));
    }
    // Legacy pioneers have no slot receipt; reserve one slot per survivor.
    for(let i=0;occupied.size<pioneers.length&&i<POLICY.pioneers;i++)occupied.add(i);
    for(let i=0;i<POLICY.pioneers;i++)if(!occupied.has(i))request('pioneer',[WORK,WORK,CARRY,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE],e.target,'pioneer:'+i,35,'bootstrap-first-spawn');
    return requests;
}
function constructionRequests(room){
    const e=Memory.frontier.expansion,m=Memory.frontier.rooms[room.name],plan=m&&m.plan;
    if(terminal(e)||e.target!==room.name||!room.controller||!room.controller.my||e.firstSpawn||room.find(FIND_MY_SPAWNS).length)return [];
    if(!plan||!plan.anchor||!Array.isArray(plan.structures)||(plan.sourcePlans||[]).length!==room.find(FIND_SOURCES).length)return [];
    if(m.planRecovery&&m.planRecovery.status==='blocked'||m.planMigration&&m.planMigration.status==='blocked')return [];
    return [{id:identity(e)+':firstSpawn',x:plan.anchor.x,y:plan.anchor.y,structureType:STRUCTURE_SPAWN,minRCL:1,
        priority:1000,owner:'expansion',name:'Outpost-'+room.name,reason:'mission-first-spawn',operationId:e.id}];
}
function run(c,h){
    if(c.memory.role==='scout'){scout(c);return;}
    const e=Memory.frontier.expansion;
    if(!e||e.target!==c.memory.target||['aborting','cancelled'].includes(e.state)){releaseUnit(c,h);return;}
    if(e.state==='blocked'){releaseUnit(c,h);return;}
    if(c.memory.role==='claimer'){
        if(!movement.travel(c,c.memory.target))return;record(c.room);
        const ctrl=c.room.controller;if(!ctrl)return;
        if(ctrl.my){c.memory.role='scout';delete c.memory.target;delete c.memory.operationId;delete c.memory.slotKey;return;}
        const home=Game.rooms[e.home],username=home&&home.controller&&home.controller.owner&&home.controller.owner.username;
        if(ctrl.owner||ctrl.reservation&&ctrl.reservation.username!==username){transition(e,'blocked','target claimed or reserved by another player');return;}
        if(c.claimController(ctrl)===ERR_NOT_IN_RANGE)movement.go(c,ctrl,1,{owner:'expansion'});return;
    }
    if(c.memory.role==='pioneer'){
        if(c.room.name===c.memory.home&&!c.memory.departed&&c.store.getFreeCapacity(E)>0){h.refuel(c);return;}
        c.memory.departed=true;if(!movement.travel(c,c.memory.target))return;
        if(!c.room.controller||!c.room.controller.my){h.refuel(c);return;}
        const spawn=c.room.find(FIND_MY_SPAWNS)[0];if(spawn)handover(e,c.room,spawn);
        h.work(c);
    }
}
function tick(owned,options={}){
    for(const room of owned)record(room);
    const current=Memory.frontier.expansion;if(current)updateMission(current);
    if(options.optional!==false)plan(owned);
}
function plan(owned){
    if(Game.time%POLICY.candidateEvery!==0)return;
    const current=Memory.frontier.expansion;
    Memory.frontier.candidates={};for(const room of owned)Memory.frontier.candidates[room.name]=candidates(room.name).slice(0,POLICY.candidateLimit);
    if(current&&current.state!=='complete')return;
    if(current&&current.completed&&Game.time-current.completed<POLICY.cooldown)return;
    if(owned.length>=Math.min(Game.gcl.level,Memory.frontier.maxRooms||POLICY.maxRooms,POLICY.maxRooms))return;
    if(Memory.frontier.pauseExpansion||Game.cpu.bucket<POLICY.minBucket||Memory.frontier.status&&Memory.frontier.status.cpu>POLICY.maxCpuEMA)return;
    const telemetry=Memory.frontier.telemetry;
    if(!telemetry||telemetry.cpuEMA>POLICY.maxCpuEMA||values(telemetry.alerts).some(a=>['cpu-headroom','haul-backlog','downgrade-risk'].includes(a.code)))return;
    for(const home of owned){
        if(home.controller.level<POLICY.minHomeRCL||!home.storage||home.storage.store[E]<POLICY.minStorage||home.find(FIND_HOSTILE_CREEPS).length)continue;
        const metrics=telemetry.rooms[home.name],history=metrics&&metrics.history;
        if(!history||history.length<POLICY.historySamples||history[history.length-1].bank<history[history.length-POLICY.historySamples].bank||!homeCovered(home))continue;
        const list=Memory.frontier.candidates[home.name];if(!list||!list.length)continue;
        const best=list[0],e=Memory.frontier.expansion={home:home.name,target:best.room,state:'ready',stateSince:Game.time,started:Game.time,lastProgress:Game.time,deadline:Game.time+POLICY.bootstrapTimeout,score:best.score};identity(e);
        console.log('[Frontier] Expansion '+home.name+' -> '+best.room+' score '+best.score);break;
    }
}
module.exports={POLICY,spawnRequests,constructionRequests,run,tick,plan,record,candidates,cancel};
