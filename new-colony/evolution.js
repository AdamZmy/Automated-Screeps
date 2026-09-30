'use strict';
// A single bounded experiment record. Events at begin describe the intents
// captured by finish on the previous tick; accepted intents are not throughput.
const runtime=require('runtime'),policy=require('hauler-policy');
const VERSION=1,MAX_HAULERS=64;
const TOTALS=['ticks','haulerTicks','carryTicks','workerWorkTicks','minerWorkTicks','delivered','deliveryEvents','travelTicks','payloadSum','idle','waitingPickup','blocked','spawnDemandTicks','spawnStarvedTicks','roomCpu','cpuTicks','errors'];
const finite=n=>typeof n==='number'&&Number.isFinite(n);
let initialized=false,frame=null;
function addReason(record,reason){if(!record.invalidReasons.includes(reason))record.invalidReasons.push(reason);}
function active(c,type){return (c.body||[]).filter(p=>p.type===type&&p.hits>0).length;}
function capacity(c){return c.store&&typeof c.store.getCapacity==='function'?c.store.getCapacity(RESOURCE_ENERGY):active(c,CARRY)*CARRY_CAPACITY;}
function roomMemory(name){return Memory.frontier.rooms&&Memory.frontier.rooms[name]||{};}
function health(){
    const out={};
    for(const [key,v] of Object.entries(Memory.frontier.modules||{}))if(v&&v.status==='error')out[key]={tick:v.tick,count:v.count||1};
    return out;
}
function errorsSince(before,after,tick){
    let n=0;
    for(const [key,v] of Object.entries(after))if(v.tick===tick){
        const old=before[key];n+=old&&v.count>old.count?v.count-old.count:old&&old.tick===tick?0:v.count===1?1:old?1:v.count;
    }
    return n;
}
function scope(room){
    const context=runtime.roomContext(room),present=context.creepsByPosition.filter(c=>c.id&&c.my!==false&&!c.spawning);
    const haulers=present.filter(c=>c.memory.role==='hauler');let workerWork=0,minerWork=0;
    for(const c of present){
        const m=c.memory||{},work=active(c,WORK);
        if(m.role==='miner'&&!m.retiredMiner)minerWork+=work;
        else if(m.role==='worker'||['upgrader','builder','repairman','bootstrap'].includes(m.role))workerWork+=work;
    }
    // Normal replacements overlap or briefly leave a slot vacant. Stable
    // configured demand enters the signature; actual capacity is integrated
    // separately so the evaluator can reject a material window-mean change.
    const memory=roomMemory(room.name),economy=memory.economy||{},control=memory.economyControl||{};
    const signature={rcl:room.controller.level,energyCapacity:room.energyCapacityAvailable||null,
        carryTarget:economy.carryTarget??control.carry??null,workerWorkTarget:economy.workerWorkTarget??null,
        builderWorkTarget:economy.builderWorkTarget??control.builderWork??null,phase:control.baseMode||control.mode||null,
        links:(context.structuresByType[STRUCTURE_LINK]||[]).length,
        linkLayout:(context.structuresByType[STRUCTURE_LINK]||[]).map(s=>s.pos?s.pos.x+','+s.pos.y:s.id||'?').sort().join(';'),
        roads:(context.structuresByType[STRUCTURE_ROAD]||[]).map(s=>s.pos?s.pos.x+','+s.pos.y:s.id||'?').sort().join(';'),
        sources:context.sources.length,sites:context.sites.length};
    return {context,haulers,signature,workerWork,minerWork,carry:haulers.reduce((n,c)=>n+active(c,CARRY),0),
        remote:context.creepsByHome.some(c=>c.memory.role==='hauler'&&!c.spawning&&c.pos&&c.pos.roomName!==room.name)};
}
function fresh(config){
    const warmup=config.stage==='trial'?config.warmup:0,record={version:VERSION,id:config.id,room:config.room,stage:config.stage,variant:config.variant,
        revision:config.revision,window:config.window,warmup,startedTick:Game.time,fromTick:Game.time+warmup,endTick:Game.time+warmup+config.window,
        tick:Game.time,signature:null,complete:false,frozen:false,invalidReasons:[],observedTicks:0,coverage:0,
        bucketStart:null,bucketEnd:null,bucketMin:null,haulerCountMin:null,haulerCountMax:null,metrics:null,_previous:null};
    for(const k of TOTALS)record[k]=0;
    return record;
}
function matches(record,c){return record&&record.version===VERSION&&record.id===c.id&&record.room===c.room&&record.stage===c.stage&&record.revision===c.revision;}
function collecting(c){return c.stage==='baseline'||c.stage==='trial';}
function publicRecord(record){
    const result={};for(const key of Object.keys(record))if(key[0]!=='_')result[key]=record[key];return result;
}
function finalize(record){
    record.coverage=record.observedTicks/record.window;
    record.complete=record.observedTicks===record.window&&record.ticks===record.window&&record.cpuTicks===record.window&&!record.invalidReasons.length;
    record.metrics=record.complete?{deliveredPerHaulerTick:record.haulerTicks?record.delivered/record.haulerTicks:null,
        averageTravelPayload:record.travelTicks?record.payloadSum/record.travelTicks:null,
        blockedFraction:record.haulerTicks?record.blocked/record.haulerTicks:null,
        roomCpuPerTick:record.roomCpu/record.ticks}:null;
    record.frozen=true;delete record._previous;
}
function begin(owned){
    frame=null;Memory.frontier=Memory.frontier||{};
    const config=policy.config;
    if(!config||!config.id||!config.room)return null;
    let record=Memory.frontier.evolution;
    const old=matches(record,config);
    if(!old)record=Memory.frontier.evolution=fresh(config);
    else if(!initialized&&!record.frozen&&record._previous)addReason(record,'global-reset');
    initialized=true;
    if(record.frozen||!collecting(config)){record.tick=Game.time;return publicRecord(record);}
    if(record.tick===Game.time&&record._previous&&record._previous.tick===Game.time)return publicRecord(record);
    const room=owned.find(r=>r.name===config.room&&r.controller&&r.controller.my);
    if(!room){addReason(record,'room-unavailable');record.tick=Game.time;if(Game.time>=record.endTick)finalize(record);return publicRecord(record);}
    const current=scope(room),previous=record._previous;
    if(Game.time>=record.fromTick){
        if(record.signature===null)record.signature=current.signature;
        if(JSON.stringify(current.signature)!==JSON.stringify(record.signature))addReason(record,'context-changed');
    }
    if(current.remote)addReason(record,'remote-hauler-scope');
    if(current.haulers.length>MAX_HAULERS)addReason(record,'hauler-observation-limit');
    if(current.context.threats.length)addReason(record,'hostile-threat');
    if(roomMemory(room.name).economyControl?.cpuMode==='recovery')addReason(record,'cpu-recovery');
    if(old&&previous&&previous.tick!==Game.time-1)addReason(record,'observation-gap');
    if(old&&!previous&&Game.time>record.startedTick)addReason(record,'previous-observation-missing');
    if(previous&&previous.tick===Game.time-1&&previous.tick>=record.fromTick&&previous.tick<record.endTick){
        let events=null;
        try{events=room.getEventLog();}catch(e){}
        const reasons=[];
        if(!Array.isArray(events))reasons.push('event-log-unavailable');
        if(!finite(previous.cpu))reasons.push('room-cpu-unavailable');
        if(!finite(previous.bucket))reasons.push('cpu-bucket-unavailable');
        if(!previous.demand)reasons.push('spawn-demand-unavailable');
        if(previous.truncated)reasons.push('hauler-observation-limit');
        let delivered=0,deliveryEvents=0;
        if(Array.isArray(events))for(const event of events){
            if(event.event!==EVENT_TRANSFER||!previous.haulers[event.objectId])continue;
            const data=event.data||{};if(data.resourceType!==RESOURCE_ENERGY)continue;
            if(!finite(data.amount)||data.amount<0){reasons.push('transfer-amount-unavailable');continue;}
            delivered+=data.amount;if(data.amount>0)deliveryEvents++;
        }
        for(const reason of reasons)addReason(record,reason);
        // Missing intervals never contribute isolated throughput, CPU or state
        // totals. Full joint coverage is required before deriving any rate.
        if(!reasons.length){
            record.ticks++;record.observedTicks++;record.delivered+=delivered;record.deliveryEvents+=deliveryEvents;
            record.roomCpu+=previous.cpu;record.cpuTicks++;
            record.carryTicks+=previous.carry;record.workerWorkTicks+=previous.workerWork;record.minerWorkTicks+=previous.minerWork;
            const count=Object.keys(previous.haulers).length;
            record.haulerCountMin=record.haulerCountMin===null?count:Math.min(record.haulerCountMin,count);
            record.haulerCountMax=record.haulerCountMax===null?count:Math.max(record.haulerCountMax,count);
            if(previous.errors)addReason(record,'runtime-error');
            record.spawnDemandTicks+=Number(previous.demand.queued);record.spawnStarvedTicks+=Number(previous.demand.starved);
            const live=new Map(current.haulers.map(c=>[c.id,c]));
            for(const [id,c] of Object.entries(previous.haulers)){
                record.haulerTicks++;record.idle+=Number(c.state==='idle');
                record.waitingPickup+=Number(c.state==='pickup'&&!c.moveAttempt&&!c.fatigue);
                if(c.moveAttempt&&!c.fatigue&&c.state==='deliver'&&c.cargo>0){record.travelTicks++;record.payloadSum+=c.cargo/Math.max(1,c.capacity);}
                const now=live.get(id);
                if(c.moveAttempt&&!c.fatigue&&now&&now.pos.x===c.x&&now.pos.y===c.y&&now.pos.roomName===c.room)record.blocked++;
            }
            if(record.bucketStart===null)record.bucketStart=previous.bucket;
            record.bucketEnd=previous.bucket;
            record.bucketMin=record.bucketMin===null?previous.bucket:Math.min(record.bucketMin,previous.bucket);
        }
    }
    record.tick=Game.time;record.coverage=record.observedTicks/record.window;
    if(Game.time>=record.endTick){if(record.observedTicks!==record.window)addReason(record,'incomplete-coverage');finalize(record);return publicRecord(record);}
    frame={record,room,current,healthBefore:previous&&previous.health||{},tick:Game.time};
    return publicRecord(record);
}
function finish(roomCpu){
    if(!frame||frame.tick!==Game.time)return Memory.frontier&&Memory.frontier.evolution?publicRecord(Memory.frontier.evolution):null;
    const {record,room,current,healthBefore}=frame;frame=null;
    const haulers={};
    for(const c of current.haulers.slice(0,MAX_HAULERS)){
        const move=c.memory.movement,h=c.memory.haul;
        haulers[c.id]={role:'hauler',cargo:runtime.energy(c),capacity:capacity(c),state:h&&h.state||'idle',x:c.pos.x,y:c.pos.y,room:c.pos.roomName,
            moveAttempt:c.memory.moveAttempt===Game.time&&(!move||move.at!==Game.time||move.state==='submitted'),fatigue:c.fatigue||0};
    }
    const workforce=roomMemory(room.name).workforce,after=health(),errors=errorsSince(healthBefore,after,Game.time);
    record.errors+=errors;
    if(errors)addReason(record,'runtime-error');
    if(current.context.threats.length)addReason(record,'hostile-threat');
    if(roomMemory(room.name).economyControl?.cpuMode==='recovery')addReason(record,'cpu-recovery');
    record._previous={tick:Game.time,haulers,carry:current.carry,workerWork:current.workerWork,minerWork:current.minerWork,
        cpu:finite(roomCpu)&&roomCpu>=0?roomCpu:null,errors,health:after,
        bucket:Game.cpu&&finite(Game.cpu.bucket)?Game.cpu.bucket:null,truncated:current.haulers.length>MAX_HAULERS,
        demand:workforce&&workforce.tick===Game.time&&Array.isArray(workforce.queued)?{
            queued:workforce.queued.length>0,starved:workforce.queued.some(r=>r.reason==='insufficient-energy')}:null};
    if(record._previous.bucket===null)addReason(record,'cpu-bucket-unavailable');
    return publicRecord(record);
}
module.exports={begin,finish,snapshot:()=>Memory.frontier&&Memory.frontier.evolution?publicRecord(Memory.frontier.evolution):null};
