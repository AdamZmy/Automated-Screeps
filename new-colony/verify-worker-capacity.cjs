'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const project=__dirname;
const {constants:C,loadGameModule}=require(path.join(project,'test-support/runtime.cjs'));
const workforcePath=path.join(__dirname,'workforce.js');
const count=(parts,type)=>parts.filter(p=>(p.type||p)===type).length;
const price=parts=>parts.reduce((n,p)=>n+C.BODYPART_COST[p.type||p],0);
function fixture({capacity=1300,energy=capacity,spawnCount=1,target=20}={}){
    const ctx={...C,console,Game:{time:1000,creeps:{},rooms:{},constructionSites:{},cpu:{limit:20,bucket:10000}},Memory:{frontier:{rooms:{}}},global:{}};
    const objects=[],sites=[],births=[],spawnList=[],actions=[];
    const room={name:'W1N1',objects,sites,energyCapacityAvailable:capacity,energyAvailable:energy,getTerrain:()=>({get:()=>0}),lookForAt:()=>[],find(type){
        if(type===C.FIND_SOURCES)return objects.filter(o=>o.source);
        if(type===C.FIND_MY_CREEPS)return Object.values(ctx.Game.creeps);
        if(type===C.FIND_MY_SPAWNS)return spawnList;
        if(type===C.FIND_MY_CONSTRUCTION_SITES)return sites;
        if(type===C.FIND_STRUCTURES||type===C.FIND_MY_STRUCTURES)return objects.filter(o=>o.structureType);
        return [];
    }};
    const pos=(x,y)=>({x,y,roomName:room.name,getRangeTo(o){const p=o.pos||o;return Math.max(Math.abs(x-p.x),Math.abs(y-p.y));}});
    ctx.RoomPosition=class{constructor(x,y,roomName){this.x=x;this.y=y;this.roomName=roomName;}};
    room.controller={my:true,level:4,pos:pos(10,10),ticksToDowngrade:10000};ctx.Game.rooms[room.name]=room;
    const control={at:ctx.Game.time,plannedHarvest:target,carry:6,routes:[{roundTrip:20}],target,harvestPotential:20,usefulTarget:20,developmentBudget:20,buildEnergyTarget:0,mode:'growth'};
    ctx.Memory.frontier.rooms[room.name]={economyControl:control};
    ctx.gameModuleOverrides={colony:{economyMemory:()=>ctx.Memory.frontier.rooms[room.name],updateEconomy:()=>control,upgradePolicy:()=>({target,mode:'growth'}),policy:()=>({cpuMode:'normal'}),routeTravel:()=>10}};
    vm.createContext(ctx);
    const minerModule={exports:{}};
    vm.runInContext('(function(require,module,exports){'+fs.readFileSync(path.join(__dirname,'mining.js'),'utf8')+'\n})',ctx)(name=>loadGameModule(ctx,name),minerModule,minerModule.exports);
    ctx.gameModuleOverrides.mining=minerModule.exports;
    const module={exports:{}};
    vm.runInContext('(function(require,module,exports){'+fs.readFileSync(workforcePath,'utf8')+'\n})',ctx)(name=>loadGameModule(ctx,name),module,module.exports);
    const api=module.exports;ctx.gameModuleOverrides.workforce=api;
    function creep(name,role,parts,ttl=1500){
        const c={name,id:name,room,pos:pos(11,11),memory:{role,home:room.name},body:parts.map(p=>typeof p==='string'?{type:p,hits:100}:{...p}),ticksToLive:ttl,spawning:false,
            store:{energy:0,getFreeCapacity:()=>50},moveTo(){actions.push(['move',name]);return C.OK;},harvest(){actions.push(['harvest',name]);return C.OK;},
            transfer(target,resource,amount){actions.push(['transfer',name,target.id,amount]);return Math.max(Math.abs(this.pos.x-target.pos.x),Math.abs(this.pos.y-target.pos.y))<=1?C.OK:C.ERR_NOT_IN_RANGE;},
            getActiveBodyparts(type){return this.body.filter(p=>p.type===type&&p.hits>0).length;}};
        ctx.Game.creeps[name]=c;return c;
    }
    for(let i=0;i<spawnCount;i++){
        const spawn={id:'spawn'+i,my:true,structureType:C.STRUCTURE_SPAWN,pos:pos(20+i,20),store:{energy:300,getFreeCapacity:()=>0}};
        spawn.spawnCreep=(parts,name,{memory})=>{births.push({parts:Array.from(parts),name,memory:{...memory},spawn,tick:ctx.Game.time});return C.OK;};
        objects.push(spawn);spawnList.push(spawn);
    }
    for(let i=0;i<2;i++){
        const source={id:'source'+i,source:true,pos:pos(25+i*10,25),energyCapacity:3000,energy:3000};objects.push(source);
        const c=creep('miner'+i,'miner',Array(5).fill(C.WORK).concat(C.CARRY,C.MOVE,C.MOVE,C.MOVE),10000);
        c.memory.source=source.id;c.pos=pos(source.pos.x-1,source.pos.y);
    }
    creep('haul','hauler',Array(6).fill(C.CARRY).concat(Array(6).fill(C.MOVE)),10000);
    ctx.Game.getObjectById=id=>objects.find(o=>o.id===id)||ctx.Game.creeps[id];
    let observed=0;
    function observe(){
        for(;observed<births.length;observed++){
            const b=births[observed];b.spawn.spawning={name:b.name,remainingTime:b.parts.length*C.CREEP_SPAWN_TIME};
            const c=creep(b.name,b.memory.role,b.parts);c.memory=b.memory;c.spawning=true;delete c.ticksToLive;
        }
    }
    function advance(energy=room.energyCapacityAvailable){
        observe();ctx.Game.time++;room.energyAvailable=energy;
        for(const c of Object.values(ctx.Game.creeps))if(!c.spawning&&--c.ticksToLive<=0)delete ctx.Game.creeps[c.name];
        for(const spawn of spawnList)if(spawn.spawning&&--spawn.spawning.remainingTime<=0){
            const c=ctx.Game.creeps[spawn.spawning.name];c.spawning=false;c.ticksToLive=1500;spawn.spawning=null;
        }
    }
    const roster=()=>Object.values(ctx.Game.creeps),pool=()=>api.workerPoolPlan(room,control,api.reconcileBirths(room,roster()).roster);
    const run=()=>api.spawnRoom(room);
    return {ctx,room,control,objects,births,spawnList,creep,api,mining:minerModule.exports,actions,advance,observe,roster,pool,run};
}
function worker(f,name,work,ttl=1500){return f.creep(name,'worker',f.api.body('worker',f.room.energyCapacityAvailable,{workLimit:work}),ttl);}
function cap(f){assert(f.pool().reserved<=f.pool().target,'all living, spawning and accepted WORK stays within target');}
{
    const f=fixture({energy:200});worker(f,'retained',8);
    for(const energy of [200,350,550,1299]){
        f.room.energyAvailable=energy;f.run();assert.equal(f.births.length,0,'low funding waits instead of making a tiny ordinary worker');
        assert.equal(f.ctx.Memory.frontier.rooms.W1N1.workforce.queued.find(r=>r.role==='worker').reason,'insufficient-energy');f.advance(energy);
    }
    f.room.energyAvailable=1300;f.run();assert.equal(count(f.births[0].parts,C.WORK),8);assert.equal(price(f.births[0].parts),1300);cap(f);
    f.run();assert.equal(f.births.length,1,'accepted intent cannot be duplicated during a repeated entry');cap(f);
}
{
    const f=fixture();worker(f,'a',8);worker(f,'b',8);
    f.run();assert.equal(count(f.births[0].parts,C.WORK),4,'only the real target tail is shortened');cap(f);
}
{
    const f=fixture();const parts=[1,1,3,1,3,2,1,1,1,3,3];
    parts.forEach((w,i)=>worker(f,'legacy'+i,w,30+i*12));
    for(let t=0;t<400;t++){f.run();cap(f);assert(!f.births.some(b=>count(b.parts,C.WORK)<4),'legacy fragment deaths never reproduce tiny workers');f.advance();}
    assert.equal(f.pool().transitional,0);assert.equal(f.pool().missing.length,0);
    assert.deepEqual(f.roster().filter(c=>c.memory.role==='worker').map(c=>count(c.body,C.WORK)).sort((a,b)=>a-b),[4,8,8]);
    assert.equal(f.births.length,3,'eleven fragments converge through three accepted births');
}
{
    const f=fixture({capacity:1800});[8,8,4].forEach((w,i)=>worker(f,'old'+i,w,20+i*20));
    for(let t=0;t<230;t++){f.run();cap(f);f.advance();}
    assert.deepEqual(f.roster().filter(c=>c.memory.role==='worker').map(c=>count(c.body,C.WORK)),[10,10]);
}
{
    const f=fixture();worker(f,'a',8,1);worker(f,'b',8);worker(f,'tail',4);
    f.run();assert.equal(f.births.length,0,'no individual early renewal while predecessor still occupies WORK');cap(f);
    f.advance();f.run();assert.equal(count(f.births[0].parts,C.WORK),8);cap(f);
    for(let t=0;t<60;t++){f.advance();f.run();cap(f);}assert.equal(f.births.length,1);
}
{
    const f=fixture();worker(f,'a',8);worker(f,'b',8);worker(f,'tail',4);worker(f,'old-overlap',1,1);
    f.run();assert.equal(f.births.length,0);assert.equal(f.pool().reserved,21,'pre-deployment overlap is retained without killing units');
    f.advance();f.run();cap(f);assert.equal(f.births.length,0,'natural retirement resolves old excess without another birth');
}
{
    const f=fixture();const c=worker(f,'injured',8);worker(f,'other',8);worker(f,'tail',4);
    c.body.filter(p=>p.type===C.WORK).slice(0,4).forEach(p=>p.hits=0);
    assert.equal(f.api.workerWork(f.roster()),16);f.run();assert.equal(f.births.length,0);cap(f);
    c.body.forEach(p=>p.hits=100);f.advance();f.run();assert.equal(f.births.length,0);cap(f);
}
{
    const f=fixture({spawnCount:2});worker(f,'incumbent',8);
    const request=(id,work,role='worker')=>({id,owner:'external',slotKey:id,home:f.room.name,role,body:f.api.body('worker',1300,{workLimit:work}),priority:5000,memory:{},reason:'external'});
    f.api.spawnRoom(f.room,[request('full',8),request('tail',4),request('tiny',1)]);cap(f);
    assert.deepEqual(f.births.map(b=>count(b.parts,C.WORK)),[8],'second spawn cannot spend energy reserved by the first');
    f.api.spawnRoom(f.room,[request('other-tail',4)]);assert.equal(f.births.length,1);cap(f);
    f.observe();f.advance();f.api.spawnRoom(f.room,[request('tail',4),request('tiny',1,'upgrader')]);assert.equal(f.births.length,2);cap(f);
    f.observe();f.advance();f.api.spawnRoom(f.room,[request('excess',4)]);assert.equal(f.births.length,2);cap(f);
}
{
    const f=fixture({target:5});assert.deepEqual(Array.from(f.pool().slots,s=>s.work),[5]);f.run();cap(f);assert.equal(count(f.births[0].parts,C.WORK),5);
}
{
    const f=fixture({spawnCount:2});worker(f,'a',8);worker(f,'b',8);worker(f,'legacy',2);
    const request=id=>({id,owner:'external',slotKey:id,home:f.room.name,role:'bootstrap',body:[C.WORK,C.WORK,C.CARRY,C.CARRY,C.MOVE,C.MOVE],priority:5000,memory:{},reason:'recovery'});
    f.api.spawnRoom(f.room,[request('first'),request('second')]);cap(f);
    assert.equal(f.births.length,1,'enough shared energy cannot override the WORK cap on a second spawn');
    assert.equal(f.ctx.Memory.frontier.rooms.W1N1.workforce.waiting['external|second'].reason,'worker-work-cap');
}
{
    const f=fixture({spawnCount:2});worker(f,'fragment',1);
    const request={id:'once',owner:'external',slotKey:'once',home:f.room.name,role:'upgrader',body:f.api.body('worker',1300),priority:5000,memory:{},reason:'legacy-alias'};
    f.api.spawnRoom(f.room,[request]);cap(f);f.observe();f.advance();f.api.spawnRoom(f.room,[request]);cap(f);
    assert.equal(f.births.filter(b=>b.memory.spawnOwner==='external').length,1,'observed worker covers the same external legacy owner-slot');
    assert(f.births.every(b=>b.memory.role==='worker'));
}
{
    const f=fixture();f.creep('bootstrap','bootstrap',[C.WORK,C.CARRY,C.MOVE]);worker(f,'a',8);worker(f,'b',8);
    f.run();assert.equal(f.births.length,0,'bootstrap occupies capacity even without matching a standard slot');cap(f);
    delete f.ctx.Game.creeps.bootstrap;f.advance();f.run();assert.equal(count(f.births[0].parts,C.WORK),4);cap(f);
}
{
    const f=fixture();f.run();assert.equal(f.births.length,1);cap(f);
    // Accepted intent not observed on the following snapshot is released.
    f.ctx.Game.time++;f.run();assert.equal(f.births.length,2);cap(f);
}
{
    const f=fixture();worker(f,'a',8);worker(f,'b',8);worker(f,'tail',4);
    f.room.energyCapacityAvailable=1800;f.room.energyAvailable=1800;f.advance(1800);f.run();assert.equal(f.births.length,0);cap(f);
    assert.deepEqual(Array.from(f.pool().slots,s=>s.work),[10,10]);
}
{
    const f=fixture();worker(f,'a',8);worker(f,'b',8);worker(f,'tail',4);
    const old=f.ctx.Game.creeps.miner0;old.memory.spawnOwner='colony:W1N1';old.memory.spawnSlot='source-slot';
    const next=f.creep('successor','miner',f.api.body('miner',1300));next.memory.source=old.memory.source;next.memory.replaces=old.name;
    next.pos={...old.pos,x:old.pos.x-1};f.mining.mine(next);
    assert.equal(old.memory.role,'miner');assert.equal(old.memory.retiredMiner,true);assert.equal(old.memory.source,undefined);assert.equal(old.memory.spawnSlot,undefined);cap(f);
    f.mining.mine(old);assert(f.actions.some(a=>a[0]==='move'&&a[1]===old.name),'retired predecessor clears the source tile');
    old.pos={...old.pos,x:old.pos.x-4};f.actions.length=0;f.mining.mine(old);
    assert.equal(f.actions.length,0,'empty retired miner never performs development, harvesting or repeated collection');
    assert.equal(f.mining.operations(f.room,f.roster())[0].assigned.length,1);
    delete f.ctx.Game.creeps.successor;delete f.ctx.Game.creeps.miner1;
    f.advance();const requests=f.api.roomRequests(f.room,f.roster(),f.control,f.api.workforceDemand(f.room,f.control,f.roster()));
    assert(requests.some(r=>r.role==='miner'&&r.reason==='restore-source-harvesting'),'retired miner cannot hide missing source capacity');
}
{
    const f=fixture(),old=f.ctx.Game.creeps.miner0;old.memory.retiredMiner=true;delete old.memory.source;
    old.pos={x:15,y:15,roomName:f.room.name};old.store.energy=50;
    const storage={id:'storage',my:true,structureType:C.STRUCTURE_STORAGE,pos:{x:16,y:15,roomName:f.room.name},store:{energy:0,getFreeCapacity(){return 1000-this.energy;}}};
    f.objects.push(storage);f.room.storage=storage;f.mining.mine(old);
    const transfer=f.actions.find(a=>a[0]==='transfer'&&a[1]===old.name);assert(transfer&&transfer[3]===50,'retired miner transfers its existing cargo');
    old.store.energy=0;storage.store.energy=50;
    for(let t=0;t<5;t++){f.advance();f.actions.length=0;f.mining.mine(old);assert.equal(f.actions.length,0,'empty retired miner does not start another pickup cycle');}
}
console.log('PASS worker capacity: fixed funding/template, exact tail, W23/W21 natural convergence, no renewal overlap, nominal damaged WORK, shared multi-spawn/pending/external cap, bootstrap accounting and capacity/target changes');
