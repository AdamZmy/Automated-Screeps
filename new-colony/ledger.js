'use strict';
// Physical owned-room energy ledger. Event logs describe the PREVIOUS tick.
// No action return codes, assigned WORK, or controller progress deltas are revenue.
const E=RESOURCE_ENERGY, VERSION=1, BUCKET=20, RETENTION=6000, WINDOWS=[300,1500,6000];
const FIELDS=['harvest','upgrade','buildUseful','buildOther','spawn','repair','tower','linkLoss','imports','exports','stockDelta','residual','knownExpense','operatingCost','potential'];
const value=o=>o&&o.store?Number(o.store[E])||0:0;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const key=o=>o.id||o.structureType+':'+o.pos.x+':'+o.pos.y;
const empty=()=>Object.fromEntries(FIELDS.map(k=>[k,0]));
const round=n=>finite(n)?Math.round(n*10000)/10000:null;
function find(room,type,reasons){
    try{const a=room.find(type);if(Array.isArray(a))return a;}catch(e){}
    reasons.push('inventory-find-'+type);return [];
}
function actor(o,kind){
    const body=o.body||[];
    return {r:o.pos.roomName,n:o.name||null,h:o.memory&&o.memory.home||null,my:kind==='creep'?o.my!==false:!!o.my,
        type:kind==='creep'?'creep':o.structureType||kind,e:value(o),spawning:!!o.spawning,
        cost:body.reduce((n,p)=>n+(BODYPART_COST[p.type]||0),0),work:body.filter(p=>p.type===WORK&&p.hits>0).length,
        // Engine build.js sums boost bonuses of ALL WORK parts, then slices by energy spent.
        boosts:body.filter(p=>p.type===WORK&&p.boost&&BOOSTS[WORK][p.boost]&&BOOSTS[WORK][p.boost].build>1)
            .map(p=>(BOOSTS[WORK][p.boost].build-1)*BUILD_POWER).sort((a,b)=>b-a)};
}
function snapshot(room,creeps,frontier){
    const reasons=[],structures=find(room,FIND_STRUCTURES,reasons),sources=find(room,FIND_SOURCES,reasons);
    const sites=find(room,FIND_MY_CONSTRUCTION_SITES,reasons),drops=find(room,FIND_DROPPED_RESOURCES,reasons);
    const tombstones=find(room,FIND_TOMBSTONES,reasons),ruins=find(room,FIND_RUINS,reasons);
    const inventory={structures:0,creeps:0,dropped:0,tombstones:0,ruins:0,total:0},seen=new Set(),actors={};
    const add=(o,group,amount)=>{const id=key(o);if(seen.has(id))return;seen.add(id);inventory[group]+=amount;};
    for(const o of structures){
        actors[key(o)]=actor(o,'structure');
        // Neutral containers are local recoverable stock; hostile owned stores are excluded.
        if(o.my||!o.owner&&o.structureType===STRUCTURE_CONTAINER)add(o,'structures',value(o));
    }
    for(const o of creeps)if(o.pos.roomName===room.name){actors[o.id]=actor(o,'creep');add(o,'creeps',value(o));}
    for(const o of drops)if(o.resourceType===E)add(o,'dropped',o.amount);
    // withdraw emits EVENT_TRANSFER with the stock object as objectId, including
    // tombstones and ruins. They must be resolvable actors as well as inventory.
    for(const o of tombstones){actors[key(o)]=actor(o,'tombstone');add(o,'tombstones',value(o));}
    for(const o of ruins){actors[key(o)]=actor(o,'ruin');add(o,'ruins',value(o));}
    inventory.total=inventory.structures+inventory.creeps+inventory.dropped+inventory.tombstones+inventory.ruins;
    const plan=frontier.rooms&&frontier.rooms[room.name]&&frontier.rooms[room.name].plan;
    const useful=new Set((plan&&plan.structures||[]).map(p=>p.type+':'+p.x+':'+p.y));
    const siteMap={};for(const s of sites)siteMap[s.id]={remaining:s.progressTotal-s.progress,useful:useful.has(s.structureType+':'+s.pos.x+':'+s.pos.y)};
    const sourceIds={};let potential=0;
    for(const s of sources){sourceIds[s.id]=true;potential+=s.energyCapacity/ENERGY_REGEN_TIME;if(s.effects&&s.effects.length)reasons.push('powered-source');}
    if(!finite(potential))reasons.push('source-capacity-unavailable');
    const remote=creeps.filter(c=>c.memory&&c.memory.home===room.name&&c.pos.roomName!==room.name);
    // Scope is explicit: remote rooms are not silently treated as unproductive sources.
    if(remote.some(c=>c.memory.role!=='scout'&&c.memory.role!=='claimer'))reasons.push('remote-economy-not-covered');
    if(structures.some(s=>s.my&&[STRUCTURE_TERMINAL,STRUCTURE_LAB,STRUCTURE_POWER_SPAWN,STRUCTURE_FACTORY].includes(s.structureType)))reasons.push('advanced-energy-flows-not-covered');
    return {tick:Game.time,inventory,actors,sites:siteMap,sources:sourceIds,potential,scopeReasons:[...new Set(reasons)],remoteCreeps:remote.length};
}
// EVENT_BUILD.amount is progress. This inversion follows official engine build.js,
// including its unusual slice(0, buildEffect), not a guessed boost multiplier.
// Clipped boosted completions can have several energy costs: return null, not an estimate.
function buildEnergy(data,a,remaining){
    if(!finite(data.amount)||data.amount<0)return null;
    if(!a||!a.boosts)return null;
    if(!a.boosts.length)return data.amount;
    if(!finite(remaining)||remaining<=0)return null;
    const possible=[];
    for(let spent=1;spent<=Math.min(a.work*BUILD_POWER,remaining);spent++){
        const bonus=a.boosts.slice(0,spent).reduce((n,x)=>n+x,0);
        if(Math.min(Math.floor(spent+bonus),remaining)===data.amount)possible.push(spent);
    }
    return possible.length===1?possible[0]:null;
}
function eventLog(room){
    try{const events=room.getEventLog();return Array.isArray(events)?events:null;}catch(e){return null;}
}
function measure(room,before,now,previousActors,currentActors,events){
    const out=Object.assign(empty(),{tick:Game.time,eventTick:Game.time-1,complete:false,metricComplete:false,scopeComplete:false,accountingComplete:false,balanceComplete:false,reasons:[]});
    out.potential=before&&finite(before.potential)?before.potential:null;
    if(!before||before.tick!==Game.time-1){
        for(const k of FIELDS)out[k]=null;
        out.reasons.push(before?'observation-gap':'baseline');return out;
    }
    out.stockDelta=now.inventory.total-before.inventory.total;
    out.reasons.push(...before.scopeReasons,...now.scopeReasons);
    out.scopeComplete=out.reasons.length===0;
    if(events===null){
        for(const k of FIELDS)if(k!=='stockDelta'&&k!=='potential')out[k]=null;
        out.reasons.push('event-log-unavailable');return out;
    }
    let metricComplete=true,balanceComplete=true;
    const unresolved=reason=>{out.reasons.push(reason);balanceComplete=false;};
    const unknownMetric=reason=>{metricComplete=false;unresolved(reason);};
    const actors=Object.assign({},now.actors,before.actors),remaining={};
    for(const id of Object.keys(before.sites))remaining[id]=before.sites[id].remaining;
    const towerSpent=new Set();
    for(const event of events){
        const d=event.data||{},a=actors[event.objectId]||previousActors[event.objectId]||currentActors[event.objectId];
        if(!a){
            // Unknown attackers are common; unresolved productive actors cannot become zero.
            if([EVENT_HARVEST,EVENT_UPGRADE_CONTROLLER,EVENT_BUILD].includes(event.event))unknownMetric('unresolved-event-actor');
            else if([EVENT_REPAIR,EVENT_TRANSFER].includes(event.event))unresolved('unresolved-financial-actor');
            continue;
        }
        if(!a.my)continue;
        if(event.event===EVENT_HARVEST){
            // Mineral harvest emits the same event. Only known energy Source IDs qualify.
            if(before.sources[d.targetId]||now.sources[d.targetId]){
                if(finite(d.amount))out.harvest+=d.amount;else unknownMetric('harvest-amount-unavailable');
            }
        }else if(event.event===EVENT_UPGRADE_CONTROLLER){
            if(finite(d.energySpent))out.upgrade+=d.energySpent;else unknownMetric('upgrade-energy-unavailable');
        }else if(event.event===EVENT_BUILD){
            const site=before.sites[d.targetId],spent=buildEnergy(d,a,remaining[d.targetId]);
            if(finite(remaining[d.targetId])&&finite(d.amount))remaining[d.targetId]-=d.amount;
            if(spent===null)unknownMetric('build-energy-ambiguous');
            else if(!site)unknownMetric('build-plan-attribution-unavailable');
            else out[site.useful?'buildUseful':'buildOther']+=spent;
        }else if(event.event===EVENT_REPAIR){
            if(a.type===STRUCTURE_TOWER)towerSpent.add(event.objectId);
            else if(finite(d.energySpent))out.repair+=d.energySpent;else unresolved('repair-energy-unavailable');
        }else if((event.event===EVENT_ATTACK||event.event===EVENT_HEAL)&&a.type===STRUCTURE_TOWER){
            towerSpent.add(event.objectId);
        }else if(event.event===EVENT_TRANSFER&&d.resourceType===E){
            if(a.type===STRUCTURE_LINK){
                if(finite(d.amount))out.linkLoss+=Math.ceil(d.amount*LINK_LOSS_RATIO);else unresolved('link-energy-unavailable');
            }
            // Cross-ownership transfers are not local internal circulation.
            const target=actors[d.targetId]||previousActors[d.targetId]||currentActors[d.targetId];
            if(target&&!target.my&&target.type!==STRUCTURE_CONTAINER)unresolved('external-resource-transfer');
        }
    }
    out.tower=towerSpent.size*TOWER_ENERGY_COST;
    for(const [id,a] of Object.entries(currentActors)){
        const old=previousActors[id];
        if(a.r===room.name&&a.spawning&&!old){
            // Game.creeps contains ID-less intent placeholders immediately after spawnCreep.
            // observe() filters those out; only a server-created real creep proves spending.
            out.spawn+=a.cost;
        }
        if(old&&old.r!==a.r){
            // Engine moves creeps after resource actions: post-resolution cargo crosses border.
            if(a.r===room.name)out.imports+=a.e;
            if(old.r===room.name)out.exports+=a.e;
        }else if(!old&&a.r===room.name&&!a.spawning)unresolved('new-creep-origin-unavailable');
    }
    for(const [id,a] of Object.entries(previousActors))if(a.r===room.name&&!currentActors[id]){
        // A death moves inventory to local tombstones/containers; it is not an export.
        if(!events.some(e=>e.event===EVENT_OBJECT_DESTROYED&&e.objectId===id))unresolved('disappeared-creep-origin-unavailable');
    }
    out.operatingCost=out.buildOther+out.spawn+out.repair+out.tower+out.linkLoss;
    // Actual production and maintenance use is counted transparently. This is
    // not proof that every spawn, repair or tower action was economically needed.
    out.usefulOperatingCost=out.spawn+out.repair+out.tower;
    out.usedEnergy=out.upgrade+out.buildUseful+out.usefulOperatingCost;
    out.knownExpense=out.upgrade+out.buildUseful+out.operatingCost;
    // Positive residual = unclassified outflow/loss; negative = unclassified inflow.
    // Includes natural decay, passive spawn regen, recycle refunds, unsupported mechanics.
    // It is deliberately NOT renamed 'waste' or 'missed source energy'.
    out.residual=out.harvest+out.imports-out.exports-out.knownExpense-out.stockDelta;
    out.metricComplete=metricComplete;
    out.accountingComplete=balanceComplete&&out.scopeComplete;
    out.balanceComplete=out.accountingComplete&&out.residual===0;
    out.complete=metricComplete&&out.reasons.length===0;
    out.reasons=[...new Set(out.reasons)];return out;
}
function bucket(from,to){return Object.assign(empty(),{from,to,ticks:0,observedTicks:0,balanceTicks:0,accountingTicks:0,inventoryTicks:0,scopeTicks:0,missingTicks:0,utilizationTicks:0,usedEnergy:0,usefulOperatingCost:0,utilizationPotential:0,absResidual:0,inventoryStart:null,inventoryEnd:null});}
function accumulate(b,s,inventory){
    b.to=s.eventTick+1;b.ticks++;
    if(s.metricComplete){
        b.observedTicks++;
        for(const k of ['harvest','upgrade','buildUseful','buildOther','potential'])b[k]+=s[k]||0;
    }else b.missingTicks++;
    for(const k of FIELDS)if(!['harvest','upgrade','buildUseful','buildOther','potential'].includes(k)&&finite(s[k]))b[k]+=s[k];
    if(finite(s.residual)){b.balanceTicks++;b.absResidual+=Math.abs(s.residual);}
    if(s.accountingComplete)b.accountingTicks=(b.accountingTicks||0)+1;
    // Numerator and theoretical denominator share exactly the same observations.
    // Never add productive and expense rates whose coverage may differ.
    if(s.metricComplete&&s.accountingComplete&&s.scopeComplete&&finite(s.potential)){
        b.utilizationTicks=(b.utilizationTicks||0)+1;
        b.usedEnergy=(b.usedEnergy||0)+s.usedEnergy;
        b.usefulOperatingCost=(b.usefulOperatingCost||0)+s.usefulOperatingCost;
        b.utilizationPotential=(b.utilizationPotential||0)+s.potential;
    }
    if(finite(s.stockDelta))b.inventoryTicks++;
    if(s.scopeComplete)b.scopeTicks++;
    if(b.inventoryStart===null&&finite(s.stockDelta))b.inventoryStart=inventory.total-s.stockDelta;
    b.inventoryEnd=inventory.total;
}
function windowMetrics(history,end,width){
    const rows=history.filter(b=>b.from>=end-width&&b.to<=end),sum=empty();
    let observedTicks=0,balanceTicks=0,accountingTicks=0,inventoryTicks=0,scopeTicks=0,absResidual=0;
    let utilizationTicks=0,usedEnergy=0,usefulOperatingCost=0,utilizationPotential=0;
    for(const b of rows){for(const k of FIELDS)sum[k]+=b[k];observedTicks+=b.observedTicks;balanceTicks+=b.balanceTicks;accountingTicks+=b.accountingTicks||0;inventoryTicks+=b.inventoryTicks||0;scopeTicks+=b.scopeTicks;absResidual+=b.absResidual;}
    for(const b of rows){
        // Older history has no joint-coverage fields. Retain it for G/eta without
        // manufacturing utilization observations during the schema transition.
        if(!finite(b.utilizationTicks)||!finite(b.usedEnergy)||!finite(b.usefulOperatingCost)||!finite(b.utilizationPotential))continue;
        utilizationTicks+=b.utilizationTicks;usedEnergy+=b.usedEnergy;usefulOperatingCost+=b.usefulOperatingCost;utilizationPotential+=b.utilizationPotential;
    }
    const G=observedTicks?(sum.upgrade+sum.buildUseful)/observedTicks:null;
    const theoreticalRate=observedTicks?sum.potential/observedTicks:null;
    const eta=theoreticalRate>0?G/theoreticalRate:null;
    const warmingUp=observedTicks<width,coverage=observedTicks/width;
    const blocked=[];
    if(warmingUp)blocked.push('warmup-or-gap');
    if(scopeTicks<width)blocked.push('incomplete-scope');
    if(accountingTicks<width)blocked.push('unresolved-accounting');
    if(sum.imports>0)blocked.push('imports');
    if(sum.stockDelta<0)blocked.push('stock-drawdown');
    if(balanceTicks<width||absResidual>Math.max(width,sum.potential*.05))blocked.push('unexplained-balance');
    const eligible=blocked.length===0&&eta!==null;
    const utilizationRate=utilizationTicks?usedEnergy/utilizationTicks:null;
    const utilizationTheoreticalRate=utilizationTicks?utilizationPotential/utilizationTicks:null;
    const utilization=utilizationPotential>0?usedEnergy/utilizationPotential:null;
    const utilizationBlocked=blocked.slice();
    if(utilizationTicks<width)utilizationBlocked.push('utilization-warmup-or-gap');
    const utilizationEligible=utilizationBlocked.length===0&&utilization!==null;
    return {tick:end,requestedTicks:width,observedTicks,coverage:round(coverage),warmingUp,G:round(G),eta:round(eta),theoreticalRate:round(theoreticalRate),
        utilizationRate:round(utilizationRate),utilization:round(utilization),utilizationTheoreticalRate:round(utilizationTheoreticalRate),utilizationTarget:.9,
        utilizationObservedTicks:utilizationTicks,utilizationCoverage:round(utilizationTicks/width),utilizationWarmingUp:utilizationTicks<width,
        utilizationProductiveRate:round(utilizationTicks?(usedEnergy-usefulOperatingCost)/utilizationTicks:null),usefulOperatingCostRate:round(utilizationTicks?usefulOperatingCost/utilizationTicks:null),
        utilizationEligible,utilizationBlocked,utilizationSustainedLow:utilizationEligible&&utilization<.9,
        utilizationTotals:{usedEnergy,usefulOperatingCost,productive:usedEnergy-usefulOperatingCost,potential:utilizationPotential},
        harvestRate:round(observedTicks?sum.harvest/observedTicks:null),upgradeRate:round(observedTicks?sum.upgrade/observedTicks:null),buildUsefulRate:round(observedTicks?sum.buildUseful/observedTicks:null),
        expenseRate:round(balanceTicks?sum.knownExpense/balanceTicks:null),operatingCostRate:round(balanceTicks?sum.operatingCost/balanceTicks:null),
        spawnRate:round(balanceTicks?sum.spawn/balanceTicks:null),repairRate:round(balanceTicks?sum.repair/balanceTicks:null),towerRate:round(balanceTicks?sum.tower/balanceTicks:null),
        linkLossRate:round(balanceTicks?sum.linkLoss/balanceTicks:null),buildOtherRate:round(observedTicks?sum.buildOther/observedTicks:null),
        inventoryDelta:inventoryTicks?sum.stockDelta:null,inventoryDeltaRate:round(inventoryTicks?sum.stockDelta/inventoryTicks:null),inventoryObservedTicks:inventoryTicks,
        residual:balanceTicks?sum.residual:null,residualRate:round(balanceTicks?sum.residual/balanceTicks:null),absResidual:balanceTicks?absResidual:null,
        imports:balanceTicks?sum.imports:null,exports:balanceTicks?sum.exports:null,balanceObservedTicks:balanceTicks,accountingObservedTicks:accountingTicks,scopeObservedTicks:scopeTicks,totals:sum,
        eligible,blocked,sustainedLow:eligible&&eta<.35};
}
function observe(owned){
    const frontier=Memory.frontier=Memory.frontier||{rooms:{}};
    let root=frontier.energy;
    if(!root||root.version!==VERSION)root=frontier.energy={version:VERSION,tick:Game.time,started:Game.time,capturedAt:Date.now(),rooms:{},_state:{tick:null,rooms:{},actors:{}}};
    const state=root._state||(root._state={tick:null,rooms:{},actors:{}});
    if(state.tick===Game.time)return root;
    // Exclude synthetic same-tick spawn intents, which have no object ID yet.
    const creeps=Object.values(Game.creeps).filter(c=>c.id&&c.my!==false),currentActors={};
    for(const c of creeps)currentActors[c.id]=actor(c,'creep');
    const nextRooms={};
    for(const room of owned){
        const now=snapshot(room,creeps,frontier),before=state.rooms[room.name];nextRooms[room.name]=now;
        const sample=measure(room,before,now,state.actors,currentActors,eventLog(room));
        const entry=root.rooms[room.name]||(root.rooms[room.name]={history:[],windows:{},started:Game.time});
        entry.tick=Game.time;entry.eventTick=Game.time-1;entry.inventory=now.inventory;entry.latest=sample;
        if(sample.reasons.length){
            const recent=entry.recentReasons=entry.recentReasons||[],last=recent[recent.length-1];
            if(last&&last.tick===Game.time-1&&last.metricComplete===sample.metricComplete&&last.accountingComplete===sample.accountingComplete&&JSON.stringify(last.reasons)===JSON.stringify(sample.reasons)){
                last.tick=Game.time;last.eventTick=sample.eventTick;last.count++;
            }else recent.push({firstTick:Game.time,tick:Game.time,eventTick:sample.eventTick,count:1,metricComplete:sample.metricComplete,scopeComplete:sample.scopeComplete,accountingComplete:sample.accountingComplete,reasons:sample.reasons});
            entry.recentReasons=recent.slice(-12);
        }
        entry.scope={kind:'owned-room-physical',complete:now.scopeReasons.length===0,remoteCreeps:now.remoteCreeps,reasons:now.scopeReasons,
            inventories:'owned structures and resident owned creeps; local neutral containers, energy drops, tombstones and ruins; excludes energy in sources',
            importsExports:'observed own-creep border cargo only; other flows remain residual; no remote source accounting'};
        const start=Math.floor(sample.eventTick/BUCKET)*BUCKET;
        if(!entry._bucket||entry._bucket.from<start){
            if(entry._bucket)entry.history.push(entry._bucket);
            entry._bucket=bucket(start,start);
        }
        accumulate(entry._bucket,sample,now.inventory);
        entry.history=entry.history.filter(b=>b.to>Game.time-RETENTION).slice(-(RETENTION/BUCKET));
        if(Game.time%BUCKET===0||!entry.capturedAt){
            entry.capturedAt=Date.now();
            const history=entry.history.concat(entry._bucket);
            for(const width of WINDOWS)entry.windows[width]=windowMetrics(history,Game.time,width);
            const fast=entry.windows[300],primary=entry.windows[1500];
            const status=primary.sustainedLow?'active':fast.sustainedLow?'pending':'clear';
            const prior=entry.indicator;
            entry.indicator={status,thresholdEta:.35,primaryWindow:1500,since:status==='clear'?null:prior&&prior.status===status?prior.since:Game.time,
                reason:status==='active'?'measured-low-useful-energy':status==='pending'?'300-tick-low-awaiting-primary-window':primary.blocked.join(', ')||'within-target'};
            const utilizationStatus=primary.utilizationSustainedLow?'active':fast.utilizationSustainedLow?'pending':'clear';
            const previousUtilization=entry.utilizationIndicator;
            entry.utilizationIndicator={status:utilizationStatus,threshold:.9,primaryWindow:1500,
                since:utilizationStatus==='clear'?null:previousUtilization&&previousUtilization.status===utilizationStatus?previousUtilization.since:Game.time,
                reason:utilizationStatus==='active'?'measured-energy-use-below-target':utilizationStatus==='pending'?'300-tick-energy-use-below-target-awaiting-primary':primary.utilizationBlocked.join(', ')||'within-target'};
        }
    }
    for(const name of Object.keys(root.rooms))if(!nextRooms[name])delete root.rooms[name];
    root.tick=Game.time;if(Game.time%BUCKET===0)root.capturedAt=Date.now();
    root._state={tick:Game.time,rooms:nextRooms,actors:currentActors};
    return root;
}
module.exports={observe,_buildEnergy:buildEnergy,_windowMetrics:windowMetrics};
