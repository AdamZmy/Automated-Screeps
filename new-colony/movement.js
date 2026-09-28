'use strict';
// One immediate movement decision per creep/tick. Safety owners run before
// ordinary roles; no late queue can erase a necessary move or lose it to CPU.
const movementCount=name=>require('metrics').movementCount(name);
let decisionTick=-1,decisions=new Map();
const LOCAL_PATH_REUSE=50;
function tickDecisions(){if(decisionTick!==Game.time){decisionTick=Game.time;decisions=new Map();}return decisions;}
function remember(c,owner,target,result,state){
    const decision={at:Game.time,owner,target,result,state};
    if(state==='submitted'&&result===OK)tickDecisions().set(c.name||c.id||c,decision);
    c.memory.movement=decision;
    return result;
}
function go(c,t,r=1,options={}){
    if(!t)return;
    const decisions=tickDecisions(),prior=decisions.get(c.name||c.id||c);
    if(prior){movementCount('duplicateMoves');return ERR_BUSY;}
    const p=t.pos||t,roomName=p.roomName||c.room.name;
    const owner=options.owner||c.memory.role||'runtime',target=roomName+':'+p.x+','+p.y+':'+r;
    // Legal station work is a completed movement goal, not a blocked step.
    if(roomName===c.pos.roomName&&Math.max(Math.abs(c.pos.x-p.x),Math.abs(c.pos.y-p.y))<=r){
        c.memory.stuck=0;delete c.memory.moveAttempt;
        movementCount('rangeRests');return remember(c,owner,target,OK,'in-range');
    }
    if(c.fatigue){
        c.memory.stuck=0;delete c.memory.moveAttempt;
        movementCount('fatigueWaits');return remember(c,owner,target,ERR_TIRED,'fatigue');
    }
    const key=c.pos.roomName+':'+c.pos.x+','+c.pos.y;
    const sameGoal=c.memory.moveTarget===target;
    c.memory.stuck=c.memory.moveAttempt===Game.time-1&&sameGoal&&c.memory.last===key?(c.memory.stuck||0)+1:0;
    // Targets and explicit route revisions invalidate only their own cache.
    if(c.memory.moveTarget!==undefined&&!sameGoal||options.routeVersion!==undefined&&c.memory.moveRouteVersion!==options.routeVersion){
        delete c.memory._move;c.memory.moveRouteVersion=options.routeVersion;
    }
    c.memory.last=key;c.memory.moveTarget=target;c.memory.moveAttempt=Game.time;
    movementCount('moveCalls');if(c.memory.stuck)movementCount('blockedSteps');
    if(c.memory.stuck>=2&&c.memory.stuck%3===2){delete c.memory._move;movementCount('pathResets');}
    const {owner:ignoredOwner,routeVersion:ignoredVersion,...moveOptions}=options;
    // The command still needs to be submitted on each tick so the creep can
    // take its next step, but the engine can reuse the cached path for a much
    // longer stable haul leg.  Explicit target/route changes and stuck
    // recovery above still invalidate the engine cache.
    const result=c.moveTo(p,{range:r,reusePath:LOCAL_PATH_REUSE,maxRooms:roomName===c.room.name?1:16,ignoreCreeps:c.memory.stuck<2,...moveOptions});
    return remember(c,owner,target,result,result===OK?'submitted':result===ERR_NO_PATH?'no-path':'rejected');
}
function keeper(name){const n=name.match(/\d+/g).map(Number);return n.every(x=>x%10>=4&&x%10<=6);}
function allowed(name){const status=Game.map.getRoomStatus(name);return status&&status.status!=='closed'&&!keeper(name);}
// Heap-only, bounded and disposable after a global reset. Routes are safe to
// reuse, but fresh hostile/ownership intel must invalidate them immediately.
const routeCache=new Map(),ROUTE_TTL=100,ROUTE_LIMIT=128;
function safeRoom(name){
    if(!allowed(name))return false;
    const i=Memory.frontier.intel&&Memory.frontier.intel[name];
    return !(i&&(i.owner&&!i.mine||i.hostiles>0&&Game.time-i.seen<1500));
}
function route(from,to){
    const key=from+'>'+to,old=routeCache.get(key);
    if(old&&Game.time>=old.at&&Game.time-old.at<(Array.isArray(old.path)?ROUTE_TTL:10)&&
        (!Array.isArray(old.path)||old.path.every(step=>safeRoom(step.room))))return old.path;
    const path=Game.map.findRoute(from,to,{routeCallback:name=>safeRoom(name)?1:Infinity});
    routeCache.delete(key);
    if(routeCache.size>=ROUTE_LIMIT)routeCache.delete(routeCache.keys().next().value);
    routeCache.set(key,{at:Game.time,path});return path;
}
function rejectExit(c,waypoint){
    const prior=(c.memory.travelExitAvoid||[]).filter(p=>p.room===c.room.name&&p.until>Game.time&&!(p.x===waypoint.x&&p.y===waypoint.y));
    c.memory.travelExitAvoid=prior.slice(-7).concat({room:c.room.name,x:waypoint.x,y:waypoint.y,until:Game.time+50});
    delete c.memory.travelExit;delete c.memory._move;
}
function travel(c,target,options={}){
    if(!target)return false;
    if(tickDecisions().has(c.name||c.id||c))return false;
    if(c.room.name===target){delete c.memory.travelExit;delete c.memory.travelExitAvoid;delete c.memory.travelExitRetry;return true;}
    const r=route(c.room.name,target);if(!Array.isArray(r)||!r.length){c.memory.unreachable=Game.time;return false;}
    const key=c.room.name+'>'+target+':'+r[0].exit;
    let waypoint=c.memory.travelExit;
    // moveTo may return OK while its appended final step hits a blocked exit.
    // Only consecutive real attempts at this endpoint qualify as being stuck.
    if(waypoint&&waypoint.key===key&&!c.fatigue&&c.memory.stuck>=4&&
        c.memory.moveAttempt===Game.time-1&&c.memory.last===c.room.name+':'+c.pos.x+','+c.pos.y&&
        c.memory.moveTarget===c.room.name+':'+waypoint.x+','+waypoint.y+':0'){
        rejectExit(c,waypoint);waypoint=null;
    }
    if(!waypoint||waypoint.key!==key||Game.time-waypoint.at>=ROUTE_TTL){
        const retry=c.memory.travelExitRetry;
        if(retry&&retry.room===c.room.name&&retry.direction===r[0].exit&&retry.until>Game.time)return false;
        // findClosestByPath only reaches range 1. Explicitly filter endpoint
        // obstacles once per selection; normal cached travel does no scans.
        const blocked=new Set(),tile=p=>p.x+50*p.y;
        for(const s of c.room.find(FIND_STRUCTURES))if(OBSTACLE_OBJECT_TYPES.includes(s.structureType)||
            s.structureType===STRUCTURE_RAMPART&&!s.my&&!s.isPublic)blocked.add(tile(s.pos));
        for(const u of c.room.find(FIND_CREEPS).concat(c.room.find(FIND_POWER_CREEPS)))if(u.id!==c.id)blocked.add(tile(u.pos));
        c.memory.travelExitAvoid=(c.memory.travelExitAvoid||[]).filter(p=>p.room===c.room.name&&p.until>Game.time);
        for(const p of c.memory.travelExitAvoid)blocked.add(tile(p));
        const exits=c.room.find(r[0].exit).filter(p=>!blocked.has(tile(p)));
        const exit=exits.length&&c.pos.findClosestByPath(exits,{ignoreCreeps:true,maxRooms:1,maxOps:3000});
        if(!exit){
            c.memory.unreachable=Game.time;delete c.memory.travelExit;delete c.memory._move;
            c.memory.travelExitRetry={room:c.room.name,direction:r[0].exit,until:Game.time+10};return false;
        }
        delete c.memory.travelExitRetry;
        waypoint=c.memory.travelExit={key,x:exit.x,y:exit.y,at:Game.time};
    }
    const result=go(c,new RoomPosition(waypoint.x,waypoint.y,c.room.name),0,{...options,owner:options.owner||'expansion'});
    if(result===ERR_NO_PATH){rejectExit(c,waypoint);c.memory.unreachable=Game.time;routeCache.delete(c.room.name+'>'+target);}
    return false;
}

function evacuate(c,home){return travel(c,home,{owner:'defense'});}
module.exports={go,travel,route,safeRoom,allowed,evacuate};
