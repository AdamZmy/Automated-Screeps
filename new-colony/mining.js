'use strict';
const {E,range,energy,availableCapacity,go,give,allCreeps,roomCreeps,structures,myStructures,sources,spawns,miningSpots}=require('runtime');
const {economyMemory,routeTravel}=require('colony');
function mine(c) {
    const s=Game.getObjectById(c.memory.source);if(!s)return;
    if(c.memory.replaces){
        const previous=Game.creeps[c.memory.replaces];
        if(previous&&previous.memory.role==='miner'&&previous.memory.source===s.id){
            // The old miner keeps producing throughout spawn and travel. Retire it
            // only when the replacement can step directly into the mining tile.
            if(range(c,previous)>1){go(c,previous);return;}
            if(c.fatigue||previous.fatigue)return;
            previous.memory.role='worker';previous.memory.unitType='worker';previous.memory.workRole='repairman';previous.memory.owner='development:'+previous.memory.home;previous.memory.loaded=energy(previous)>0;previous.memory.yieldSource=s.id;
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
            const blocker=roomCreeps(c.room).find(o=>o.room.name===c.room.name&&!o.spawning&&o.pos.x===spot.x&&o.pos.y===spot.y&&
                (o.memory.role==='worker'||['bootstrap','builder','upgrader','repairman'].includes(o.memory.role)));
            if(blocker){blocker.memory.yieldSource=s.id;delete blocker.memory.refuelTarget;}
        }
        go(c,new RoomPosition(spot.x,spot.y,c.room.name),0);return;
    }
    const link=myStructures(c.room).find(t=>t.structureType===STRUCTURE_LINK&&availableCapacity(t)>0&&range(c,t)<=1);
    const box=containers.find(t=>range(c,t)<=1);
    if(energy(c)){
        if(box&&box.hits<box.hitsMax*.7){c.repair(box);return;}
        else if(link)give(c,link);
        else if(box&&availableCapacity(box)>0)give(c,box);
        else c.drop(E);
    }
    c.harvest(s);
}
// Operations have stable semantic identities. Capacity while travelling or
// spawning is exposed separately and never labelled current harvesting.
function operations(room,roster=allCreeps().filter(c=>c.memory.home===room.name)) {
    return sources(room).map(source=>{
        const assigned=roster.filter(c=>c.memory.role==='miner'&&c.memory.source===source.id)
            .sort((a,b)=>Number(!!a.memory.replaces)-Number(!!b.memory.replaces)||a.name.localeCompare(b.name));
        const seats=miningSpots(room,source),rate=(source.energyCapacity||SOURCE_ENERGY_CAPACITY)/ENERGY_REGEN_TIME;
        const present=assigned.filter(c=>!c.spawning&&c.room&&c.room.name===room.name&&range(c,source)<=1);
        const containers=structures(room).filter(s=>s.structureType===STRUCTURE_CONTAINER&&range(s,source)<=1);
        return {id:'mining:'+room.name+':'+source.id,owner:'mining:'+room.name,sourceId:source.id,home:room.name,source,seats,assigned,
            theoreticalRate:rate,requiredWork:Math.ceil(rate/HARVEST_POWER),activeWork:present.reduce((n,c)=>n+c.getActiveBodyparts(WORK),0),
            futureWork:assigned.filter(c=>c.spawning||!present.includes(c)).reduce((n,c)=>n+c.getActiveBodyparts(WORK),0),
            containers:containers.map(c=>c.id),containerMissing:containers.length===0};
    });
}
function replacementNeeds(room,roster,next,queueTicks=0,sharedOperations=null) {
    if(!next)return [];
    const requests=[],birth=next.length*CREEP_SPAWN_TIME;
    for(const operation of sharedOperations||operations(room,roster)){
        const assigned=operation.assigned;
        const pending=new Set(assigned.filter(c=>c.memory.replaces).map(c=>c.memory.replaces));
        // Retained independent miners can continue after an individual expires.
        for(const old of assigned){
            if(old.spawning||old.memory.replaces||pending.has(old.name))continue;
            const travel=routeTravel(room,operation.source)*2;
            const lead=birth+travel+queueTicks+20;
            const otherWork=assigned.filter(c=>c!==old&&(c.spawning||(c.ticksToLive||0)>lead)).reduce((n,c)=>n+c.getActiveBodyparts(WORK),0);
            if(otherWork>=operation.requiredWork)continue;
            const slack=(old.ticksToLive||0)-lead;
            if(slack<=0)requests.push({source:operation.sourceId,replaces:old.name,slack,travel,
                neededAt:Game.time+(old.ticksToLive||0),latestStart:Game.time+(old.ticksToLive||0)-birth-travel-20,
                owner:operation.owner,slotKey:old.memory.spawnSlot||'source:'+operation.sourceId+':seat:'+assigned.indexOf(old)});
        }
    }
    return requests.sort((a,b)=>a.slack-b.slack||a.source.localeCompare(b.source));
}
function constructionRequests(room) {
    const plan=economyMemory(room).plan,requests=[];
    for(const operation of operations(room)){
        if(!operation.containerMissing)continue;
        const item=(plan&&plan.structures||[]).find(s=>s.type===STRUCTURE_CONTAINER&&range(s,operation.source)<=1);
        if(item)requests.push({id:operation.id+':container',owner:operation.id,x:item.x,y:item.y,structureType:STRUCTURE_CONTAINER,
            minRCL:item.rcl||1,priority:120,reason:'restore-source-buffer'});
    }
    return requests;
}
module.exports={mine,operations,replacementNeeds,constructionRequests};
