'use strict';
const {E,range,energy,myStructures,sources,availableEnergy,availableCapacity,commitEnergy}=require('runtime');
const {economyMemory}=require('colony');
let linkCacheTick=-1,linkCache={};
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
    const {hub,controller,inputs}=linkNetwork(room),intents=[];
    const send=(from,to)=>{
        if(!from||!to||from.cooldown)return false;
        // The API validates the sent amount against the recipient's initial
        // space. Reserve that full amount conservatively across all senders.
        const amount=Math.min(availableEnergy(from),availableCapacity(to));
        if(amount<=Math.ceil(amount*LINK_LOSS_RATIO))return false;
        const code=from.transferEnergy(to,amount);if(code!==OK)return false;
        commitEnergy(from,to,amount,amount);
        intents.push({from:from.id,to:to.id,amount,expectedLoss:Math.ceil(amount*LINK_LOSS_RATIO)});
        return true;
    };
    for(const source of inputs)if(!send(source,controller))send(source,hub);
    send(hub,controller);
    const memory=economyMemory(room);memory.links={tick:Game.time,intents,
        roles:{hub:hub&&hub.id||null,controller:controller&&controller.id||null,inputs:inputs.map(l=>l.id)}};
    return intents;
}
module.exports={linkNetwork,links};
