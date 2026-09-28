'use strict';
const E = RESOURCE_ENERGY;
const movementCount=name=>require('metrics').movementCount(name);
const vals = o => Object.keys(o).map(k => o[k]);
// Plans and station seats are plain local coordinates, which the engine's
// RoomPosition.getRangeTo(object) overload does not accept. Normalize both ends
// directly while preserving its known-different-room Infinity behavior.
const range = (a,b) => {
    const p=a.pos||a,q=b.pos||b;
    return p.roomName&&q.roomName&&p.roomName!==q.roomName?Infinity:Math.max(Math.abs(p.x-q.x),Math.abs(p.y-q.y));
};
const energy = o => o.store ? o.store[E] || 0 : o.amount || 0;
let objectCacheTick=-1,objectCache=null;
function tickCache(){
    if(objectCacheTick!==Game.time){objectCacheTick=Game.time;objectCache={creeps:null,creepRoot:null,rooms:{}};}
    return objectCache;
}
function allCreeps(refresh=false){const cache=tickCache();if(refresh||cache.creepRoot!==Game.creeps){cache.creepRoot=Game.creeps;cache.creeps=vals(Game.creeps);}return cache.creeps;}
function roomObjects(room){
    const cache=tickCache(),old=cache.rooms[room.name];
    // `objects`/`sites` exist only in the deterministic fixtures; the live
    // engine rebuilds room collections once per tick and needs no mutation check.
    const fixtureMarker=room.objects?room.objects.length+':'+(room.sites?room.sites.length:0)+':'+Object.keys(Game.creeps).length:null;
    if(old&&old.room===room&&old.fixtureMarker===fixtureMarker&&old.fixtureRoot===room.objects)return old;
    return cache.rooms[room.name]={room,fixtureMarker,fixtureRoot:room.objects};
}
function cachedFind(room,key,type){const cache=roomObjects(room);return cache[key]||(cache[key]=room.find(type));}
function roomCreeps(room){return cachedFind(room,'creeps',FIND_MY_CREEPS);}
function hostiles(room){return cachedFind(room,'hostiles',FIND_HOSTILE_CREEPS);}
function structures(room){return cachedFind(room,'structures',FIND_STRUCTURES);}
function myStructures(room){return cachedFind(room,'myStructures',FIND_MY_STRUCTURES);}
function spawns(room){return cachedFind(room,'spawns',FIND_MY_SPAWNS);}
function constructionSites(room){return cachedFind(room,'sites',FIND_MY_CONSTRUCTION_SITES);}
function drops(room){return cachedFind(room,'drops',FIND_DROPPED_RESOURCES);}
function tombstones(room){return cachedFind(room,'tombstones',FIND_TOMBSTONES);}
function ruins(room){return cachedFind(room,'ruins',FIND_RUINS);}
function near(c,arr) {
    if(!arr.length){movementCount('emptyChoices');return null;}
    // An adjacent target already satisfies the action range. All other new
    // choices still use real pathfinding rather than assuming range is a route.
    const adjacent=arr.find(t=>range(c,t)<=1);
    if(adjacent){movementCount('adjacentChoices');return adjacent;}
    movementCount('targetSearches');return c.pos.findClosestByPath(arr);
}
// All movement policy and final move ownership belong to movement.js.
function go(c,t,r=1,options={}) {return require('movement').go(c,t,r,options);}
// Accepted intents reserve initial energy/capacity only. Incoming cargo never
// becomes spendable this tick; outgoing energy never creates immediate space.
function intentBook(){const cache=tickCache();return cache.energyIntents||(cache.energyIntents={out:{},in:{}});}
function resourceKey(o){return o&&(o.id||o.name);}
function availableEnergy(o){if(!o)return 0;return Math.max(0,energy(o)-(intentBook().out[resourceKey(o)]||0));}
function availableCapacity(o){if(!o||!o.store)return 0;return Math.max(0,(o.store.getFreeCapacity(E)||0)-(intentBook().in[resourceKey(o)]||0));}
function commitEnergy(from,to,amount,received=amount){
    const book=intentBook(),a=resourceKey(from),b=resourceKey(to);
    if(a)book.out[a]=(book.out[a]||0)+Math.max(0,amount);
    if(b)book.in[b]=(book.in[b]||0)+Math.max(0,received);
}
function take(c,t,limit=Infinity) {
    if(!t)return ERR_INVALID_TARGET;
    const amount=Math.min(availableEnergy(t),availableCapacity(c),limit);
    if(amount<=0)return availableCapacity(c)>0?ERR_NOT_ENOUGH_RESOURCES:ERR_FULL;
    const actual=t.resourceType?Math.min(availableEnergy(t),availableCapacity(c)):amount;
    const r=t.resourceType?c.pickup(t):c.withdraw(t,E,actual);
    if(r===ERR_NOT_IN_RANGE)go(c,t);else if(r===OK)commitEnergy(t,c,actual);
    return r;
}
function give(c,t,limit=Infinity) {
    if(!t)return ERR_INVALID_TARGET;
    const amount=Math.min(availableEnergy(c),availableCapacity(t),limit);
    if(amount<=0)return availableEnergy(c)>0?ERR_FULL:ERR_NOT_ENOUGH_RESOURCES;
    const r=c.transfer(t,E,amount);
    if(r===ERR_NOT_IN_RANGE)go(c,t);else if(r===OK)commitEnergy(c,t,amount);
    return r;
}
function alive(c) {return c.spawning || (c.ticksToLive||0)>c.body.length*3+35;}
function sources(room) { return cachedFind(room,'sources',FIND_SOURCES); }
function stores(room) { return structures(room).filter(s=>s.store); }
let miningCacheTick=-1,miningCache={};
function miningSpots(room,source) {
    if(miningCacheTick!==Game.time){miningCacheTick=Game.time;miningCache={};}
    const key=room.name+':'+source.id;if(miningCache[key])return miningCache[key];
    const terrain=room.getTerrain(),spots=[];
    for(let y=source.pos.y-1;y<=source.pos.y+1;y++)for(let x=source.pos.x-1;x<=source.pos.x+1;x++){
        if(x<1||y<1||x>48||y>48||(x===source.pos.x&&y===source.pos.y)||(terrain.get(x,y)&TERRAIN_MASK_WALL))continue;
        if(room.lookForAt(LOOK_STRUCTURES,x,y).some(s=>OBSTACLE_OBJECT_TYPES.includes(s.structureType)||(s.structureType===STRUCTURE_RAMPART&&!s.my&&!s.isPublic)))continue;
        spots.push({x,y,roomName:room.name});
    }
    return miningCache[key]=spots;
}

