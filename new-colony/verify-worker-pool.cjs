'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm');
const {constants:C,loadGameModule}=require('./test-support/runtime.cjs');
const ctx={...C,console,Game:{time:1000,creeps:{},rooms:{},constructionSites:{},cpu:{limit:20,bucket:10000}},Memory:{frontier:{rooms:{}}},global:{}};
vm.createContext(ctx);
const workforce=loadGameModule(ctx,'workforce'),development=loadGameModule(ctx,'development');
function fixture(sandbox=ctx){
    const ctx=sandbox;ctx.Game.time++;
    ctx.Game.creeps={};ctx.Game.rooms={};ctx.Game.constructionSites={};
    const objects=[],sites=[],visual={polys:[],circles:[],poly(p,o){this.polys.push({p,o});},circle(x,y,o){this.circles.push({x,y,o});}};
    const room={name:'W1N1',objects,sites,visual,energyCapacityAvailable:1300,energyAvailable:1300,
        getTerrain:()=>({get:()=>0}),lookForAt:()=>[],find(type){
            if(type===C.FIND_SOURCES)return objects.filter(o=>o.source);
            if(type===C.FIND_MY_CREEPS)return Object.values(ctx.Game.creeps);
            if(type===C.FIND_MY_SPAWNS)return objects.filter(o=>o.structureType===C.STRUCTURE_SPAWN);
            if(type===C.FIND_MY_CONSTRUCTION_SITES)return sites;
            if(type===C.FIND_STRUCTURES||type===C.FIND_MY_STRUCTURES)return objects.filter(o=>o.structureType);
            return [];
        }};
    const pos=(x,y)=>({x,y,roomName:room.name,getRangeTo(o){const q=o.pos||o;return Math.max(Math.abs(x-q.x),Math.abs(y-q.y));}});
    room.controller={my:true,level:4,pos:pos(10,10),ticksToDowngrade:10000};
    const store=(n=0,capacity=1000000)=>({[C.RESOURCE_ENERGY]:n,getFreeCapacity(){return capacity-this[C.RESOURCE_ENERGY];}});
    const spawn={id:'spawn',my:true,structureType:C.STRUCTURE_SPAWN,pos:pos(20,20),store:store(0,300)};
    objects.push(spawn,{id:'s1',source:true,pos:pos(25,25),energyCapacity:3000,energy:3000},{id:'s2',source:true,pos:pos(16,42),energyCapacity:3000,energy:3000});
    ctx.Game.rooms[room.name]=room;ctx.Memory.frontier.rooms[room.name]={economyControl:{at:1000,baseMode:'growth',mode:'growth',target:10}};
    function creep(name,role,parts,ttl){
        const c={name,id:name,room,pos:pos(15,15),memory:{role,home:room.name},body:parts,ticksToLive:ttl,spawning:false,
            getActiveBodyparts(type){return this.body.filter(p=>(p.type||p)===type).length;}};
        ctx.Game.creeps[name]=c;return c;
    }
    return {room,objects,sites,visual,pos,store,spawn,creep};
}
function workerParts(work){return Array(work).fill(C.WORK).concat([C.CARRY,C.MOVE]);}
const carryParts=carry=>Array(carry).fill(C.CARRY).concat(Array(carry).fill(C.MOVE));
const countCarry=parts=>parts.filter(p=>(p.type||p)===C.CARRY).length;
const cost=parts=>parts.reduce((n,p)=>n+C.BODYPART_COST[p.type||p],0);
// Fix demand for these timeline tests while using the real workforce,
// development, mining and runtime modules. Economic feedback is out of scope.
function renewalFixture({carry=6,energy=600,spawnCount=1}={}){
    const sandbox={...C,console,Game:{time:2000,creeps:{},rooms:{},constructionSites:{},cpu:{limit:20,bucket:10000}},
        Memory:{frontier:{rooms:{}}},global:{}};
    const f=fixture(sandbox),control={at:sandbox.Game.time,plannedHarvest:20,usefulTarget:20,developmentBudget:20,
        target:20,buildEnergyTarget:0,carry,routes:[{roundTrip:40}],mode:'growth',baseMode:'growth'};
    sandbox.gameModuleOverrides={colony:{economyMemory:room=>sandbox.Memory.frontier.rooms[room.name],
        updateEconomy:()=>control,upgradePolicy:()=>({target:20,mode:'growth'}),policy:()=>({cpuMode:'normal'}),routeTravel:()=>10}};
    vm.createContext(sandbox);
    const api=loadGameModule(sandbox,'workforce'),births=[],spawnList=[f.spawn];
    for(let i=1;i<spawnCount;i++){
        const spawn={...f.spawn,id:'spawn'+i,pos:f.pos(20+i,20)};f.objects.push(spawn);spawnList.push(spawn);
    }
    for(const spawn of spawnList)spawn.spawnCreep=(parts,name,{memory})=>{
        births.push({parts,name,memory,spawn,tick:sandbox.Game.time});return C.OK;
    };
    f.room.energyAvailable=energy;
    for(const source of f.objects.filter(o=>o.source)){
        const miner=f.creep('miner-'+source.id,'miner',[...Array(5).fill(C.WORK),C.CARRY,...Array(3).fill(C.MOVE)],1400);
        miner.memory.source=source.id;miner.pos=f.pos(source.pos.x-1,source.pos.y);
    }
    f.creep('full-work-pool','worker',workerParts(20),1400);
    const roster=()=>Object.values(sandbox.Game.creeps);
    function advance(energy=f.room.energyAvailable){
        sandbox.Game.time++;f.room.energyAvailable=energy;
        for(const c of roster())if(!c.spawning&&--c.ticksToLive<=0)delete sandbox.Game.creeps[c.name];
        for(const spawn of spawnList)if(spawn.spawning&&--spawn.spawning.remainingTime<=0){
            const born=births.find(b=>b.name===spawn.spawning.name);
            if(born){
                const c=sandbox.Game.creeps[born.name]||f.creep(born.name,born.memory.role,born.parts,1500);
                c.memory=born.memory;c.spawning=false;
            }
            spawn.spawning=null;
        }
    }
    function observe(born,withCreep=false){
        born.spawn.spawning={name:born.name,remainingTime:born.parts.length*C.CREEP_SPAWN_TIME};
        if(withCreep){const c=f.creep(born.name,born.memory.role,born.parts,1500);c.memory=born.memory;c.spawning=true;return c;}
    }
    return {...f,api,control,births,spawnList,sandbox,roster,advance,observe,
        state:()=>sandbox.Memory.frontier.rooms[f.room.name].workforce,
        plans:()=>api.workerRenewals(f.room,roster(),control).filter(r=>r.role==='hauler')};
}

