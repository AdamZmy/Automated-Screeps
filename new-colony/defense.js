'use strict';
const {range,energy,roomCreeps,hostiles,myStructures,structures,spawns,go,commitEnergy}=require('runtime');
const power=(c,type,base)=>c.getActiveBodyparts(type)*base;
function assessment(room){
    const enemies=hostiles(room),armed=enemies.filter(c=>power(c,ATTACK,1)||power(c,RANGED_ATTACK,1)||power(c,WORK,1));
    const critical=spawns(room).concat(room.storage?[room.storage]:[]);
    const damage=armed.reduce((n,c)=>n+power(c,ATTACK,ATTACK_POWER)+power(c,RANGED_ATTACK,RANGED_ATTACK_POWER)+power(c,WORK,DISMANTLE_POWER),0);
    const healing=enemies.reduce((n,c)=>n+power(c,HEAL,HEAL_POWER),0);
    const immediate=armed.some(c=>critical.some(s=>range(c,s)<6));
    const result={tick:Game.time,level:immediate?'siege':enemies.length?'alert':'peace',count:enemies.length,armed:armed.length,damage,healing,immediate};
    const root=Memory.frontier||(Memory.frontier={rooms:{}});root.rooms=root.rooms||{};
    (root.rooms[room.name]||(root.rooms[room.name]={})).security=result;
    return result;
}
function defend(room){
    const state=assessment(room),enemies=hostiles(room),towers=myStructures(room).filter(s=>s.structureType===STRUCTURE_TOWER&&energy(s)>=TOWER_ENERGY_COST);
    // Focus fire first; all towers see the same target and threat snapshot.
    const enemy=enemies.slice().sort((a,b)=>{
        const threat=c=>power(c,HEAL,HEAL_POWER)*2+power(c,ATTACK,ATTACK_POWER)+power(c,RANGED_ATTACK,RANGED_ATTACK_POWER)+power(c,WORK,DISMANTLE_POWER);
        return threat(b)-threat(a)||a.hits-b.hits;
    })[0];
    for(const t of towers){
        let result;
        if(enemy)result=t.attack(enemy);
        else {const hurt=t.pos.findClosestByRange(roomCreeps(room).filter(c=>c.hits<c.hitsMax));
            if(hurt)result=t.heal(hurt);
            else if(energy(t)>650){const weak=t.pos.findClosestByRange(structures(room).filter(s=>s.structureType===STRUCTURE_RAMPART&&s.my&&s.hits<20000));if(weak)result=t.repair(weak);}}
        if(result===OK)commitEnergy(t,null,TOWER_ENERGY_COST,0);
    }
    return state;
}
function arbitrateSafeMode(rooms){
    if(rooms.some(r=>r.controller&&r.controller.safeMode))return null;
    const requests=rooms.filter(r=>{const c=r.controller,s=Memory.frontier.rooms[r.name]&&Memory.frontier.rooms[r.name].security;
        return c&&c.my&&c.safeModeAvailable>0&&!c.safeModeCooldown&&!c.upgradeBlocked&&s&&s.immediate&&
            (c.ticksToDowngrade===undefined||c.ticksToDowngrade>=CONTROLLER_DOWNGRADE[c.level]/2-CONTROLLER_DOWNGRADE_SAFEMODE_THRESHOLD);});
    requests.sort((a,b)=>Memory.frontier.rooms[b.name].security.damage-Memory.frontier.rooms[a.name].security.damage||a.name.localeCompare(b.name));
    const room=requests[0];if(!room)return null;
    const code=room.controller.activateSafeMode();
    Memory.frontier.rooms[room.name].security.safeModeIntent={tick:Game.time,code};
    return {room:room.name,code};
}
function evacuate(c){
    if(c.room.controller&&c.room.controller.my&&c.room.controller.safeMode)return false;
    const enemies=hostiles(c.room).filter(h=>h.getActiveBodyparts(ATTACK)||h.getActiveBodyparts(RANGED_ATTACK)||h.getActiveBodyparts(WORK));
    if(!enemies.some(h=>range(c,h)<=4))return false;
    // Only immediate danger takes ownership. Local escape candidates avoid
    // obstacle tiles and never count fatigue as a path failure.
    const terrain=c.room.getTerrain(),distance=p=>Math.min(...enemies.map(h=>range(h,p)));
    const options=[];
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const p={x:c.pos.x+dx,y:c.pos.y+dy,roomName:c.room.name};
        if((!dx&&!dy)||p.x<1||p.y<1||p.x>48||p.y>48||terrain.get(p.x,p.y)&TERRAIN_MASK_WALL)continue;
        if(c.room.lookForAt(LOOK_STRUCTURES,p.x,p.y).some(s=>OBSTACLE_OBJECT_TYPES.includes(s.structureType)||(s.structureType===STRUCTURE_RAMPART&&!s.my&&!s.isPublic)))continue;
        options.push(p);
    }
    options.sort((a,b)=>distance(b)-distance(a));
    c.memory.evacuation={tick:Game.time,reason:'armed-hostile-in-range'};
    if(options[0]&&distance(options[0])>distance(c))go(c,options[0],0,{owner:'defense',ignoreCreeps:false});
    return true;
}
module.exports={assessment,defend,arbitrateSafeMode,evacuate};
