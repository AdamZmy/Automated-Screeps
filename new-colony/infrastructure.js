'use strict';
const {E,range,energy,roomCreeps,hostiles,myStructures,structures,spawns,sources}=require('runtime');
const {economyMemory}=require('development');
let linkCacheTick=-1,linkCache={};
function defend(room){
    const hostile=hostiles(room);
    for(const t of myStructures(room).filter(s=>s.structureType===STRUCTURE_TOWER)){
        const enemy=t.pos.findClosestByRange(hostile);if(enemy){t.attack(enemy);continue;}
        const hurt=t.pos.findClosestByRange(roomCreeps(room).filter(c=>c.hits<c.hitsMax));if(hurt)t.heal(hurt);
        else if(energy(t)>650){const weak=t.pos.findClosestByRange(structures(room).filter(s=>s.structureType===STRUCTURE_RAMPART&&s.my&&s.hits<20000));if(weak)t.repair(weak);}
    }
    if(hostile.some(c=>c.getActiveBodyparts(ATTACK)||c.getActiveBodyparts(RANGED_ATTACK)||c.getActiveBodyparts(WORK))&&room.controller.safeModeAvailable&&!room.controller.safeMode){
        if(spawns(room).some(s=>hostile.some(c=>range(c,s)<6)))room.controller.activateSafeMode();
    }
}
function linkNetwork(room) {
    if(linkCacheTick!==Game.time){linkCacheTick=Game.time;linkCache={};}
    const ls=myStructures(room).filter(s=>s.structureType===STRUCTURE_LINK),cached=linkCache[room.name];
    if(cached&&cached.room===room){const known=[cached.value.hub,cached.value.controller,...cached.value.inputs].filter(Boolean);if(known.length===ls.length&&known.every(link=>ls.includes(link)))return cached.value;}
    const plan=economyMemory(room).plan;
    const tags=new Map((plan&&plan.structures||[]).filter(s=>s.type===STRUCTURE_LINK).map(s=>[s.x+50*s.y,s.tag||'']));
    const tag=l=>tags.get(l.pos.x+50*l.pos.y)||'';
    const hub=ls.find(l=>tag(l)==='hub-link');
    const controller=ls.find(l=>tag(l)==='controller-link')||ls.find(l=>l!==hub&&room.controller&&range(l,room.controller)<=3);
    const ss=sources(room),inputs=ls.filter(l=>l!==hub&&l!==controller&&(tag(l).startsWith('source-link-')||ss.some(s=>range(s,l)<=2)));
    const value={hub,controller,inputs};linkCache[room.name]={room,value};return value;
}
function links(room){
    const {hub,controller,inputs}=linkNetwork(room),free=new Map([hub,controller].filter(Boolean).map(l=>[l.id,l.store.getFreeCapacity(E)]));
    const send=(from,to)=>{
        if(!from||!to||from.cooldown||energy(from)<=0||(free.get(to.id)||0)<=0)return false;
        const amount=Math.min(energy(from),free.get(to.id));
        if(amount<=Math.ceil(amount*LINK_LOSS_RATIO))return false;
        if(from.transferEnergy(to,amount)!==OK)return false;
        free.set(to.id,free.get(to.id)-amount);return true;
    };
    for(const source of inputs)if(!send(source,controller))send(source,hub);
    send(hub,controller);
}
// Rebuildable, bounded heap counters; no prototype hooks or per-creep histories.

module.exports={defend,linkNetwork,links};