{
    const expected=[[300,1,100],[550,2,200],[800,4,400],[1300,6,600],[1800,9,900],[3300,16,1600]];
    for(const [capacity,carry,cost] of expected){
        const room={energyCapacityAvailable:capacity};
        const body=workforce.standardHaulerBody(room);
        assert.equal(workforce.standardHaulerBudget(room),Math.floor(capacity*.5),'standard budget is half of spawn/extension capacity');
        assert.equal(body.filter(p=>p===C.CARRY).length,carry,'ordinary hauler carry is stable for the room capacity');
        assert.equal(body.filter(p=>p===C.MOVE).length,carry,'ordinary hauler keeps one MOVE per CARRY');
        assert.equal(body.reduce((n,p)=>n+C.BODYPART_COST[p],0),cost,'ordinary hauler spends complete CARRY+MOVE pairs');
    }
    assert.equal(workforce.emergencyHaulerBody({energyAvailable:300}).filter(p=>p===C.CARRY).length,3,
        'initial recovery may use the currently available energy instead of waiting for the standard body');
}

{
    const f=fixture();
    f.creep('existing-hauler','hauler',[C.CARRY,C.MOVE],900);
    const control={plannedHarvest:20,usefulTarget:20,developmentBudget:20,target:10,buildEnergyTarget:0,routes:[],carry:10};
    const demand=workforce.workforceDemand(f.room,control,Object.values(ctx.Game.creeps));
    const request=workforce.roomRequests(f.room,Object.values(ctx.Game.creeps),control,demand)
        .find(r=>r.reason==='transport-capacity-gap');
    assert(request,'a live hauler with a transport-capacity gap gets a refill request');
    assert.equal(request.body.filter(p=>p===C.CARRY).length,6,
        'ordinary capacity repair uses the fixed room-sized body instead of the exact gap body');
}

