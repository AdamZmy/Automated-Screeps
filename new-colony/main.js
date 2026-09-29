'use strict';
// Frontier composition root. Each action has exactly one business owner.
const VERSION='2026-09-29.3';
const runtime=require('runtime'),metrics=require('metrics');
const colony=require('colony'),mining=require('mining'),development=require('development');
const logistics=require('logistics'),workforce=require('workforce');
const defense=require('defense'),links=require('links');
const {vals,energy,go,allCreeps}=runtime;
const {startCpu,cpuNow,cpuAdd,measured,finishCpu}=metrics;
module.exports.test={VERSION,...runtime,...colony,...mining,...development,...logistics,...workforce,...defense,...links};
let constructionState={};
function guarded(name,room,run,subject=null){
    const key=name+(room?':'+room.name:''),root=Memory.frontier;
    const health=root.modules||(root.modules={});
    try{
        const result=measured('stages',name,()=>room?measured('rooms',room.name,run):run());
        const old=health[key];
        if(!(old&&old.status==='error'&&old.tick===Game.time)&&(Game.time%20===0||old&&old.status==='error'))health[key]={status:'ok',tick:Game.time,recoveredAt:old&&old.status==='error'?Game.time:old&&old.recoveredAt||null};
        return result;
    }catch(e){
        const old=health[key];
        health[key]={status:'error',tick:Game.time,since:old&&old.status==='error'?old.since:Game.time,count:(old&&old.count||0)+1,subject,error:String(e&&e.stack||e).slice(0,400)};
        if(!old||old.status!=='error'||Game.time%100===0)console.log('[Frontier '+key+'] '+e.stack);
        return undefined;
    }
}
module.exports.loop=function(){
    const start=startCpu();
    Memory.frontier=Memory.frontier||{};
    const root=Memory.frontier;root.rooms=root.rooms||{};root.intel=root.intel||{};root.version=VERSION;
    Memory.creeps=Memory.creeps||{};
    if(start!==null)cpuAdd('stages','memory',cpuNow()-start);
    const owned=vals(Game.rooms).filter(r=>r.controller&&r.controller.my);
    // Previous-tick facts are settled independently of summaries or policy.
    guarded('ledger',null,()=>require('ledger').observe(owned));
    for(const name in Memory.creeps)if(!Game.creeps[name])delete Memory.creeps[name];
    guarded('context',null,()=>runtime.contexts(owned));
    // All-room safety precedes every room's optional work.
    for(const room of owned)guarded('defense',room,()=>defense.defend(room));
    guarded('safeMode',null,()=>defense.arbitrateSafeMode(owned));
    const expansion=guarded('missionsLoad',null,()=>require('expansion'));
    if(expansion)guarded('strategy',null,()=>expansion.tick(owned,{optional:false}));
    for(const room of owned){
        guarded('colony',room,()=>colony.updateEconomy(room));
        guarded('development',room,()=>development.developmentPlan(room));
        guarded('spawn',room,()=>workforce.spawnRoom(room,expansion?expansion.spawnRequests(room):[]));
        guarded('links',room,()=>links.links(room));
        guarded('logistics',room,()=>logistics.prepare(room));
    }
    const creeps=allCreeps().slice().sort((a,b)=>(b.memory.role==='hauler'&&energy(b)>0?1:0)-(a.memory.role==='hauler'&&energy(a)>0?1:0));
    for(const c of creeps){
        if(c.spawning)continue;
        const metricRole=c.memory.role==='worker'?c.memory.workRole||'worker':c.memory.role||'unknown';
        guarded('creeps',c.room,()=>measured('roles',metricRole,()=>{
            if(defense.evacuate(c))return;
            if(c.memory.role==='miner')mining.mine(c);
            else if(c.memory.role==='hauler')logistics.haul(c);
            else if(['scout','claimer','pioneer'].includes(c.memory.role)&&expansion)expansion.run(c,{go,work:development.work,refuel:development.refuel,upgrade:development.upgrade});
            else development.work(c);
        }),c.name);
    }
    for(const room of owned)guarded('development',room,()=>development.finishDevelopment(room));
    if(expansion&&expansion.plan)guarded('missionPlanning',null,()=>expansion.plan(owned));
    // Movement is submitted during role execution. Optional planning cannot
    // consume the budget before the colony has made its critical intents.
    for(const room of owned){
        const context=runtime.roomContext(room),plan=root.rooms[room.name]&&root.rooms[room.name].plan;
        const signature=[room.controller.level,context.sites.length,Object.values(context.structuresByType).reduce((n,a)=>n+a.length,0)].join(':');
        const due=constructionState[room.name]!==signature||Game.time%10===0||!plan;
        if(due)guarded('planner',room,()=>{
            const planner=require('planner'),scheduled=planner.run(room);
            const candidates=Game.time%10===0?scheduled:planner.constructionRequests(room);
            development.runConstruction(room,[...(candidates||[]),...mining.constructionRequests(room),...(expansion?expansion.constructionRequests(room):[])]);
            constructionState[room.name]=signature;
        });
    }
    for(const name of Object.keys(constructionState))if(!owned.some(r=>r.name===name))delete constructionState[name];
    guarded('monitor',null,()=>require('monitor').tick(owned));
    if(Game.time%20===0){
        const previous=root.status;root.status={tick:Game.time,version:VERSION,gcl:Game.gcl,cpu:Game.cpu.getUsed(),bucket:Game.cpu.bucket,rooms:owned.map(r=>{
            const p=previous&&previous.rooms.find(p=>p.name===r.name);
            return{name:r.name,rcl:r.controller.level,progress:r.controller.progress,total:r.controller.progressTotal,
                upgradePerTick:p&&p.rcl===r.controller.level?(r.controller.progress-p.progress)/(Game.time-previous.tick):0,
                energy:r.energyAvailable,capacity:r.energyCapacityAvailable,creeps:runtime.roomContext(r).creepsByHome.length,storage:r.storage?energy(r.storage):0};})};
    }
    if(!Game.cpu||Game.cpu.bucket>500)for(const r of owned)r.visual.text('Frontier | RCL '+r.controller.level+' | '+Math.round((r.controller.progress||0)/(r.controller.progressTotal||1)*100)+'% | '+runtime.roomContext(r).creepsByPosition.length+' creeps',25,1,{font:.6,color:'#a8efbd'});
    finishCpu(start);
};
