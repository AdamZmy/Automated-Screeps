'use strict';
// Independent regression for a real overflow-worker branch: every safe parking
// tile is reserved, and the worker must hand the occupied port to logistics.
const assert=require('node:assert/strict'),vm=require('node:vm');
const {constants:C,loadGameModule}=require('./test-support/runtime.cjs');
function fixture(){
    const actions=[],objects=[];
    const ctx={...C,console,Game:{time:1,rooms:{},creeps:{}},Memory:{frontier:{rooms:{}}}};
    class Position{constructor(x,y,roomName='W1N1'){Object.assign(this,{x,y,roomName});}}
    ctx.RoomPosition=Position;
    const room={name:'W1N1',controller:{my:true,level:4,pos:new Position(10,10),ticksToDowngrade:10000},
        getTerrain:()=>({get:()=>0}),lookForAt:(type,x,y)=>objects.filter(o=>o.pos.x===x&&o.pos.y===y),
        find(type){if(type===C.FIND_STRUCTURES||type===C.FIND_MY_STRUCTURES)return objects;
            if(type===C.FIND_MY_CREEPS)return Object.values(ctx.Game.creeps);return [];}};
    const store=(energy,capacity)=>({energy,getFreeCapacity(){return capacity-this.energy;}});
    const box={id:'controller-buffer',my:true,structureType:C.STRUCTURE_CONTAINER,pos:new Position(10,12),store:store(1000,2000)};objects.push(box);
    const roads=[];for(let y=7;y<=13;y++)for(let x=7;x<=13;x++)roads.push({type:C.STRUCTURE_ROAD,x,y});
    ctx.Memory.frontier.rooms[room.name]={plan:{version:3,structures:roads}};ctx.Game.rooms[room.name]=room;
    const c={name:'overflow',id:'overflow',my:true,room,pos:new Position(11,13),memory:{role:'upgrader',home:room.name},store:store(50,100),fatigue:0,
        getActiveBodyparts:type=>type===C.WORK?1:0,moveTo(target,options){actions.push({target,options});return C.OK;},
        upgradeController(){throw Error('Blocked overflow worker should first clear the port');},withdraw(){throw Error('Port clearing precedes refuel');}};
    ctx.Game.creeps[c.name]=c;ctx.Game.getObjectById=id=>objects.find(o=>o.id===id)||ctx.Game.creeps[id];vm.createContext(ctx);
    return {ctx,room,box,c,actions,development:loadGameModule(ctx,'development')};
}
{
    const f=fixture(),station=f.development.controllerStation(f.room);
    f.c.pos=new f.ctx.RoomPosition(station.port.x,station.port.y,f.room.name);
    assert.equal(station.seats.length,0,'The fixture must offer no legal non-road seat or overflow parking');
    assert.equal(f.development.overflowUpgrade(f.c,{primary:[f.c]}),true);
    assert.equal(f.actions.length,1,'No-parking branch hands port clearing to real logistics and movement');
    assert.equal(f.actions[0].options.range,0);
    assert(Math.max(Math.abs(f.actions[0].target.x-f.box.pos.x),Math.abs(f.actions[0].target.y-f.box.pos.y))>1,'Movement leaves the container unloading endpoints');
}
{
    const f=fixture(),station=f.development.controllerStation(f.room);
    f.c.pos=new f.ctx.RoomPosition(station.port.x,station.port.y,f.room.name);f.c.fatigue=2;
    assert.equal(f.development.overflowUpgrade(f.c,{primary:[f.c]}),true);
    assert.equal(f.actions.length,0,'Fatigue waits without manufacturing a move or refuel intent');
    assert.equal(f.c.memory.movement.state,'fatigue');
}
console.log('PASS: overflow worker with no parking clears its port through logistics; fatigue remains a legitimate wait');