{
    const f=renewalFixture({energy:600}),old=f.creep('old','hauler',carryParts(6),70);
    f.spawn.spawning={name:'other-birth',remainingTime:20};
    const deadline=f.sandbox.Game.time+14; // 70 TTL - 36 spawn - 20 travel
    for(const energy of [600,200,0,300,599]){
        f.room.energyAvailable=energy;
        const plan=f.plans()[0];
        assert(plan,'standard renewal stays inside the busy spawn queue despite funding changes');
        assert.equal(countCarry(plan.body),6);assert.equal(plan.latestStart,deadline);
        f.api.spawnRoom(f.room);
        assert.equal(f.state().queued.find(r=>r.role==='hauler').latestStart,deadline);
        assert.equal(f.births.length,0,'queued ordinary renewal waits while the spawn is busy');
        f.advance();
    }
    assert.equal(f.state().planReused,true,'busy plan reuses its stable standard body across energy changes');
    // The unrelated birth finishes early. There is still time to finance the
    // standard body, so a free spawn must not buy a small emergency carrier.
    f.spawn.spawning=null;
    while(f.sandbox.Game.time<deadline){f.api.spawnRoom(f.room);assert.equal(f.births.length,0);f.advance(200);}
    f.room.energyAvailable=600;f.api.spawnRoom(f.room);
    assert.equal(f.births.length,1);assert.equal(countCarry(f.births[0].parts),6);
    assert.equal(f.births[0].memory.replaces,old.name);
    assert.equal(f.births[0].tick+36+20,f.sandbox.Game.time+old.ticksToLive,'standard successor meets the arrival deadline');
}

{
    const f=renewalFixture({energy:200}),old=f.creep('critical-old','hauler',carryParts(6),57);
    f.api.spawnRoom(f.room);assert.equal(f.births.length,0,'one tick before the safe start cannot trigger emergency');
    f.advance();f.api.spawnRoom(f.room);
    assert.equal(f.births.length,1,'an unaffordable standard body falls back exactly at its safe start');
    const born=f.births[0];assert.equal(countCarry(born.parts),2);assert.equal(cost(born.parts),200);
    assert.equal(born.memory.replaces,old.name);
    assert.equal(countCarry(f.state().pending['colony:W1N1|hauler:0'].body),2,'pending records the actual rescue body');
    f.api.spawnRoom(f.room);assert.equal(f.births.length,1,'accepted intent suppresses a same-tick duplicate');
    f.observe(born);f.advance(600);f.api.spawnRoom(f.room);
    assert.equal(f.births.length,1,'named spawn work suppresses duplication before a creep object exists');
    assert.equal(Object.values(f.state().pending)[0].status,'observed-spawning');
    const successor=f.creep(born.name,'hauler',born.parts,1500);successor.memory=born.memory;successor.spawning=true;
    f.advance();f.api.spawnRoom(f.room);
    assert.equal(f.births.length,1,'observed successor keeps its predecessor covered');
    assert.equal(Object.keys(f.state().pending).length,0);
}

{
    const f=renewalFixture({energy:0});f.creep('unfunded-old','hauler',carryParts(6),56);
    f.api.spawnRoom(f.room);assert.equal(f.births.length,0);
    assert.equal(f.state().queued.find(r=>r.role==='hauler').reason,'insufficient-energy');
    f.advance(100);f.api.spawnRoom(f.room);
    assert.equal(f.births.length,1,'a missed financing deadline retains rescue demand until a pair is affordable');
    assert.equal(countCarry(f.births[0].parts),1);
}

{
    const f=renewalFixture();
    for(let i=0;i<6;i++)f.creep('fragment-'+i,'hauler',carryParts(1),57);
    f.api.spawnRoom(f.room);assert.equal(f.births.length,0);
    f.advance();assert.equal(f.plans().length,1,'equal-deadline fragments need one standard successor');
    f.api.spawnRoom(f.room);assert.equal(f.births.length,1);const born=f.births[0];
    assert.equal(countCarry(born.parts),6);f.observe(born);
    for(let i=0;i<3;i++){f.advance(600);f.api.spawnRoom(f.room);assert.equal(f.births.length,1,'pending CARRY covers the entire expiring cohort');}
    const successor=f.creep(born.name,'hauler',born.parts,1500);successor.memory=born.memory;successor.spawning=true;
    while(Object.values(f.sandbox.Game.creeps).some(c=>c.name.startsWith('fragment-'))){
        f.advance(600);if(!f.spawn.spawning)successor.spawning=false;
        f.api.spawnRoom(f.room);assert.equal(f.births.length,1,'natural retirement must not create excess transport capacity');
    }
    assert.equal(f.roster().filter(c=>c.memory.role==='hauler').length,1,'six fragments converge to one vehicle without killing creeps');
    assert.equal(f.roster().filter(c=>c.memory.role==='worker').reduce((n,c)=>n+c.getActiveBodyparts(C.WORK),0),20);
}

