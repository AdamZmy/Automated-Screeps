'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(__dirname+'/hauler-policy.js','utf8');
function policy(weight){
    const c={id:'scope-test',room:'W21N26',stage:'trial',revision:'test',variant:'batch-preference',batchWeight:weight,window:1500,warmup:300};
    const ctx={module:{exports:{}}};vm.createContext(ctx);
    vm.runInContext(source.replace(/Object.freeze\(\{[^\n]+\}\)/,'Object.freeze('+JSON.stringify(c)+')'),ctx);return ctx.module.exports;
}
const trial=policy(2),room={name:'W21N26'};
for(const priority of [0,1,2])assert.equal(trial.routeScore(room,priority,25,100,1),1,'urgent ranking stays identical');
assert.equal(trial.routeScore({name:'W23N26'},4,25,100,1),1,'other room remains incumbent');
assert.equal(trial.routeScore(room,4,100,100,2),2);
assert(trial.routeScore(room,4,25,100,1)>trial.routeScore(room,4,100,100,2),'nonurgent fuller feasible route can outrank initially cheaper small trip');
assert.equal(policy(0).routeScore(room,4,25,100,1),1,'zero weight preserves all incumbent scores');
assert(Number.isFinite(trial.routeScore(room,4,25,100,1)),'a partial route remains feasible; no mandatory waiting');
console.log('PASS evolution policy: urgent priorities, other room, baseline equivalence, smooth useful-load ranking and partial-route feasibility');
