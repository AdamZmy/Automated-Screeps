'use strict';
// Observes and reports. Economy and expansion modules remain the only decision owners.
const E=RESOURCE_ENERGY;
const ledger=require('ledger');
const value=o=>o.store?o.store[E]||0:0;
const range=(a,b)=>Math.max(Math.abs(a.pos.x-b.pos.x),Math.abs(a.pos.y-b.pos.y));
const tile=o=>o.pos.x+50*o.pos.y;
function roadTelemetry(plan,structures,sites){
    const built=new Set(structures.filter(s=>s.structureType===STRUCTURE_ROAD).map(tile));
    const building=new Set(sites.filter(s=>s.structureType===STRUCTURE_ROAD).map(tile));
    const roads=(plan&&plan.structures||[]).filter(s=>s.type===STRUCTURE_ROAD&&s.roadClass==='economy');
    const keys=roads.map(s=>s.x+50*s.y);
    return {version:plan&&plan.roadVersion||0,planned:keys.length,built:keys.filter(k=>built.has(k)).length,sites:keys.filter(k=>building.has(k)).length,
        swampRemaining:roads.filter(s=>s.roadSwamp&&!built.has(s.x+50*s.y)).length,missing:plan&&plan.roadMissing||[],
        routes:(plan&&plan.roadRoutes||[]).map(r=>({id:r.id,planned:r.tiles.length,built:r.tiles.filter(k=>built.has(k)).length,sites:r.tiles.filter(k=>building.has(k)).length,complete:r.complete}))};
}
function tick(owned){
    ledger.observe(owned);
    if(Game.time%20!==0)return;
    const root=Memory.frontier;
    const telemetry=root.telemetry=root.telemetry||{rooms:{},alerts:{},started:Game.time};
    const creeps=Object.values(Game.creeps);
    const cpu=Game.cpu.getUsed();telemetry.cpuEMA=telemetry.cpuEMA===undefined?cpu:telemetry.cpuEMA*.9+cpu*.1;
    telemetry.bucket=Game.cpu.bucket;telemetry.tick=Game.time;telemetry.capturedAt=Date.now();telemetry.version=4;
    const activeKeys=new Set();
    function alert(room,code,message,condition,delay=100){
        const k=room+':'+code;
        if(!condition)return;
        activeKeys.add(k);let a=telemetry.alerts[k];
        if(!a)a=telemetry.alerts[k]={room,code,message,since:Game.time};
        a.message=message;a.lastSeen=Game.time;
        if(Game.time-a.since>=delay&&(!a.lastLogged||Game.time-a.lastLogged>=500)){console.log('[Frontier monitor] '+room+' '+code+': '+message);a.lastLogged=Game.time;}
    }
    for(const room of owned){
        const c=room.controller,all=creeps.filter(c=>c.memory.home===room.name),structures=room.find(FIND_STRUCTURES),sources=room.find(FIND_SOURCES);
        const previous=telemetry.rooms[room.name],elapsed=previous?Game.time-previous.tick:20;
        const drops=room.find(FIND_DROPPED_RESOURCES,{filter:r=>r.resourceType===E}),sites=room.find(FIND_MY_CONSTRUCTION_SITES);
        const containers=structures.filter(s=>s.structureType===STRUCTURE_CONTAINER);
        // Attribute nearby stock once, even if two sources share an approach.
        const owner=o=>sources.filter(s=>range(o,s)<=2).sort((a,b)=>range(o,a)-range(o,b)||a.id.localeCompare(b.id))[0];
        const roleCounts={};for(const unit of all)roleCounts[unit.memory.role]=(roleCounts[unit.memory.role]||0)+1;
        const upkeep=all.reduce((n,unit)=>n+unit.body.reduce((b,p)=>b+BODYPART_COST[p.type],0)/(unit.body.some(p=>p.type===CLAIM)?600:1500),0);
        const mining=sources.map(s=>{
            const assigned=all.filter(c=>c.memory.role==='miner'&&c.memory.source===s.id);
            const assignedWork=assigned.reduce((n,c)=>n+c.getActiveBodyparts(WORK),0);
            const active=assigned.filter(c=>!c.spawning&&c.pos.roomName===room.name&&range(c,s)<=1);
            const work=active.reduce((n,c)=>n+c.getActiveBodyparts(WORK),0);
            const positions=[];for(let y=s.pos.y-1;y<=s.pos.y+1;y++)for(let x=s.pos.x-1;x<=s.pos.x+1;x++)if(x>=1&&x<=48&&y>=1&&y<=48&&(x!==s.pos.x||y!==s.pos.y)&&!(room.getTerrain().get(x,y)&TERRAIN_MASK_WALL))positions.push([x,y]);
            const boxes=containers.filter(b=>range(b,s)<=1&&owner(b)===s),buffer=boxes.reduce((n,b)=>n+value(b),0),bufferCapacity=boxes.reduce((n,b)=>n+b.store.getCapacity(E),0);
            const dropped=drops.filter(d=>owner(d)===s).reduce((n,d)=>n+d.amount,0),stock=buffer+dropped;
            const prev=previous&&(previous.mining||[]).find(p=>p.id===s.id),stockDelta=prev&&prev.stock!==undefined?stock-prev.stock:null;
            const backlog=dropped>=500||dropped>=100&&(bufferCapacity===0||buffer>=bufferCapacity*.9)||stock>=2000&&bufferCapacity>0&&buffer>=bufferCapacity*.95;
            return {id:s.id,x:s.pos.x,y:s.pos.y,energy:s.energy,capacity:s.energyCapacity,regen:s.ticksToRegeneration,work,assignedWork,activeMiners:active.length,slots:positions.length,potential:Math.min(s.energyCapacity/ENERGY_REGEN_TIME,work*HARVEST_POWER),
                buffer,bufferCapacity,dropped,stock,stockDelta,netStockRate:stockDelta===null?null:stockDelta/Math.max(1,elapsed),
                lastStockDecrease:stockDelta!==null&&stockDelta<0?Game.time:prev&&prev.lastStockDecrease||null,
                backlogSince:backlog?(prev&&prev.backlogSince||Game.time):null};
        });
        const dropped=drops.reduce((n,r)=>n+r.amount,0);
        const buffers=containers.reduce((n,s)=>n+value(s),0);
        const storage=room.storage?value(room.storage):0;
        let progressDelta=0;if(previous){progressDelta=c.level===previous.rcl?(c.progress||0)-previous.progress:c.level>previous.rcl?(previous.total-previous.progress)+(c.progress||0):0;}
        const upgradeRate=progressDelta/Math.max(1,elapsed);
        const upgradeEMA=previous?previous.upgradeEMA*.8+upgradeRate*.2:upgradeRate;
        const stagnant=progressDelta>0?0:(previous?previous.stagnant:0)+elapsed;
        const plan=root.rooms[room.name]&&root.rooms[room.name].plan;
        const constructionByType={};
        for(const site of sites){
            const group=constructionByType[site.structureType]||(constructionByType[site.structureType]={sites:0,progress:0,total:0});
            group.sites++;group.progress+=site.progress;group.total+=site.progressTotal;
        }
        const haulers=all.filter(u=>u.memory.role==='hauler'&&!u.spawning&&u.pos.roomName===room.name);
        const hauling={count:haulers.length,energy:haulers.reduce((n,u)=>n+value(u),0),capacity:haulers.reduce((n,u)=>n+u.store.getCapacity(E),0),loaded:0,fatigued:0,stalled:0,units:[]};
        for(const u of haulers){
            const loaded=value(u)>0&&(u.memory.loaded||u.store.getFreeCapacity(E)<=u.store.getCapacity(E)*.1);
            const last=previous&&previous.hauling&&(previous.hauling.units||[]).find(p=>p.name===u.name);
            if(loaded)hauling.loaded++;if(loaded&&u.fatigue>0)hauling.fatigued++;
            if(loaded&&u.fatigue===0&&(u.memory.stuck||0)>=4&&u.memory.moveAttempt>=Game.time-1&&last&&last.x===u.pos.x&&last.y===u.pos.y)hauling.stalled++;
            hauling.units.push({name:u.name,x:u.pos.x,y:u.pos.y,energy:value(u),loaded:!!loaded,fatigue:u.fatigue,stuck:u.memory.stuck||0,pickup:u.memory.haulPickup||null});
        }
        const roads=roadTelemetry(plan,structures,sites);
        const entry={tick:Game.time,capturedAt:telemetry.capturedAt,rcl:c.level,progress:c.progress||0,total:c.progressTotal||0,upgradeRate,upgradeEMA,stagnant,roleCounts,mining,hauling,roads,energy:room.energyAvailable,capacity:room.energyCapacityAvailable,storage,buffers,dropped,upkeep,harvestPotential:mining.reduce((n,s)=>n+s.potential,0),sourceTheoreticalRate:sources.reduce((n,s)=>n+s.energyCapacity/ENERGY_REGEN_TIME,0),constructionSites:sites.length,planComplete:!!(plan&&plan.complete),oldestCreep:Math.min(...all.filter(c=>!c.spawning).map(c=>c.ticksToLive),1500)};
        const measured=root.energy.rooms[room.name];
        entry.energyLedger={tick:measured.tick,inventory:measured.inventory.total,windows:measured.windows,indicator:measured.indicator,utilizationIndicator:measured.utilizationIndicator};
        entry.economy=root.rooms[room.name]&&root.rooms[room.name].economy;
        entry.constructionByType=constructionByType;
        entry.builtExtensions=structures.filter(s=>s.my&&s.structureType===STRUCTURE_EXTENSION).length;
        entry.history=previous?previous.history||[]:[];
        entry.history.push({t:Game.time,rcl:c.level,p:entry.progress,u:+upgradeRate.toFixed(2),bank:storage+buffers,drop:dropped,cpu:+cpu.toFixed(2),n:all.length,sourceStock:mining.map(s=>[s.id,s.stock]),road:roads.built,haulStalled:hauling.stalled});
        if(entry.history.length>60)entry.history.splice(0,entry.history.length-60);
        telemetry.rooms[room.name]=entry;
        alert(room.name,'upgrade-stalled','Controller has made no progress for '+stagnant+' ticks',c.level<8&&stagnant>=200&&all.length>=4);
        alert(room.name,'haul-backlog','Dropped energy '+dropped+'; check carrying capacity and access',dropped>1000);
        alert(room.name,'missing-mining','A source has no miner WORK at harvesting range',c.level>=2&&mining.some(s=>!s.work),300);
        for(const source of mining)alert(room.name,'source-backlog-'+source.id,'Source '+source.x+','+source.y+' stock '+source.stock+' (ground '+source.dropped+', buffer '+source.buffer+'/'+source.bufferCapacity+'); inspect pickup and delivery',source.backlogSince!==null,100);
        alert(room.name,'haul-blocked','Loaded haulers stalled: '+hauling.stalled,hauling.stalled>0,60);
        alert(room.name,'road-disconnected','Economic routes missing: '+roads.missing.join(', '),roads.missing.length>0,100);
        alert(room.name,'spawn-starved','Spawn energy remains below recovery body cost',room.energyAvailable<100&&all.length<2,200);
        alert(room.name,'layout-incomplete',plan&&plan.missing||'Full room layout is not ready',!entry.planComplete,100);
        alert(room.name,'downgrade-risk','Controller downgrade timer '+c.ticksToDowngrade,c.ticksToDowngrade<2500,0);
        alert(room.name,'useful-energy-low','Measured useful-energy efficiency '+Math.round((measured.windows[1500].eta||0)*100)+'% over 1500 observed ticks',measured.indicator.status==='active',0);
        alert(room.name,'energy-utilization-low','Measured total energy utilization '+Math.round((measured.windows[1500].utilization||0)*100)+'% below 90% over 1500 eligible ticks; inspect growth, necessary operations, inventory and losses',!!measured.utilizationIndicator&&measured.utilizationIndicator.status==='active',0);
    }
    alert('empire','cpu-headroom','CPU average '+telemetry.cpuEMA.toFixed(2)+' / '+Game.cpu.limit,telemetry.cpuEMA>Game.cpu.limit*.8||Game.cpu.bucket<500,100);
    const e=root.expansion;alert('empire','expansion-blocked',e&&e.reason||'Expansion requires review',e&&e.state==='blocked',0);
    for(const k of Object.keys(telemetry.alerts))if(!activeKeys.has(k)){
        if(telemetry.alerts[k].lastLogged)console.log('[Frontier monitor] recovered '+k);
        delete telemetry.alerts[k];
    }
}
module.exports={tick};