{
    const f=renewalFixture({carry:12,energy:600});
    for(let i=0;i<4;i++)f.creep('peer-'+i,'hauler',carryParts(3),93);
    const deadline=f.sandbox.Game.time+1; // second birth adds 36 ticks of queue
    f.api.spawnRoom(f.room);assert.equal(f.births.length,0);
    f.advance();const plans=f.plans();assert.equal(plans.length,2);
    assert.equal(plans[0].latestStart,deadline);assert.equal(plans[1].latestStart,deadline+36);
    f.api.spawnRoom(f.room);assert.equal(f.births.length,1);f.observe(f.births[0]);
    for(let i=0;i<35;i++){f.advance(600);f.api.spawnRoom(f.room);assert.equal(f.births.length,1);}
    f.advance(600);f.api.spawnRoom(f.room);assert.equal(f.births.length,2,'second standard birth uses the reserved serial slot');
    assert.equal(f.births[1].tick,f.births[0].tick+36);assert.equal(countCarry(f.births[1].parts),6);
    assert.notEqual(f.births[1].memory.replaces,f.births[0].memory.replaces);
    f.observe(f.births[1],true);f.advance(600);f.api.spawnRoom(f.room);
    assert.equal(f.births.length,2,'confirmed and pending successors cover all four retiring peers');
    assert.equal(f.plans().length,0);
}

{
    const f=renewalFixture({carry:12,energy:800,spawnCount:2});
    for(let i=0;i<4;i++)f.creep('parallel-'+i,'hauler',carryParts(3),56);
    f.api.spawnRoom(f.room);assert.equal(f.births.length,2);
    assert.equal(countCarry(f.births[0].parts),6);assert.equal(countCarry(f.births[1].parts),2,
        'second spawn sizes emergency from the remaining shared energy');
    assert.equal(f.births.reduce((n,b)=>n+cost(b.parts),0),800);
    assert.notEqual(f.births[0].memory.replaces,f.births[1].memory.replaces);
    f.api.spawnRoom(f.room);assert.equal(f.births.length,2,'two accepted slots cannot be reused in the same tick');
    for(const born of f.births)f.observe(born);
    f.advance(600);const plans=f.api.workerRenewals(f.room,f.api.reconcileBirths(f.room,f.roster()).roster,f.control)
        .filter(r=>r.role==='hauler');
    assert.equal(plans.length,1,'actual emergency CARRY leaves one real future gap instead of assuming a full standard birth');
    assert(!f.births.some(b=>b.memory.replaces===plans[0].memory.replaces),'future gap never renews an already covered predecessor');
}

{
    const f=renewalFixture({carry:12,energy:600,spawnCount:2});
    f.spawn.spawning={name:'long-birth',remainingTime:100};
    for(let i=0;i<4;i++)f.creep('busy-peer-'+i,'hauler',carryParts(3),92);
    const plans=f.plans();assert.equal(plans.length,2);
    assert.equal(plans[0].latestStart,f.sandbox.Game.time,'busy parallel spawn cannot hide required serial queue time');
    assert.equal(plans[1].latestStart,f.sandbox.Game.time+36);
}

{
    const f=renewalFixture();f.creep('retry-old','hauler',carryParts(6),56);
    f.api.spawnRoom(f.room);assert.equal(f.births.length,1);
    f.advance(600);f.api.spawnRoom(f.room);
    assert.equal(f.births.length,2,'an unobserved accepted intent is released next tick for recovery');
    assert.equal(f.births[0].memory.replaces,f.births[1].memory.replaces);
}

