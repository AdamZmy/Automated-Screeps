'use strict';
// Frontier24 composition root. Gameplay policy lives in focused modules.
const VERSION='2026-09-27.5';
const runtime=require('runtime');
const development=require('development');
const logistics=require('logistics');
const workforce=require('workforce');
const infrastructure=require('infrastructure');
const metrics=require('metrics');
const {vals,energy,go,allCreeps}=runtime;
const {work,refuel,upgrade,mine,developmentPlan,finishDevelopment}=development;
const {haul}=logistics;
const {spawnRoom}=workforce;
const {defend,links}=infrastructure;
const {startCpu,cpuNow,cpuAdd,measured,finishCpu}=metrics;
module.exports.test={VERSION,...runtime,...development,...logistics,...workforce,...infrastructure};
module.exports.loop=function(){
    const cpuStart=startCpu();
    Memory.frontier=Memory.frontier||{rooms:{},intel:{},version:VERSION};
    Memory.creeps=Memory.creeps||{};
    for(const name in Memory.creeps)if(!Game.creeps[name])delete Memory.creeps[name];
    if(cpuStart!==null)cpuAdd('stages','memory',cpuNow()-cpuStart);
    let planner,expansion,monitor;
    const moduleStart=cpuNow();
    try{planner=require('planner');}catch(e){if(Game.time%100===0)console.log('[Frontier planner load] '+e);}
    try{expansion=require('expansion');global.frontierExpansion=expansion;}catch(e){if(Game.time%100===0)console.log('[Frontier expansion load] '+e);}
    try{monitor=require('monitor');}catch(e){if(Game.time%100===0)console.log('[Frontier monitor load] '+e);}
    if(moduleStart!==null)cpuAdd('stages','modules',cpuNow()-moduleStart);
    const owned=vals(Game.rooms).filter(r=>r.controller&&r.controller.my);
    for(const room of owned){
        for(const [name,run] of [['defense',defend],['links',links],['spawn',spawnRoom]])if(run){try{measured('stages',name,()=>run(room));}catch(e){console.log('[Frontier '+name+' '+room.name+'] '+e.stack);}}
        const roomMemory=Memory.frontier.rooms&&Memory.frontier.rooms[room.name];
        const plannerDue=!roomMemory||!roomMemory.plan||!roomMemory.plan.complete||Game.time%10===0;
        if(planner&&planner.run&&plannerDue)try{measured('stages','planner',()=>planner.run(room));}catch(e){console.log('[Frontier planner '+room.name+'] '+e.stack);}
    }
    for(const room of owned)try{measured('stages','development',()=>developmentPlan(room));}catch(e){console.log('[Frontier development '+room.name+'] '+e.stack);}
    for(const c of allCreeps()){if(c.spawning)continue;try{measured('roles',c.memory.role||'unknown',()=>{if(c.memory.role==='miner')mine(c);else if(c.memory.role==='hauler')haul(c);else if(['scout','claimer','pioneer'].includes(c.memory.role)&&expansion)expansion.run(c,{go,work,refuel,upgrade});else work(c);});}catch(e){console.log('[Frontier creep '+c.name+'] '+e.stack);}}
    for(const room of owned)try{measured('stages','development',()=>finishDevelopment(room));}catch(e){console.log('[Frontier development '+room.name+'] '+e.stack);}
    if(expansion)try{measured('stages','strategy',()=>expansion.tick(owned));}catch(e){console.log('[Frontier expansion] '+e.stack);}
    if(monitor)try{measured('stages','monitor',()=>monitor.tick(owned));}catch(e){console.log('[Frontier monitor] '+e.stack);}
    if(Game.time%20===0){const last=Memory.frontier.status;Memory.frontier.status={tick:Game.time,version:VERSION,gcl:Game.gcl,cpu:Game.cpu.getUsed(),bucket:Game.cpu.bucket,rooms:owned.map(r=>{const p=last&&last.rooms.find(p=>p.name===r.name);return{name:r.name,rcl:r.controller.level,progress:r.controller.progress,total:r.controller.progressTotal,upgradePerTick:p&&p.rcl===r.controller.level?(r.controller.progress-p.progress)/(Game.time-last.tick):0,energy:r.energyAvailable,capacity:r.energyCapacityAvailable,creeps:allCreeps().filter(c=>c.memory.home===r.name).length,storage:r.storage?energy(r.storage):0};})};}
    if(!Game.cpu||Game.cpu.bucket>500)for(const r of owned)r.visual.text('Frontier | RCL '+r.controller.level+' | '+Math.round((r.controller.progress||0)/(r.controller.progressTotal||1)*100)+'% | '+allCreeps().filter(c=>c.room.name===r.name).length+' creeps',25,1,{font:.6,color:'#a8efbd'});
    finishCpu(cpuStart);
};
