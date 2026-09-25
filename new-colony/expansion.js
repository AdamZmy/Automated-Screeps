'use strict';
const planner=require('planner');
const values=o=>Object.keys(o).map(k=>o[k]);
const E=RESOURCE_ENERGY;
function keeper(name){const n=name.match(/\d+/g).map(Number);return n.every(x=>x%10>=4&&x%10<=6);}
function allowed(name){const status=Game.map.getRoomStatus(name);return status&&status.status!=='closed'&&!keeper(name);}
// Heap-only, bounded and disposable after a global reset. Routes are safe to
// reuse, but fresh hostile/ownership intel must invalidate them immediately.
const routeCache=new Map(),ROUTE_TTL=100,ROUTE_LIMIT=128;
function safeRoom(name){
    if(!allowed(name))return false;
    const i=Memory.frontier.intel[name];
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
function travel(c,target,go){
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
    const result=go(c,new RoomPosition(waypoint.x,waypoint.y,c.room.name),0);
    if(result===ERR_NO_PATH){rejectExit(c,waypoint);c.memory.unreachable=Game.time;routeCache.delete(c.room.name+'>'+target);}
    return false;
}
function record(room){
    const c=room.controller,sources=room.find(FIND_SOURCES),enemies=room.find(FIND_HOSTILE_CREEPS);
    const previous=Memory.frontier.intel[room.name]||{};
    Memory.frontier.intel[room.name]={seen:Game.time,owner:c&&c.owner&&c.owner.username,mine:!!(c&&c.my),reservation:c&&c.reservation&&c.reservation.username,controller:c?{x:c.pos.x,y:c.pos.y}:null,sources:sources.map(s=>({id:s.id,x:s.pos.x,y:s.pos.y})),exits:Game.map.describeExits(room.name)||{},hostiles:enemies.filter(e=>e.getActiveBodyparts(ATTACK)||e.getActiveBodyparts(RANGED_ATTACK)).length,terrain:previous.terrain};
    if(!previous.terrain){const terrain=room.getTerrain();let plain=0,swamp=0;for(let y=1;y<49;y++)for(let x=1;x<49;x++){const t=terrain.get(x,y);if(t===0)plain++;else if(t===TERRAIN_MASK_SWAMP)swamp++;}Memory.frontier.intel[room.name].terrain={plain,swamp};}
    if(c&&(!c.owner||c.my)&&!enemies.length&&Game.cpu.bucket>3000)planner.ensure(room);
}
function neighborhood(home,maxDepth=3){
    const rooms=[{name:home,depth:0}],seen=new Set([home]);
    for(let i=0;i<rooms.length;i++){const cur=rooms[i];if(cur.depth>=maxDepth)continue;
        for(const next of values(Game.map.describeExits(cur.name)||{}))if(!seen.has(next)&&allowed(next)){seen.add(next);rooms.push({name:next,depth:cur.depth+1});}
    }return rooms;
}
function scout(c,helpers){
    record(c.room);
    if(c.room.find(FIND_HOSTILE_CREEPS).some(e=>c.pos.getRangeTo(e)<=5)){delete c.memory.target;travel(c,c.memory.home,helpers.go);return;}
    if(!c.memory.target||c.room.name===c.memory.target||c.memory.unreachable&&Game.time-c.memory.unreachable<10){
        const choices=neighborhood(c.memory.home).filter(r=>r.name!==c.room.name);
        const intel=Memory.frontier.intel;
        choices.sort((a,b)=>((intel[a.name]?intel[a.name].seen:0)+a.depth*100)-((intel[b.name]?intel[b.name].seen:0)+b.depth*100));
        const next=choices.find(r=>Array.isArray(route(c.room.name,r.name)));
        c.memory.target=next&&next.name;delete c.memory.unreachable;
    }
    if(c.memory.target)travel(c,c.memory.target,helpers.go);
}
function candidates(home){
    const result=[];
    for(const name in Memory.frontier.intel){
        const i=Memory.frontier.intel[name],m=Memory.frontier.rooms[name];
        if(!i.controller||i.sources.length!==2||i.owner||i.reservation||i.hostiles||Game.time-i.seen>3000||!m||!m.plan||!m.plan.complete)continue;
        const r=route(home,name);if(!Array.isArray(r)||r.length<1||r.length>3)continue;
        const nearby=values(i.exits).filter(n=>Memory.frontier.intel[n]&&Memory.frontier.intel[n].sources.length===2&&!Memory.frontier.intel[n].owner).length;
        const threat=values(i.exits).filter(n=>Memory.frontier.intel[n]&&Memory.frontier.intel[n].owner&&!Memory.frontier.intel[n].mine).length;
        const paths=m.plan.sourcePlans||[];if(paths.length!==2)continue;
        const score=200+values(i.exits).length*12+nearby*20-r.length*30-threat*60-paths.reduce((s,p)=>s+p.pathLength,0)+(i.terrain.plain/100)-i.terrain.swamp/100;
        result.push({room:name,score:Math.round(score),distance:r.length,seen:i.seen});
    }return result.sort((a,b)=>b.score-a.score);
}
function spawn(room,sp,all){
    const active=all.filter(c=>c.spawning||c.ticksToLive>100);
    const energy=room.energyAvailable;
    function make(role,body,target){if(body.reduce((n,p)=>n+BODYPART_COST[p],0)>energy)return;return sp.spawnCreep(body,role+'-'+Game.time+'-'+room.name,{memory:{role,home:room.name,target}});}
    if(room.controller.level>=2&&!active.some(c=>c.memory.role==='scout')){make('scout',[MOVE]);return;}
    const e=Memory.frontier.expansion;
    if(!e||e.home!==room.name||e.state==='complete'||e.state==='blocked')return;
    const targetRoom=Game.rooms[e.target];
    if(targetRoom&&targetRoom.controller&&targetRoom.controller.owner&&!targetRoom.controller.my){e.state='blocked';e.reason='target claimed by another player';return;}
    // Once the colony has its own spawn, local recovery owns staffing. Sending
    // more pioneers whenever earlier ones change home would drain the mother room.
    if(targetRoom&&targetRoom.controller&&targetRoom.controller.my&&targetRoom.find(FIND_MY_SPAWNS).length)return;
    if(!targetRoom||!targetRoom.controller||!targetRoom.controller.my){
        if(!active.some(c=>c.memory.role==='claimer'&&c.memory.target===e.target)){make('claimer',[CLAIM,MOVE],e.target);return;}
    }
    if(active.filter(c=>c.memory.role==='pioneer'&&c.memory.target===e.target).length<2){make('pioneer',[WORK,WORK,CARRY,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE],e.target);}
}
function run(c,h){
    if(c.memory.role==='scout'){scout(c,h);return;}
    if(c.memory.role==='claimer'){
        if(!travel(c,c.memory.target,h.go))return;record(c.room);
        const ctrl=c.room.controller;if(!ctrl)return;
        if(ctrl.my){c.memory.role='scout';delete c.memory.target;return;}
        if(ctrl.owner||ctrl.reservation&&ctrl.reservation.username!==Game.spawns[Object.keys(Game.spawns)[0]].owner.username){Memory.frontier.expansion.state='blocked';return;}
        if(c.claimController(ctrl)===ERR_NOT_IN_RANGE)h.go(c,ctrl);return;
    }
    if(c.memory.role==='pioneer'){
        if(c.room.name===c.memory.home&&!c.memory.departed&&c.store.getFreeCapacity(E)>0){h.refuel(c);return;}
        c.memory.departed=true;if(!travel(c,c.memory.target,h.go))return;
        if(!c.room.controller||!c.room.controller.my){h.refuel(c);return;}
        const plan=planner.ensure(c.room);
        if(!plan||!plan.anchor||!plan.complete){const e=Memory.frontier.expansion;if(e&&e.target===c.room.name){e.state='blocked';e.reason='Target room layout or resource access is incomplete';}return;}
        if(!c.room.find(FIND_MY_SPAWNS).length&&!c.room.find(FIND_MY_CONSTRUCTION_SITES,{filter:s=>s.structureType===STRUCTURE_SPAWN}).length)c.room.createConstructionSite(plan.anchor.x,plan.anchor.y,STRUCTURE_SPAWN,'Outpost-'+c.room.name);
        h.work(c);
        if(c.room.find(FIND_MY_SPAWNS).length){c.memory.home=c.room.name;c.memory.role='bootstrap';delete c.memory.target;}
    }
}
function tick(owned){
    for(const room of owned)record(room);
    if(Game.time%50!==0)return;
    Memory.frontier.candidates={};for(const room of owned)Memory.frontier.candidates[room.name]=candidates(room.name).slice(0,6);
    const current=Memory.frontier.expansion;
    if(current&&current.state==='blocked')return;
    if(current&&current.state!=='complete'&&current.state!=='blocked'){
        const target=Game.rooms[current.target];
        if(target&&target.find(FIND_MY_SPAWNS).length){
            current.state='stabilizing';
            const units=values(Game.creeps).filter(c=>c.memory.home===current.target&&(c.spawning||c.ticksToLive>100));
            const covered=target.find(FIND_SOURCES).every(s=>units.filter(c=>c.memory.role==='miner'&&c.memory.source===s.id).reduce((n,c)=>n+c.getActiveBodyparts(WORK),0)>=2);
            const telemetry=Memory.frontier.telemetry&&Memory.frontier.telemetry.rooms[current.target];
            if(covered&&units.some(c=>c.memory.role==='hauler')&&target.controller.level>=2&&telemetry&&telemetry.upgradeEMA>.2){current.state='complete';current.completed=Game.time;console.log('[Frontier] Self-sustaining colony '+current.target);}
        }
        else if(Game.time-current.started>6000){current.state='blocked';current.reason='bootstrap timeout; review required';}
        return;
    }
    if(current&&current.completed&&Game.time-current.completed<1000)return;
    // Keep the main room funded. With the current 20 CPU allowance, limit initial empire to 3 rooms.
    if(owned.length>=Math.min(Game.gcl.level,Memory.frontier.maxRooms||3))return;
    if(Memory.frontier.pauseExpansion||Game.cpu.bucket<7000||Memory.frontier.status&&Memory.frontier.status.cpu>12)return;
    const telemetry=Memory.frontier.telemetry;
    if(!telemetry||telemetry.cpuEMA>12||values(telemetry.alerts).some(a=>['cpu-headroom','haul-backlog','downgrade-risk'].includes(a.code)))return;
    for(const home of owned){
        if(home.controller.level<4||!home.storage||home.storage.store[E]<12000||home.find(FIND_HOSTILE_CREEPS).length)continue;
        const metrics=telemetry.rooms[home.name],history=metrics&&metrics.history;
        if(!history||history.length<6||history[history.length-1].bank<history[history.length-6].bank)continue;
        const stable=values(Game.creeps).filter(c=>c.memory.home===home.name&&(c.spawning||c.ticksToLive>100));
        if(!home.find(FIND_SOURCES).every(s=>stable.filter(c=>c.memory.role==='miner'&&c.memory.source===s.id).reduce((n,c)=>n+c.getActiveBodyparts(WORK),0)>=4))continue;
        if(stable.filter(c=>c.memory.role==='hauler').reduce((n,c)=>n+c.getActiveBodyparts(CARRY),0)<8)continue;
        const list=Memory.frontier.candidates[home.name];if(!list||!list.length)continue;
        const best=list[0];Memory.frontier.expansion={home:home.name,target:best.room,state:'launching',started:Game.time,score:best.score};
        console.log('[Frontier] Expansion '+home.name+' -> '+best.room+' score '+best.score);break;
    }
}
module.exports={spawn,run,tick,record,candidates};