{
    const f=renewalFixture({energy:100});f.api.spawnRoom(f.room);
    assert.equal(f.births.length,1);assert.equal(f.births[0].memory.role,'hauler');
    assert.equal(countCarry(f.births[0].parts),1,'missing-Hauler rescue remains immediate before any renewal deadline');
}

{
    const f=fixture(),control={plannedHarvest:20,usefulTarget:20,developmentBudget:20,target:10,buildEnergyTarget:0,routes:[]};
    const demand=workforce.workforceDemand(f.room,control,[]),requests=workforce.roomRequests(f.room,[],control,demand);
    const birth=requests.find(r=>r.role==='worker');
    assert(birth&&birth.memory.unitType==='worker'&&birth.memory.workRole==='upgrader','worker birth has a unified unit type and default work role');
}
{
    const f=fixture(),full=workforce.body('worker',f.room.energyCapacityAvailable);
    assert(full.length<=50);
    assert(full.reduce((n,p)=>n+C.BODYPART_COST[p],0)<=f.room.energyCapacityAvailable);
    assert.equal(workforce.body('worker',f.room.energyCapacityAvailable).filter(p=>p===C.WORK).length,
        development.workerBodyWork(f.room));
    const workers=[f.creep('a','upgrader',workerParts(5),900),f.creep('b','upgrader',workerParts(5),800),f.creep('c','upgrader',workerParts(7),700)];
    const control={plannedHarvest:20,usefulTarget:20,developmentBudget:20,target:10,buildEnergyTarget:0,routes:[]};
    const demand=workforce.workforceDemand(f.room,control,workers);
    assert.equal(demand.workerWorkTarget,20);
    assert.equal(demand.workerWork,3,'the final worker body is only the remaining WORK deficit');
    assert.equal(demand.workerBody.filter(p=>p===C.WORK).length,3);
}
{
    const f=fixture(),full=workforce.body('worker',f.room.energyCapacityAvailable);
    const workers=[
        f.creep('long-full','upgrader',full,1200),
        f.creep('short-full','upgrader',full,300),
        f.creep('partial-long','upgrader',workerParts(1),1490),
        f.creep('middle-full','upgrader',full,800),
    ];
    f.sites.push({id:'site',structureType:C.STRUCTURE_EXTENSION,pos:f.pos(12,12),progress:0,progressTotal:3000});
    const assignment=development.workerAssignment(f.room);
    assert.equal(assignment.builderCount,2);
    assert.equal(assignment.builders.map(c=>c.name).sort().join(','),['long-full','middle-full'].sort().join(','),
        'builder selection prefers normal bodies before longest TTL');
    assert(assignment.builders.every(c=>c.memory.role==='worker'&&c.memory.workRole==='builder'));
    assignment.builders[0].pos=f.pos(16,16);development.markBuilderTrajectory(assignment.builders[0]);
    assert(f.visual.polys.length>0&&f.visual.circles.length>0,'builder trajectory is marked visually');
    f.sites.length=0;ctx.Game.time++;
    const recovered=development.workerAssignment(f.room);
    assert.equal(recovered.builderCount,0);
    assert(Object.values(ctx.Game.creeps).every(c=>c.memory.role==='worker'&&c.memory.workRole==='upgrader'));
    assert(Object.values(ctx.Game.creeps).every(c=>!c.memory.builderTrail),'builder trail clears after role recovery');
}
{
    const f=fixture(),full=workforce.body('worker',f.room.energyCapacityAvailable);
    f.creep('worker-a','worker',full,900).memory.workRole='upgrader';
    f.creep('worker-b','worker',full,800).memory.workRole='upgrader';
    f.objects.push({id:'container',structureType:C.STRUCTURE_CONTAINER,my:true,pos:f.pos(10,11),hits:100,hitsMax:1000,ticksToDecay:20});
    const assignment=development.workerAssignment(f.room);
    assert.equal(assignment.repairmanCount,1);
    assert.equal(assignment.repairmen[0].memory.workRole,'repairman');
}
console.log('PASS worker pool: worker unit type, capacity-sized bodies, exact final WORK deficit, temporary half-builder/repairman role split, normal-body/TTL selection, state-independent trajectory marking and automatic role recovery');
console.log('PASS hauler renewals: stable standard financing queue, deadline-only affordable rescue, shared spawn budget, serial/parallel deadlines, future CARRY convergence, accepted/observed/released pending intents and missing-Hauler recovery');
