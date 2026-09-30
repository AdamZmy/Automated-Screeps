'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {constants:C,readSource,enginePath}=require('./test-support/runtime.cjs');
function fixture(options={}){
    const config={id:'test',room:'W21N26',stage:'baseline',variant:'control',revision:'r1',window:3,warmup:2,...options};
    const ctx={...C,Memory:{frontier:{rooms:{W21N26:{}}}},Game:{time:100,creeps:{},cpu:{bucket:9000}},module:{exports:{}}};
    const room={name:config.room,controller:{my:true,level:5},events:[],getEventLog(){if(this.events===null)throw Error('unavailable');return this.events;}};
    const context={room,creepsByPosition:[],creepsByHome:[],structuresByType:{},sources:[{},{}],sites:[],threats:[]};
    const runtime={roomContext:()=>context,energy:c=>c.store.energy};
    ctx.require=name=>name==='runtime'?runtime:name==='hauler-policy'?{config}:assert.fail('unexpected module '+name);
    vm.createContext(ctx);
    function reset(){ctx.module={exports:{}};vm.runInContext('(function(){'+readSource('evolution.js')+'\n})()',ctx);return ctx.module.exports;}
    function creep(id='h',energy=100,parts=[C.CARRY,C.CARRY,C.MOVE]){
        const c={id,name:id,my:true,memory:{role:'hauler',home:room.name,haul:{state:'deliver'}},body:parts.map(type=>({type,hits:100})),
            store:{energy,getCapacity:()=>parts.filter(p=>p===C.CARRY).length*C.CARRY_CAPACITY},pos:{x:20,y:20,roomName:room.name},fatigue:0};
        context.creepsByHome.push(c);context.creepsByPosition.push(c);ctx.Game.creeps[id]=c;return c;
    }
    let api=reset();const h=creep();
    const memory=()=>ctx.Memory.frontier.rooms[room.name];
    function begin(events=[]){room.events=events;return api.begin([room]);}
    function finish(cpu=2,queue=[]){memory().workforce={tick:ctx.Game.time,queued:queue};return api.finish(cpu);}
    function next(events=[],cpu=2,queue=[]){ctx.Game.time++;const result=begin(events);finish(cpu,queue);return result;}
    function move(c=h){c.memory.moveAttempt=ctx.Game.time;c.memory.movement={at:ctx.Game.time,state:'submitted'};}
    const transfer=(id,amount,resourceType=C.RESOURCE_ENERGY)=>({event:C.EVENT_TRANSFER,objectId:id,data:{resourceType,amount,targetId:'sink'}});
    return {ctx,config,room,context,h,creep,memory,begin,finish,next,move,transfer,reset(){api=reset();return api;},get api(){return api;}};
}
// Feed the pinned official processor's result into consecutive collector ticks:
// a full target emits no transfer event; a clipped target emits only actual27.
{
    const processor={exports:{}},lodash=require(require.resolve('lodash',{paths:[enginePath]}));
    vm.runInNewContext(fs.readFileSync(enginePath+'/src/processor/intents/creeps/transfer.js','utf8'),{
        module:processor,require(name){if(name==='lodash')return lodash;if(name==='../../../utils')return{
            getDriver:()=>({constants:C}),capacityForResource:o=>o.storeCapacity,
            calcResources:o=>Object.values(o.store||{}).reduce((n,v)=>n+v,0)};throw Error(name);}});
    const f=fixture({window:2}),actor={_id:'h',type:'creep',x:20,y:20,store:{energy:100}},target={_id:'sink',type:'container',x:20,y:21,store:{energy:100},storeCapacity:100};
    function settle(){const events=[];processor.exports(actor,{id:'sink',resourceType:C.RESOURCE_ENERGY,amount:100},{roomObjects:{h:actor,sink:target},bulk:{update(){}},eventLog:events});return events;}
    f.begin();f.finish();let events=settle();assert.equal(events.length,0);let r=f.next(events);assert.equal(r.delivered,0);
    target.store.energy=73;events=settle();assert.equal(events[0].data.amount,27);r=f.next(events);assert.equal(r.delivered,27);assert.equal(r.complete,true);
}
// Accepted but failed intents have no event; partial engine transfer is actual
// delivered cargo, and withdrawal events (stock actors) are never delivery.
{
    const f=fixture();f.begin();f.h.memory.haul.task={intent:{kind:'deliver',at:100,amount:100}};f.finish();
    let r=f.next([]);assert.equal(r.delivered,0);
    r=f.next([f.transfer('h',27),f.transfer('source-container',100),f.transfer('h',10,'H')]);
    assert.equal(r.delivered,27);assert.equal(r.deliveryEvents,1);assert.equal(r.metrics,null);
    r=f.next();assert.equal(r.complete,true);assert.equal(r.ticks,3);assert.equal(r.haulerTicks,3);assert.equal(r.roomCpu,6);
    assert.equal(r.metrics.deliveredPerHaulerTick,9);assert.equal(r.bucketStart,9000);assert.equal(r.bucketEnd,9000);
    assert(!('_previous' in r));
}
// Last actions are attributed by the prior actor map, including natural death.
// Newly born actors cannot retroactively receive attribution for the prior tick.
{
    const f=fixture({window:1});f.begin();f.finish();
    f.context.creepsByHome=[];f.context.creepsByPosition=[];delete f.ctx.Game.creeps.h;
    f.creep('replacement');
    const r=f.next([f.transfer('h',37),f.transfer('replacement',90)]);
    assert.equal(r.delivered,37);assert.equal(r.complete,true,'same-capacity replacement preserves comparable scope');
}
{
    const f=fixture();f.begin();f.finish();let r=f.next(null);
    assert.equal(r.ticks,0);assert.equal(r.delivered,0);assert.equal(r.roomCpu,0);assert.equal(r.metrics,null);
    assert(r.invalidReasons.includes('event-log-unavailable'));
    r=f.next();r=f.next();assert.equal(r.frozen,true);assert.equal(r.complete,false);assert.equal(r.observedTicks,2);assert.equal(r.coverage,2/3);
}
{
    const f=fixture();f.begin();f.finish();f.ctx.Game.time+=2;
    let r=f.begin([f.transfer('h',90)]);f.finish();assert.equal(r.delivered,0);assert(r.invalidReasons.includes('observation-gap'));
    r=f.next();assert.equal(r.frozen,true);assert.equal(r.complete,false);assert.equal(r.ticks,1);
}
// A global code reset preserves totals but invalidates the single sample.
{
    const f=fixture();f.begin();f.finish();f.reset();const r=f.next();assert(r.invalidReasons.includes('global-reset'));assert.equal(r.ticks,1);
}
// Exact full windows, including trial warmup and natural warmup-only changes.
{
    const f=fixture({stage:'trial',window:1500,warmup:300});f.begin();f.finish();
    for(let i=1;i<=300;i++){if(i===20)f.h.body.push({type:C.CARRY,hits:100});f.next([f.transfer('h',99)]);}
    let r=f.api.snapshot();assert.equal(r.ticks,0);assert.equal(r.delivered,0);assert.equal(r.signature.rcl,5);assert.equal(r.invalidReasons.length,0);
    for(let i=1;i<1500;i++)r=f.next([f.transfer('h',1)]);
    assert.equal(r.ticks,1499);assert.equal(r.complete,false);
    r=f.next([f.transfer('h',1)]);assert.equal(r.ticks,1500);assert.equal(r.delivered,1500);assert.equal(r.complete,true);
    assert.equal(r.fromTick,400);assert.equal(r.endTick,1900);assert.equal(r.cpuTicks,1500);assert.equal(r.coverage,1);
    const saved={...JSON.parse(JSON.stringify(r)),tick:0};const memorySize=JSON.stringify(f.ctx.Memory.frontier.evolution).length;
    for(let i=0;i<2000;i++){f.context.threats=[{}];f.h.body.push({type:C.WORK,hits:100});r=f.next([f.transfer('h',100)]);}
    assert.deepEqual({...JSON.parse(JSON.stringify(r)),tick:0},saved,'completed sample freezes independently of subsequent colony changes');
    assert.equal(JSON.stringify(f.ctx.Memory.frontier.evolution).length,memorySize);assert.equal(r.tick,f.ctx.Game.time);
}
// Movement outcomes are matched across ticks, excluding fatigue and legal rest.
{
    const f=fixture({window:1});const tired=f.creep('tired',50),idle=f.creep('idle',0),waiting=f.creep('waiting',0);
    tired.fatigue=2;idle.memory.haul.state='idle';waiting.memory.haul.state='pickup';f.begin();f.move();f.move(tired);
    idle.memory.movement={at:f.ctx.Game.time,state:'in-range'};f.finish();const r=f.next();
    assert.equal(r.haulerTicks,4);assert.equal(r.travelTicks,1);assert.equal(r.payloadSum,1);assert.equal(r.blocked,1);assert.equal(r.idle,1);assert.equal(r.waitingPickup,1);
}
{
    const f=fixture({window:1});f.h.store.energy=25;f.begin();f.move();f.finish();f.h.pos.x++;
    const r=f.next();assert.equal(r.travelTicks,1);assert.equal(r.payloadSum,.25);assert.equal(r.blocked,0);
}
// State, workforce queue and room CPU all describe the same prior interval.
{
    const f=fixture({window:1});f.begin();f.finish(3.5,[{role:'worker',reason:'insufficient-energy'}]);
    const r=f.next();assert.equal(r.spawnDemandTicks,1);assert.equal(r.spawnStarvedTicks,1);assert.equal(r.roomCpu,3.5);
}
{
    const f=fixture({window:1});f.begin();f.finish(null,[{reason:'insufficient-energy'}]);const r=f.next([f.transfer('h',50)]);
    assert.equal(r.complete,false);assert.equal(r.delivered,0);assert.equal(r.ticks,0);assert.equal(r.metrics,null);assert(r.invalidReasons.includes('room-cpu-unavailable'));
}
{
    const f=fixture({window:1});f.begin();f.api.finish(2);const r=f.next([f.transfer('h',50)]);
    assert.equal(r.ticks,0);assert(r.invalidReasons.includes('spawn-demand-unavailable'));assert.equal(r.metrics,null);
}
for(const reason of ['hostile-threat','cpu-recovery']){
    const f=fixture({window:1});f.begin();
    if(reason==='hostile-threat')f.context.threats.push({});else f.memory().economyControl={cpuMode:'recovery'};
    f.finish();const r=f.next();assert.equal(r.complete,false);assert(r.invalidReasons.includes(reason));
}
{
    const f=fixture({window:1});for(let i=0;i<70;i++)f.creep('extra'+i);f.begin();f.finish();
    assert.equal(Object.keys(f.ctx.Memory.frontier.evolution._previous.haulers).length,64);
    const r=f.next();assert.equal(r.complete,false);assert.equal(r.ticks,0);assert(r.invalidReasons.includes('hauler-observation-limit'));
}
// Error counts are deltas, never the repeated historical module-health total.
{
    const f=fixture();f.ctx.Memory.frontier.modules={old:{status:'error',tick:99,count:7}};f.begin();f.finish();
    assert.equal(f.api.snapshot().errors,0);f.ctx.Game.time++;f.begin();
    f.ctx.Memory.frontier.modules.old={status:'error',tick:101,count:8};f.finish();assert.equal(f.api.snapshot().errors,1);
    f.next();assert.equal(f.api.snapshot().errors,1);assert(f.api.snapshot().invalidReasons.includes('runtime-error'));
}
for(const mutation of [f=>f.room.controller.level++,f=>f.context.sites.push({}),f=>f.memory().economy={carryTarget:20},f=>f.room.energyCapacityAvailable=1800]){
    const f=fixture({window:1});f.begin();f.finish();mutation(f);const r=f.next();assert.equal(r.complete,false);assert(r.invalidReasons.includes('context-changed'));
}
{
    const f=fixture();f.begin();f.finish();f.creep('natural-overlap');let r=f.next();
    const worker=f.creep('worker',0,[C.WORK,C.WORK,C.CARRY,C.MOVE]);worker.memory.role='worker';worker.memory.workRole='builder';
    const miner=f.creep('miner',0,[C.WORK,C.WORK,C.WORK,C.MOVE]);miner.memory.role='miner';
    r=f.next();worker.memory.workRole='upgrader';r=f.next();
    assert.equal(r.complete,true,'ordinary overlap and worker duty changes do not invalidate the stable planned scope');
    assert.equal(r.carryTicks,10);assert.equal(r.workerWorkTicks,2);assert.equal(r.minerWorkTicks,3);
    assert.equal(r.haulerCountMin,1);assert.equal(r.haulerCountMax,2);
}
{
    const f=fixture();f.begin();f.finish();const r=f.begin();assert.equal(r.ticks,0,'duplicate begin never adds another observation');
    f.config.revision='r2';f.next();assert.equal(f.api.snapshot().revision,'r2');assert.equal(f.api.snapshot().ticks,0);
    f.config.stage='retained';const retained=f.next();assert.equal(retained.stage,'retained');assert.equal(retained.ticks,0);assert.equal(retained.complete,false);assert.equal(retained.metrics,null);
}
console.log('evolution checks passed');
