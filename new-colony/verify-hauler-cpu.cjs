'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm');
const {constants:C,loadGameModule}=require('./test-support/runtime.cjs');
let used=0;
const ctx={...C,console,Game:{time:1,cpu:{getUsed:()=>used}},Memory:{frontier:{}},global:{}};
vm.createContext(ctx);const metrics=loadGameModule(ctx,'metrics');
for(let tick=1;tick<=20;tick++){
    ctx.Game.time=tick;used=0;const start=metrics.startCpu();
    const answer=metrics.measured('roles','hauler',()=>metrics.measured('logistics','delivery',()=>{
        used+=.1;
        metrics.measured('logistics','port',()=>{used+=.05;});
        metrics.measured('logistics','movement',()=>{used+=.2;});
        used+=.05;return 42;
    }));
    assert.equal(answer,42,'profiling preserves return values');
    metrics.finishCpu(start);
}
const stats=ctx.Memory.frontier.performance;
assert.equal(stats.samples,20);assert.equal(stats.mean,.4);assert.equal(stats.roles.hauler.perTick,.4);
assert.equal(stats.logistics.delivery.perTick,.15,'delivery reports only self time');
assert.equal(stats.logistics.port.perTick,.05);assert.equal(stats.logistics.movement.perTick,.2);
assert.equal(Object.values(stats.logistics).reduce((n,s)=>n+s.perTick,0),stats.roles.hauler.perTick,'nested breakdown does not double-count child scopes');
assert.equal(stats.logisticsTiming,'self');
ctx.Memory.frontier.performance.history=Array.from({length:60},(_,tick)=>({tick}));
ctx.Game.time=40;used=0;const start=metrics.startCpu();
assert.throws(()=>metrics.measured('logistics','delivery',()=>metrics.measured('logistics','port',()=>{used+=.3;throw Error('probe');})),/probe/);
metrics.measured('logistics','movement',()=>{used+=.2;});metrics.finishCpu(start);
assert.equal(ctx.Memory.frontier.performance.logistics.port.perTick,.3,'failed work is still timed');
assert.equal(ctx.Memory.frontier.performance.logistics.delivery.perTick,0,'exception restores parent scope');
assert.equal(ctx.Memory.frontier.performance.logistics.movement.perTick,.2);
assert.equal(ctx.Memory.frontier.performance.history.length,60);
ctx.Game.cpu={};assert.equal(metrics.startCpu(),null);assert.equal(metrics.measured('logistics','movement',()=>7),7);
console.log('PASS Hauler CPU: 20-tick windows, nested self-time conservation, unchanged role totals, exception/return preservation, bounded history and absent-CPU fixtures');
