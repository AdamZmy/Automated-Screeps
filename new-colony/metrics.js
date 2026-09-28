'use strict';
// Published every 20 ticks so subsequent CPU investigations have attribution.
let cpuWindow=null;
function cpuNow(){return Game.cpu&&typeof Game.cpu.getUsed==='function'?Game.cpu.getUsed():null;}
function movementCount(name){if(cpuWindow)cpuWindow.movement[name]=(cpuWindow.movement[name]||0)+1;}
function cpuAdd(group,name,value){
    if(!cpuWindow||value===null)return;
    const bucket=cpuWindow[group],stat=bucket[name]||(bucket[name]={calls:0,total:0,max:0});
    stat.calls++;stat.total+=value;stat.max=Math.max(stat.max,value);
}
function measured(group,name,run){
    const start=cpuNow();
    try{return run();}finally{if(start!==null)cpuAdd(group,name,cpuNow()-start);}
}
function finishCpu(start){
    if(start===null)return;
    const end=cpuNow();cpuWindow.samples++;
    cpuAdd('totals','loop',end-start);cpuAdd('totals','entry',start);cpuAdd('totals','tick',end);
    if(Game.time%20!==0)return;
    const compact=group=>Object.fromEntries(Object.entries(cpuWindow[group]).map(([name,s])=>[name,{calls:s.calls,mean:+(s.total/s.calls).toFixed(4),perTick:+(s.total/cpuWindow.samples).toFixed(4),max:+s.max.toFixed(4)}]));
    const movement=Object.fromEntries(Object.entries(cpuWindow.movement).map(([name,total])=>[name,{total,perTick:+(total/cpuWindow.samples).toFixed(4)}]));
    const stats={from:cpuWindow.from,tick:Game.time,samples:cpuWindow.samples,mean:+(cpuWindow.totals.loop.total/cpuWindow.samples).toFixed(4),max:+cpuWindow.totals.loop.max.toFixed(4),totals:compact('totals'),stages:compact('stages'),roles:compact('roles'),rooms:compact('rooms'),movement};
    if(typeof RawMemory!=='undefined'&&typeof RawMemory.get==='function')stats.memoryBytes=RawMemory.get().length;
    const previous=Memory.frontier.performance;
    stats.history=previous&&Array.isArray(previous.history)?previous.history.slice(-59):[];
    stats.history.push({tick:Game.time,samples:stats.samples,mean:stats.mean,max:stats.max,memoryMean:stats.stages.memory&&stats.stages.memory.perTick||0,moves:cpuWindow.movement.moveCalls||0,targetSwitches:cpuWindow.movement.deliverySwitches||0,pathResets:cpuWindow.movement.pathResets||0});
    Memory.frontier.performance=stats;
    cpuWindow=null;
}

function startCpu(){
    const start=cpuNow();
    if(start!==null&&!cpuWindow)cpuWindow={from:Game.time,samples:0,totals:{},stages:{},roles:{},rooms:{},movement:{}};
    return start;
}
module.exports={startCpu,cpuNow,movementCount,cpuAdd,measured,finishCpu};
