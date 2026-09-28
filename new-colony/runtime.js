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
function near(c,arr) {
    if(!arr.length){movementCount('emptyChoices');return null;}
    // An adjacent target already satisfies the action range. All other new
    // choices still use real pathfinding rather than assuming range is a route.
    const adjacent=arr.find(t=>range(c,t)<=1);
    if(adjacent){movementCount('adjacentChoices');return adjacent;}
    movementCount('targetSearches');return c.pos.findClosestByPath(arr);
}
function go(c,t,r=1,options={}) {
    if (!t) return;
    const p=t.pos || t;
    // Waiting for fatigue or working in place is not failed movement.
    if(c.fatigue){movementCount('fatigueWaits');c.memory.stuck=0;return ERR_TIRED;}
    const key=c.pos.roomName+':'+c.pos.x+','+c.pos.y;
    const target=p.roomName+':'+p.x+','+p.y+':'+r;
    c.memory.stuck=c.memory.moveAttempt===Game.time-1&&c.memory.moveTarget===target&&c.memory.last===key ? (c.memory.stuck||0)+1:0;
    c.memory.last=key;
    c.memory.moveTarget=target;
    c.memory.moveAttempt=Game.time;
    movementCount('moveCalls');if(c.memory.stuck)movementCount('blockedSteps');
    // Changing ignoreCreeps alone does not invalidate moveTo's serialized path.
    // Replan around occupants after two actual failed steps, with a short retry
    // cadence if congestion persists. Keep normal successful routes cached.
    if(c.memory.stuck>=2&&c.memory.stuck%3===2){delete c.memory._move;movementCount('pathResets');}
    return c.moveTo(p,{range:r,reusePath:15,maxRooms:p.roomName===c.room.name?1:16,ignoreCreeps:c.memory.stuck<2,...options});
}
function take(c,t) { const r=t.resourceType?c.pickup(t):c.withdraw(t,E); if(r===ERR_NOT_IN_RANGE)go(c,t); return r; }
function give(c,t) { const r=c.transfer(t,E); if(r===ERR_NOT_IN_RANGE)go(c,t); return r; }
function alive(c) {return c.spawning || (c.ticksToLive||0)>c.body.length*3+35;}
function sources(room) { return room.find(FIND_SOURCES); }
function stores(room) { return room.find(FIND_STRUCTURES,{filter:s=>s.store}); }
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

module.exports={E,vals,range,energy,near,go,take,give,alive,sources,stores,miningSpots};
