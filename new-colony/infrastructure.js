'use strict';
const {E,range,energy,sources}=require('runtime');
const {economyMemory}=require('development');
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
function linkNetwork(room) {
    const ls=room.find(FIND_MY_STRUCTURES,{filter:s=>s.structureType===STRUCTURE_LINK}),plan=economyMemory(room).plan;
    const tags=new Map((plan&&plan.structures||[]).filter(s=>s.type===STRUCTURE_LINK).map(s=>[s.x+50*s.y,s.tag||'']));
    const tag=l=>tags.get(l.pos.x+50*l.pos.y)||'';
    const hub=ls.find(l=>tag(l)==='hub-link');
    const controller=ls.find(l=>tag(l)==='controller-link')||ls.find(l=>l!==hub&&room.controller&&range(l,room.controller)<=3);
    const ss=sources(room),inputs=ls.filter(l=>l!==hub&&l!==controller&&(tag(l).startsWith('source-link-')||ss.some(s=>range(s,l)<=2)));
    return {hub,controller,inputs};
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
