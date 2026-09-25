const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const engine='/Users/zmy/Library/Application Support/Steam/steamapps/common/Screeps/server/package/node_modules/@screeps/engine';
const C=require(engine+'/../common/lib/constants');
function fixture(){
    const ctx={...C,module:{exports:{}},Memory:{frontier:{rooms:{R:{plan:{structures:[{type:C.STRUCTURE_ROAD,x:25,y:25}]}}}}},Game:{time:100,creeps:{}}};
    vm.createContext(ctx);vm.runInContext(fs.readFileSync('ledger.js','utf8'),ctx);
    const pos=(x=20,y=20,roomName='R')=>({x,y,roomName});
    const unit=(id,energy=100,parts=[C.WORK,C.CARRY,C.MOVE])=>({id,name:id,my:true,pos:pos(),store:{energy},spawning:false,memory:{home:'R',role:'worker'},body:parts.map(type=>({type,hits:100}))});
    const builder=unit('builder'),miner=unit('miner');ctx.Game.creeps={builder,miner};
    const bank={id:'bank',structureType:C.STRUCTURE_CONTAINER,pos:pos(),store:{energy:10000}};
    const spawn={id:'spawn',my:true,structureType:C.STRUCTURE_SPAWN,pos:pos(21,20),store:{energy:300}};
    const site={id:'site',structureType:C.STRUCTURE_ROAD,pos:pos(25,25),progress:0,progressTotal:300};
    const data={structures:[bank,spawn],sources:[{id:'source1',energy:3000,energyCapacity:3000,pos:pos(10,10)},{id:'source2',energy:3000,energyCapacity:3000,pos:pos(40,40)}],sites:[site],drops:[],tombstones:[],ruins:[]};
    let events=[];
    const room={name:'R',find(type){return type===C.FIND_STRUCTURES?data.structures:type===C.FIND_SOURCES?data.sources:type===C.FIND_MY_CONSTRUCTION_SITES?data.sites:type===C.FIND_DROPPED_RESOURCES?data.drops:type===C.FIND_TOMBSTONES?data.tombstones:type===C.FIND_RUINS?data.ruins:[];},getEventLog(){if(events===null)throw Error('missing');return events;}};
    function observe(list=events,time=ctx.Game.time){events=list;ctx.Game.time=time;ctx.module.exports.observe([room]);return ctx.Memory.frontier.energy.rooms.R;}
    function next(list=[]){return observe(list,ctx.Game.time+1);}
    const event=(event,objectId,data={})=>({event,objectId,data});
    return {ctx,room,data,bank,spawn,site,builder,miner,pos,unit,observe,next,event};
}
{
    const f=fixture();let r=f.observe();assert.equal(r.latest.harvest,null);assert.equal(r.windows[300].G,null);
    const initial=r.inventory.total;
    f.bank.store.energy+=20-2-5;
    r=f.next([f.event(C.EVENT_HARVEST,'miner',{targetId:'source1',amount:20}),f.event(C.EVENT_UPGRADE_CONTROLLER,'builder',{amount:4,energySpent:2}),f.event(C.EVENT_BUILD,'builder',{targetId:'site',amount:5,structureType:C.STRUCTURE_ROAD,incomplete:true})]);
    assert.equal(r.latest.harvest,20);assert.equal(r.latest.upgrade,2,'boosted controller progress is not energy spent');
    assert.equal(r.latest.buildUseful,5,'five normal build progress costs five energy, not one');
    assert.equal(r.latest.stockDelta,13);assert.equal(r.latest.residual,0);assert.equal(r.inventory.total,initial+13);assert.equal(r.latest.knownExpense,7);
    assert.equal(r.latest.potential,20,'two source capacity/regen rates do not depend on body WORK');
    assert.equal(r.latest.balanceComplete,true);
    r=f.next([f.event(C.EVENT_HARVEST,'miner',{targetId:'mineral1',amount:30})]);assert.equal(r.latest.harvest,0,'mineral harvest is not energy revenue');
    const oldTick=r.tick;r=f.observe([],oldTick);assert.equal(r.tick,oldTick,'duplicate observe does not add another tick');
}
{
    const f=fixture();f.site.progress=297;f.observe();f.data.sites=[];f.bank.store.energy-=3;
    let r=f.next([f.event(C.EVENT_BUILD,'builder',{targetId:'site',amount:3,incomplete:false})]);
    assert.equal(r.latest.buildUseful,3,'finished site classification comes from prior site/plan');assert.equal(r.latest.residual,0);
    f.data.sites=[{...f.site,id:'other',pos:f.pos(26,25),progress:0}];f.next();f.bank.store.energy-=5;
    r=f.next([f.event(C.EVENT_BUILD,'builder',{targetId:'other',amount:5,incomplete:true})]);
    assert.equal(r.latest.buildUseful,0);assert.equal(r.latest.buildOther,5);assert.equal(r.latest.operatingCost,5);
    assert.equal(r.latest.usedEnergy,0,'unplanned construction does not inflate useful total use');
}
{
    const f=fixture();f.observe();
    const placeholder=f.unit('accepted-only',0);delete placeholder.id;placeholder.spawning=true;f.ctx.Game.creeps.placeholder=placeholder;
    let r=f.next();assert.equal(r.latest.spawn,0,'ID-less spawn intent is not observed spending');
    const born=f.unit('born',0);born.spawning=true;f.ctx.Game.creeps.born=born;f.bank.store.energy-=200;
    r=f.next();assert.equal(r.latest.spawn,200);assert.equal(r.latest.residual,0);
    r=f.next();assert.equal(r.latest.spawn,0,'spawn body cost is charged once on observed creation');
    born.spawning=false;r=f.next();assert.equal(r.latest.spawn,0,'emerging from spawn is not a second purchase');
}
{
    const f=fixture();f.builder.store.energy=10;f.observe();
    delete f.ctx.Game.creeps.builder;
    f.data.tombstones=[{id:'tomb',pos:f.pos(),store:{energy:7}}];
    let r=f.next([f.event(C.EVENT_UPGRADE_CONTROLLER,'builder',{amount:3,energySpent:3}),f.event(C.EVENT_OBJECT_DESTROYED,'builder',{type:'creep'})]);
    assert.equal(r.latest.upgrade,3,'previous actor map attributes action by creep that died');
    assert.equal(r.latest.exports,0);assert.equal(r.latest.residual,0,'death inventory moved to tombstone remains in room inventory');
    assert.equal(r.inventory.tombstones,7);
    f.bank.store.energy+=7;f.data.tombstones=[];r=f.next();assert.equal(r.latest.stockDelta,0,'salvaging counted tombstone stock is internal circulation');
}
{
    const f=fixture();f.data.drops=[{id:'drop',resourceType:C.RESOURCE_ENERGY,amount:20,pos:f.pos()},{id:'mineraldrop',resourceType:'H',amount:200,pos:f.pos()}];
    f.data.ruins=[{id:'ruin',store:{energy:40},pos:f.pos()}];
    f.data.structures.push(f.bank,{id:'enemy',my:false,owner:{username:'other'},structureType:C.STRUCTURE_STORAGE,pos:f.pos(),store:{energy:99999}});
    let r=f.observe();assert.equal(r.inventory.structures,10300,'room pool/storage aliases and duplicate objects do not double count stores');assert.equal(r.inventory.total,10560);
    f.data.drops[0].amount-=1;r=f.next();assert.equal(r.latest.residual,1,'natural decay remains unclassified residual, not measured operating expense');assert.equal(r.latest.operatingCost,0);
}
// Official withdraw events identify the source stock as actor, not the creep.
// Salvaging a tombstone/ruin is already internal inventory and must not erase G.
{
    const mod={exports:{}},lodash=require(require.resolve('lodash',{paths:[engine]}));
    const sandbox={module:mod,require(name){if(name==='lodash')return lodash;if(name==='../../../utils')return{getDriver:()=>({constants:C}),calcResources:o=>Object.values(o.store||{}).reduce((n,v)=>n+v,0)};throw Error(name);}};
    vm.runInNewContext(fs.readFileSync(engine+'/src/processor/intents/creeps/withdraw.js','utf8'),sandbox);
    for(const kind of ['tombstone','ruin']){
        const f=fixture();f.builder.store.energy=0;
        const stock={id:'salvage',pos:f.pos(),store:{energy:40}};
        f.data[kind==='tombstone'?'tombstones':'ruins']=[stock];f.observe();
        const object={_id:'builder',type:'creep',user:'me',x:20,y:20,store:{energy:0},storeCapacity:100};
        const target={_id:'salvage',type:kind,x:20,y:20,store:{energy:40}},events=[];
        mod.exports(object,{id:'salvage',resourceType:C.RESOURCE_ENERGY,amount:30},{roomObjects:{salvage:target,builder:object},bulk:{update(){}},roomController:{user:'me'},gameTime:100,eventLog:events});
        assert.equal(events[0].objectId,'salvage');assert.equal(events[0].data.targetId,'builder');
        f.builder.store.energy=object.store.energy;stock.store.energy=target.store.energy;
        f.bank.store.energy+=18;
        const r=f.next(events.concat([f.event(C.EVENT_HARVEST,'miner',{targetId:'source1',amount:20}),f.event(C.EVENT_UPGRADE_CONTROLLER,'builder',{energySpent:2})]));
        assert.equal(r.latest.harvest,20);assert.equal(r.latest.upgrade,2);
        assert.equal(r.latest.metricComplete,true,kind+' withdrawal preserves productive observation');
        assert.equal(r.latest.accountingComplete,true);assert.equal(r.latest.residual,0);assert.equal(r.latest.complete,true);
    }
}
{
    const f=fixture();f.observe();f.bank.store.energy+=18;
    let r=f.next([f.event(C.EVENT_TRANSFER,'unrecognized-stock',{targetId:'builder',resourceType:C.RESOURCE_ENERGY,amount:7}),f.event(C.EVENT_HARVEST,'miner',{targetId:'source1',amount:20}),f.event(C.EVENT_UPGRADE_CONTROLLER,'builder',{energySpent:2})]);
    assert.equal(r.latest.metricComplete,true,'unknown transfer attribution cannot erase known harvest/upgrade');
    assert.equal(r.latest.scopeComplete,true,'financial attribution is distinct from physical scope');
    assert.equal(r.latest.accountingComplete,false,'unresolved financial actor still blocks automatic efficiency judgments');
    assert(r.latest.reasons.includes('unresolved-financial-actor'));
    r=f.next([f.event(C.EVENT_TRANSFER,'unrecognized-stock',{targetId:'builder',resourceType:C.RESOURCE_ENERGY,amount:7})]);
    assert.equal(r.recentReasons.at(-1).count,2,'consecutive equal reasons coalesce');
    for(let i=0;i<20;i++){f.next([]);r=f.next([f.event(C.EVENT_TRANSFER,'unrecognized-stock',{targetId:'builder',resourceType:C.RESOURCE_ENERGY,amount:7})]);}
    assert.equal(r.recentReasons.length,12,'diagnostic evidence stays bounded');
}
{
    const f=fixture();f.observe();f.ctx.Game.time+=8;let r=f.next();assert.equal(r.latest.harvest,null);assert(r.latest.reasons.includes('observation-gap'));
    r=f.next(null);assert.equal(r.latest.harvest,null);assert(r.latest.reasons.includes('event-log-unavailable'));
    r=f.next([]);assert.equal(r.latest.harvest,0,'observed empty log is a true zero');
    f.miner.pos.roomName='REMOTE';f.miner.store.energy=50;r=f.next();assert.equal(r.latest.exports,50);assert.equal(r.scope.complete,false,'unsupported remote extraction scope is explicit');
    f.miner.pos.roomName='R';r=f.next();assert.equal(r.latest.imports,50);
}
{
    const f=fixture();f.data.structures.push({id:'tower',my:true,structureType:C.STRUCTURE_TOWER,pos:f.pos(),store:{energy:100}},
        {id:'link',my:true,structureType:C.STRUCTURE_LINK,pos:f.pos(),store:{energy:100}},
        {id:'link2',my:true,structureType:C.STRUCTURE_LINK,pos:f.pos(),store:{energy:100}});
    f.observe();f.bank.store.energy-=10+2+3;
    const r=f.next([f.event(C.EVENT_ATTACK,'tower',{targetId:'enemy',damage:500}),f.event(C.EVENT_REPAIR,'builder',{energySpent:2,amount:200}),f.event(C.EVENT_TRANSFER,'link',{targetId:'link2',resourceType:C.RESOURCE_ENERGY,amount:100})]);
    assert.equal(r.latest.tower,10);assert.equal(r.latest.repair,2);assert.equal(r.latest.linkLoss,3);assert.equal(r.latest.operatingCost,15);assert.equal(r.latest.residual,0);
    assert.equal(r.latest.usefulOperatingCost,12);assert.equal(r.latest.usedEnergy,12,'link loss is an expense, not useful energy use');
}
{
    const f=fixture();f.ctx.Game.time=0;f.site.progressTotal=10000;
    f.data.structures.push({id:'tower',my:true,structureType:C.STRUCTURE_TOWER,pos:f.pos(),store:{energy:100}});
    f.observe();
    for(let t=1;t<=300;t++){
        const events=[f.event(C.EVENT_HARVEST,'miner',{targetId:'source1',amount:20}),f.event(C.EVENT_UPGRADE_CONTROLLER,'builder',{energySpent:8}),f.event(C.EVENT_BUILD,'builder',{targetId:'site',amount:5,incomplete:true}),f.event(C.EVENT_REPAIR,'builder',{energySpent:1})];
        let spent=14;f.site.progress+=5;
        if(t%10===0){spent+=10;events.push(f.event(C.EVENT_ATTACK,'tower',{targetId:'enemy',damage:100}));}
        if(t%100===0){const born=f.unit('born'+t,0);born.spawning=true;f.ctx.Game.creeps[born.id]=born;spent+=200;}
        f.bank.store.energy+=20-spent;f.observe(events,t);
    }
    const r=f.ctx.Memory.frontier.energy.rooms.R,w=r.windows[300];
    assert.equal(w.G,13);assert.equal(w.eta,.65,'legacy growth ratio is unchanged');
    assert.equal(w.utilizationRate,17);assert.equal(w.utilization,.85);assert.equal(w.utilizationTheoreticalRate,20);
    assert.equal(w.usefulOperatingCostRate,4);assert.equal(w.utilizationProductiveRate,13);
    assert.equal(w.utilizationCoverage,1);assert.equal(w.utilizationObservedTicks,300);assert.equal(w.utilizationEligible,true);
    assert.equal(w.utilizationTarget,.9);assert.equal(w.utilizationSustainedLow,true);
    assert.equal(r.utilizationIndicator.status,'pending');assert.equal(r.indicator.status,'clear','new 90% utilization guard does not replace old severe growth guard');
    // A single unknown financial event preserves G coverage but is excluded from
    // BOTH utilization numerator and denominator, not counted as zero spending.
    f.bank.store.energy+=18;
    f.observe([f.event(C.EVENT_HARVEST,'miner',{targetId:'source1',amount:20}),f.event(C.EVENT_UPGRADE_CONTROLLER,'builder',{energySpent:2}),f.event(C.EVENT_TRANSFER,'missing',{targetId:'builder',resourceType:C.RESOURCE_ENERGY,amount:1})],301);
    for(let t=302;t<=320;t++){f.bank.store.energy+=18;f.observe([f.event(C.EVENT_HARVEST,'miner',{targetId:'source1',amount:20}),f.event(C.EVENT_UPGRADE_CONTROLLER,'builder',{energySpent:2})],t);}
    const missing=r.windows[300];assert.equal(missing.observedTicks,300);assert.equal(missing.utilizationObservedTicks,299);
    assert.equal(missing.utilizationEligible,false);assert(missing.utilizationBlocked.includes('unresolved-accounting'));
    assert.equal(missing.utilizationTotals.potential,299*20);
    assert.equal(missing.utilizationRate,Math.round(missing.utilizationTotals.usedEnergy/299*10000)/10000);
}
{
    const f=fixture();f.ctx.Game.time=0;f.observe();
    assert.equal(f.ctx.Memory.frontier.energy.rooms.R.windows[300].utilization,null,'no observations are not zero use');
    for(let t=1;t<=300;t++)f.observe([],t);
    let w=f.ctx.Memory.frontier.energy.rooms.R.windows[300];assert.equal(w.utilization,0,'observed no actions is true zero');assert.equal(w.utilizationRate,0);
    const rows=[{...f.ctx.Memory.frontier.energy.rooms.R.history[1],from:0,to:300,ticks:300,observedTicks:300,balanceTicks:300,accountingTicks:300,inventoryTicks:300,scopeTicks:300,utilizationTicks:300,absResidual:0}];
    Object.assign(rows[0],{harvest:6000,upgrade:6600,knownExpense:6600,potential:6000,stockDelta:-600,usedEnergy:6600,usefulOperatingCost:0,utilizationPotential:6000});
    w=f.ctx.module.exports._windowMetrics(rows,300,300);assert.equal(w.utilization,1.1,'over 100% remains visible, not clamped');assert.equal(w.utilizationEligible,false);assert(w.utilizationBlocked.includes('stock-drawdown'));
    rows[0].stockDelta=0;rows[0].imports=600;w=f.ctx.module.exports._windowMetrics(rows,300,300);assert(w.utilizationBlocked.includes('imports'));assert.equal(w.utilizationSustainedLow,false);
    delete rows[0].utilizationTicks;delete rows[0].usedEnergy;delete rows[0].usefulOperatingCost;delete rows[0].utilizationPotential;
    w=f.ctx.module.exports._windowMetrics(rows,300,300);assert.equal(w.utilization,null,'old buckets cannot be reconstructed by mixing coverage');assert.equal(w.utilizationObservedTicks,0);
}
// Run the installed official processor for boosted build cases, not a test-only guessed model.
{
    const f=fixture(),mod={exports:{}};
    const lodash=require(require.resolve('lodash',{paths:[engine]}));
    const sandbox={module:mod,require(name){if(name==='lodash')return lodash;if(name==='../../../config')return{};if(name==='../../../utils')return{getDriver:()=>({constants:C}),checkTerrain:()=>false};throw Error(name);}};
    vm.runInNewContext(fs.readFileSync(engine+'/src/processor/intents/creeps/build.js','utf8'),sandbox);
    for(const boost of ['LH','LH2O','XLH2O'])for(const energy of [1,2,3,4,5]){
        const body=[{type:C.WORK,hits:100,boost}],object={_id:'b',type:'creep',user:'me',x:25,y:25,body,store:{energy},actionLog:{}};
        const target={_id:'s',type:'constructionSite',structureType:'road',x:25,y:25,progress:0,progressTotal:300},events=[];
        mod.exports(object,{id:'s'},{roomObjects:{s:target,b:object},roomTerrain:{},bulk:{update(){}},stats:{inc(){}},eventLog:events});
        assert.equal(events.length,1);const bonus=(C.BOOSTS[C.WORK][boost].build-1)*C.BUILD_POWER;
        const measured=f.ctx.module.exports._buildEnergy(events[0].data,{work:1,boosts:[bonus]},300);
        assert.equal(measured,energy-object.store.energy,'engine verified '+boost+' energy '+energy);
    }
    assert.equal(f.ctx.module.exports._buildEnergy({amount:5,incomplete:false},{work:1,boosts:[5]},5),null,'clipped boosted finish has ambiguous spend, never a fabricated value');
    f.builder.body[0].boost='XLH2O';f.site.progress=295;f.observe();f.bank.store.energy-=5;
    const r=f.next([f.event(C.EVENT_BUILD,'builder',{targetId:'site',amount:5,incomplete:false})]);
    assert.equal(r.latest.metricComplete,false);assert(r.latest.reasons.includes('build-energy-ambiguous'));
}
{
    const f=fixture();f.ctx.Game.time=0;f.observe();
    for(let t=1;t<=6500;t++){
        f.bank.store.energy+=18;
        f.observe([f.event(C.EVENT_HARVEST,'miner',{targetId:'source1',amount:20}),f.event(C.EVENT_UPGRADE_CONTROLLER,'builder',{amount:2,energySpent:2})],t);
        if(t===300){const w=f.ctx.Memory.frontier.energy.rooms.R.windows[1500];assert(w.warmingUp);assert.equal(w.sustainedLow,false);}
        if(t===320){const r=f.ctx.Memory.frontier.energy.rooms.R;assert.equal(r.windows[300].G,2);assert.equal(r.windows[300].eta,.1);assert.equal(r.indicator.status,'pending');}
        if(t===1520){const r=f.ctx.Memory.frontier.energy.rooms.R;assert.equal(r.windows[1500].observedTicks,1500);assert.equal(r.indicator.status,'active');}
    }
    const r=f.ctx.Memory.frontier.energy.rooms.R;assert(r.history.length<=300);assert.equal(r.windows[6000].observedTicks,6000);assert.equal(r.windows[6000].coverage,1);assert.equal(r.windows[6000].theoreticalRate,20);
    assert.equal(r.windows[6000].accountingObservedTicks,6000);assert.equal(r.windows[6000].scopeObservedTicks,6000);
    assert.equal(r.windows[6000].utilizationObservedTicks,6000);assert.equal(r.windows[6000].utilization,.1);assert.equal(r.utilizationIndicator.status,'active');
    assert.equal(r.windows[6000].inventoryDelta,6000*18,'inventoryDelta is total energy, rate has separate field');assert.equal(r.windows[6000].inventoryDeltaRate,18);
    assert.equal(r.windows[6000].residual,0);
    assert(JSON.stringify(f.ctx.Memory.frontier.energy).length<250000,'6000-tick history and retained actor state remain bounded');
    // With identical productivity but reserves funding current spending, low alarm is suppressed.
    const rows=[{from:0,to:300,ticks:300,observedTicks:300,balanceTicks:300,inventoryTicks:300,scopeTicks:300,missingTicks:0,absResidual:0}];
    for(const k of ['harvest','upgrade','buildUseful','buildOther','spawn','repair','tower','linkLoss','imports','exports','stockDelta','residual','knownExpense','operatingCost','potential'])rows[0][k]=0;
    Object.assign(rows[0],{upgrade:600,knownExpense:600,stockDelta:-600,potential:6000});
    let w=f.ctx.module.exports._windowMetrics(rows,300,300);assert(!w.eligible);assert(w.blocked.includes('stock-drawdown'));assert(!w.sustainedLow);
    rows[0].stockDelta=0;rows[0].imports=600;w=f.ctx.module.exports._windowMetrics(rows,300,300);assert(!w.eligible);assert(w.blocked.includes('imports'));
    rows[0].imports=0;rows[0].accountingTicks=299;w=f.ctx.module.exports._windowMetrics(rows,300,300);
    assert(w.blocked.includes('unresolved-accounting'));assert(!w.blocked.includes('incomplete-scope'));assert.equal(w.coverage,1);
    rows[0].accountingTicks=300;w=f.ctx.module.exports._windowMetrics(rows,300,300);assert(w.eligible);
}
console.log('PASS: event conservation, useful/unplanned completed builds, actual spawn births, death attribution, inventory deduplication, official-engine salvage withdrawals, separate productive/scope/accounting coverage, bounded diagnostic reasons, total utilization with matched coverage and 90% signal, zero/missing/>100% and legacy buckets, gaps/missing logs, ownership/scope, operating costs, official-engine boosts, 300/1500/6000 coverage, warmup/import/drawdown suppression, bounded history');