// Contexts are disposable indexes for the current tick. Home ownership and
// physical presence are intentionally separate, including spawn/travel status.
function roomContext(roomOrName){
    const name=typeof roomOrName==='string'?roomOrName:roomOrName.name;
    const room=typeof roomOrName==='string'?(Game.rooms||{})[name]:roomOrName;
    const cache=tickCache(),contexts=cache.contexts||(cache.contexts={});
    if(contexts[name]&&contexts[name].room===room)return contexts[name];
    const creeps=allCreeps(),home=creeps.filter(c=>c.memory.home===name),present=creeps.filter(c=>c.pos&&c.pos.roomName===name);
    const context={tick:Game.time,roomName:name,colonyId:name,visible:!!room,room,
        creepsByHome:home,creepsByPosition:present,spawning:home.filter(c=>c.spawning),
        inTransit:home.filter(c=>!c.spawning&&c.pos&&c.pos.roomName!==name),
        structuresByType:{},sources:[],sites:[],threats:[]};
    if(room){for(const s of structures(room))(context.structuresByType[s.structureType]||(context.structuresByType[s.structureType]=[])).push(s);
        context.sources=sources(room);context.sites=constructionSites(room);context.threats=hostiles(room);}
    contexts[name]=context;return context;
}
function contexts(owned){return owned.map(roomContext);}

module.exports={availableEnergy,availableCapacity,commitEnergy,intentBook,roomContext,contexts,E,vals,range,energy,near,go,take,give,alive,allCreeps,roomCreeps,hostiles,structures,myStructures,spawns,constructionSites,drops,tombstones,ruins,sources,stores,miningSpots};
