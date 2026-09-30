'use strict';
const {E,vals,range,energy,availableEnergy,availableCapacity,commitEnergy,near,go,allCreeps,roomCreeps,hostiles,drops,tombstones,ruins,sources,stores,structures}=require('runtime');
const {controllerStation,upgraderAssignment,economyMemory,routeTravel,constructionJobs,walkable}=require('development');
const {linkNetwork}=require('infrastructure');
const movementCount=name=>require('metrics').movementCount(name);
const profile=(name,run)=>{const metrics=require('metrics');return metrics.measured?metrics.measured('logistics',name,run):run();};
// Disposable room indexes share the immutable engine snapshot for this tick.
// Only accepted actions mutate the intent book; changes to owned task promises
// update the indexes below immediately rather than rebuilding them per request.
let boardTick=-1,boards=new Map();
// Static source-to-destination routes are shared by all Haulers in the room.
// Keep them on the heap rather than in Memory: the route is derived from the
// room plan and should not inflate the serialized per-tick game state.
const haulRouteCache=new Map(),HAUL_ROUTE_TTL=500,HAUL_ROUTE_LIMIT=256;
const approachCache=new Map(),APPROACH_LIMIT=512;
const ownsHauling=c=>c.memory.role==='hauler'||c.memory.haul&&c.memory.haul.executorTick===Game.time;
function topologyKey(room){
    const board=getBoard(room);if(board.topology!==undefined)return board.topology;
    // Include identities, coordinates and rampart passability: replacing one
    // obstacle with another must invalidate routes even if counts are equal.
    return board.topology=structures(room).map(s=>s.id+':'+s.structureType+':'+s.pos.x+':'+s.pos.y+':'+Number(!!s.my)+':'+Number(!!s.isPublic)).join('|');
}
function haulRouteVersion(room){
    const plan=economyMemory(room).plan||{};
    return [plan.version||0,plan.roadVersion||0,room.controller&&room.controller.level||0].join(':');
}
function haulRouteKey(room,source,destination){
    const sid=source&&(source.id||source.structureType+':'+source.pos.x+':'+source.pos.y),did=destination&&(destination.id||destination.structureType+':'+destination.pos.x+':'+destination.pos.y);
    return room.name+'|'+sid+'>'+did+'|'+haulRouteVersion(room);
}
function fixtureStamp(room) {
    // Deterministic fixtures can replace objects/stores/tasks inside one tick;
    // real Room objects have no `objects` collection and skip this test adapter.
    const objectSnapshot=room.objects||room.snapshotObjects;
    if(!objectSnapshot)return null;
    const control=economyMemory(room).economyControl||{},parts=[room.controller&&room.controller.level,control.target,control.developmentBudget];
    for(const o of objectSnapshot)parts.push(o.id,o.structureType,o.pos&&o.pos.x,o.pos&&o.pos.y,energy(o));
    for(const c of Object.values(Game.creeps))if(c.room&&c.room.name===room.name){
        const h=c.memory.haul,t=h&&h.task,b=c.memory.workSupply;
        parts.push(c.name,c.memory.role,energy(c),h&&h.state,h&&h.executorTick,t&&t.id,t&&t.source,t&&t.amount,t&&t.pickupAmount,t&&t.expires,
            t&&t.intent&&t.intent.at,t&&t.intent&&t.intent.kind,t&&t.intent&&t.intent.amount,b&&b.id,b&&b.job);
    }
    for(const site of room.sites||[])parts.push(site.id,site.progress);
    return parts.join('|');
}
function getBoard(room,extra=null,refresh=false) {
    if(boardTick!==Game.time){boardTick=Game.time;boards=new Map();}
    let board=boards.get(room.name);
    // The Set marker exists only in deterministic fixtures. Never walk a
    // non-public Room property on the live engine just to validate a cache.
    const fixture=room.walls&&typeof room.walls.has==='function'&&(room.objects||room.snapshotObjects);
    const stamp=refresh&&fixture&&!board?.active?fixtureStamp(room):undefined;
    if(!board||board.room!==room||board.root!==Game.creeps||stamp!==undefined&&stamp!==board.stamp){
        const retainPrepared=!!(board&&board.prepared&&board.room===room&&board.root===Game.creeps&&(stamp===undefined||stamp===board.stamp));
        board={room,root:Game.creeps,stamp:stamp===undefined?(fixture?fixtureStamp(room):null):stamp,active:0,prepared:retainPrepared,members:[],names:new Set(),
            entries:new Map(),destinations:new Map(),sourceMembers:new Map(),destinationTotals:new Map(),sourceTotals:new Map(),layouts:new Map(),preparedTasks:new Map(),approaches:new Map()};
        boards.set(room.name,board);
        for(const c of allCreeps())if(Game.creeps[c.name]===c&&!c.spawning&&c.room&&c.room.name===room.name&&ownsHauling(c)){
            board.members.push(c);board.names.add(c.name);indexCreep(c,board);
        }
    }
    if(extra&&!board.names.has(extra.name)){board.members.push(extra);board.names.add(extra.name);indexCreep(extra,board);board.prepared=false;}
    return board;
}
function finishBoard(board) {if(!board.active&&board.room.walls&&typeof board.room.walls.has==='function'&&(board.room.objects||board.room.snapshotObjects))board.stamp=fixtureStamp(board.room);}
function indexCreep(c,board=boards.get(c.room.name)) {
    if(!board||boardTick!==Game.time)return;
    const h=c.memory.haul,t=h&&h.task,valid=Game.creeps[c.name]===c&&!c.spawning&&c.room.name===board.room.name&&ownsHauling(c)&&validDelivery(c,t);
    const entry=valid?{id:t.id,total:pending(t,'deliver')?0:t.amount,funded:fundedDelivery(c,t),source:h.state==='pickup'&&!pending(t)?t.source:null,
        port:h.state==='deliver'&&!pending(t)&&t.port&&range(c,t.port)<=3?t.port.x+50*t.port.y:null,
        pickup:Math.max(0,t.pickupAmount||t.amount-energy(c))}:null;
    const old=board.entries.get(c.name);
    if(old&&entry&&old.id===entry.id&&old.total===entry.total&&old.funded===entry.funded&&old.source===entry.source&&old.pickup===entry.pickup&&old.port===entry.port)return;
    if(!old&&!entry)return;
    // Port ownership can change when a task or its cargo changes. Rebuild the
    // small tile index lazily, never retain a released lease within this tick.
    if(old?.port!==entry?.port)board.portClaims=null;
    if(old){
        const d=board.destinationTotals.get(old.id);d.total-=old.total;d.funded-=old.funded;
        board.destinations.get(old.id).delete(c);
        if(old.source){board.sourceTotals.set(old.source,board.sourceTotals.get(old.source)-old.pickup);board.sourceMembers.get(old.source).delete(c);}
        board.entries.delete(c.name);
    }
    if(!entry)return;
    board.entries.set(c.name,entry);
    if(!board.destinations.has(t.id)){board.destinations.set(t.id,new Set());board.destinationTotals.set(t.id,{total:0,funded:0});}
    board.destinations.get(t.id).add(c);const d=board.destinationTotals.get(t.id);d.total+=entry.total;d.funded+=entry.funded;
    if(entry.source){
        if(!board.sourceMembers.has(entry.source)){board.sourceMembers.set(entry.source,new Set());board.sourceTotals.set(entry.source,0);}
        board.sourceMembers.get(entry.source).add(c);board.sourceTotals.set(entry.source,board.sourceTotals.get(entry.source)+entry.pickup);
    }
}
function cachedNeeds(room,includeStorage=true) {
    const board=getBoard(room);
    if(!board.requests){board.requests=deliveryNeeds(room);board.requestsById=new Map(board.requests.map(n=>[n.node.id,n]));}
    return includeStorage?board.requests:board.requests.filter(n=>n.node.structureType!==STRUCTURE_STORAGE);
}
function reservedDelivery(c,id,funded) {
    const board=getBoard(c.room),sum=board.destinationTotals.get(id),own=board.entries.get(c.name),field=funded?'funded':'total';
    return (sum?sum[field]:0)-(own&&own.id===id?own[field]:0);
}
function deliveryNeeds(room,includeStorage=true) {
    const stock=stores(room),ss=sources(room),ctrl=room.controller,needs=[];
    const add=(node,high,priority)=>{if(node&&node.store.getFreeCapacity(E)>0)needs.push({node,high:Math.min(high,energy(node)+node.store.getFreeCapacity(E)),priority});};
    for(const s of stock)if(s.my&&[STRUCTURE_SPAWN,STRUCTURE_EXTENSION].includes(s.structureType))add(s,energy(s)+s.store.getFreeCapacity(E),0);
    const threatened=hostiles(room).length>0;
    for(const s of stock)if(s.my&&s.structureType===STRUCTURE_TOWER)add(s,threatened?900:400,1);
    const station=controllerStation(room),assignment=upgraderAssignment(room),m=economyMemory(room);
    // A borrower must also receive fuel: size the controller buffer for the
    // maximum useful share its existing WORK can consume, not just its floor.
    const control=m.economyControl,ceiling=control&&Game.time-control.at<200?(control.developmentBudget??(control.target+(control.buildEnergyTarget||0))):assignment.policy.target;
    const rate=Math.min(ceiling,room.controller.level===8?15:Infinity,assignment.primary.reduce((n,c)=>n+c.getActiveBodyparts(WORK),0));
    const carriers=allCreeps().filter(c=>!c.spawning&&c.room.name===room.name&&c.memory.role==='hauler');
    const batch=Math.max(100,...carriers.map(c=>energy(c)+c.store.getFreeCapacity(E)));
    // Existing round trips include empty return, pickup, delivery and terrain.
    // They are conservative planning estimates, not measured travel times.
    const routes=m.economyControl&&m.economyControl.routes||[];
    const lead=Math.max(10,...(routes.length?routes.map(r=>r.roundTrip||0):ss.map(s=>2*(routeTravel(room,s)+4)+4)));
    if(station){
        const node=station.node,capacity=energy(node)+node.store.getFreeCapacity(E);
        const low=Math.min(capacity*.65,Math.max(25,rate*(lead+5))),high=node.structureType===STRUCTURE_CONTAINER?capacity:Math.min(capacity,Math.max(100,low+batch));
        let request=m.controllerSupply;
        if(!request||request.id!==node.id)request=m.controllerSupply={id:node.id,active:false};
        if(node.structureType===STRUCTURE_CONTAINER)request.active=energy(node)<capacity;
        else if(energy(node)<=low)request.active=true;else if(energy(node)>=high)request.active=false;
        // Containers are physical buffers: every free unit is useful delivery
        // capacity. Link nodes retain their existing refill hysteresis.
        if(request.active)add(node,high,energy(node)<Math.max(25,rate*10)?2:4);
    }else delete m.controllerSupply;
    const jobIds=new Set(constructionJobs(room).map(s=>s.id)),workNodes=new Map();
    for(const c of allCreeps()){
        const binding=c.memory.workSupply;
        if(c.room.name!==room.name||!binding||!jobIds.has(binding.job))continue;
        const node=Game.getObjectById(binding.id);
        if(node&&node.structureType===STRUCTURE_CONTAINER&&(!station||!station.nodes.some(s=>s.id===node.id))&&!ss.some(s=>range(s,node)<=1))
            workNodes.set(node.id,{node,capacity:Math.max(batch,(workNodes.get(node.id)?.capacity||0)+energy(c)+c.store.getFreeCapacity(E))});
    }
    for(const {node,capacity} of workNodes.values())add(node,capacity,3);
    // The hub is an inbound link receiver. Refilling it by hauler would send
    // received energy back through the same link network in a hauling loop.
    const hub=linkNetwork(room).hub;
    for(const s of stock)if(s.my&&s.structureType===STRUCTURE_LINK&&s.id!==hub?.id&&ctrl&&range(s,ctrl)>3&&!ss.some(src=>range(src,s)<=2))add(s,600,5);
    if(includeStorage&&room.storage)add(room.storage,energy(room.storage)+room.storage.store.getFreeCapacity(E),6);
    return needs.filter(n=>energy(n.node)<n.high);
}
// One task is authoritative. Cargo comes from this tick's Store snapshot;
// intent amounts are promises accepted by the engine, never measured delivery.
function haulMemory(c) {
    let h=c.memory.haul;
    if(!h||!['idle','pickup','deliver'].includes(h.state)){
        const old=c.memory.haulDelivery,pickup=c.memory.haulPickup;
        h=c.memory.haul={state:'idle',task:null};
        if(old&&old.id&&old.room===c.room.name){
            h.task={...old,source:old.source||pickup&&pickup.id};
            h.state=energy(c)>0?'deliver':'pickup';
            if(old.sent===Game.time)h.task.intent={kind:'deliver',at:Game.time,amount:old.amount,before:energy(c)};
            else if(old.pickupTick===Game.time)h.task.intent={kind:'pickup',at:Game.time,amount:old.pickupAmount||0,before:energy(c)};
            delete h.task.phase;delete h.task.sent;delete h.task.pickupTick;delete h.task.pickupAmount;
        }
        if(energy(c)>0&&(c.memory.withdrawnFrom||h.task&&h.task.source))h.origin=c.memory.withdrawnFrom||h.task.source;
    }
    // Idempotent migration: no old flag may override physical cargo after reset.
    delete c.memory.loaded;delete c.memory.haulPickup;delete c.memory.haulDelivery;delete c.memory.withdrawnFrom;
    return h;
}
function pending(task,kind) {return !!(task&&task.intent&&task.intent.at===Game.time&&(!kind||task.intent.kind===kind));}
function clearTask(c) {const h=haulMemory(c);h.task=null;h.state='idle';indexCreep(c);}
function validDelivery(c,task) {
    const target=task&&Game.getObjectById(task.id);
    return !!(task&&task.room===c.room.name&&task.expires>Game.time&&Number.isInteger(task.amount)&&task.amount>0&&
        target&&target.structureType&&target.store&&(target.store.getFreeCapacity(E)>0||pending(task,'deliver')));
}
function fundedDelivery(c,task) {
    if(!task)return 0;
    if(pending(task,'deliver'))return 0; // already included in runtime incoming intents
    return Math.min(task.amount,availableEnergy(c)+(pending(task,'pickup')?task.intent.amount:0));
}
function holdsDeliveryPort(c,task) {
    return !!(task&&c.memory.haul&&(c.memory.role==='hauler'||c.memory.haul.executorTick===Game.time)&&c.memory.haul.state==='deliver'&&!pending(task)&&task.port&&validDelivery(c,task)&&range(c,task.port)<=3);
}
function carriers(room,extra=null) {return getBoard(room,extra).members;}
function deliveryGap(request) {
    // A Link or another courier may already have accepted a transfer this tick.
    const incoming=Math.max(0,request.node.store.getFreeCapacity(E)-availableCapacity(request.node));
    return Math.max(0,Math.floor(Math.min(availableCapacity(request.node),request.high-energy(request.node)-incoming)));
}
function peers(c,id) {
    const group=getBoard(c.room).destinations.get(id);
    return group?Array.from(group).filter(p=>p!==c):[];
}
function reservedSource(c,id) {
    const board=getBoard(c.room),own=board.entries.get(c.name);
    return (board.sourceTotals.get(id)||0)-(own&&own.source===id?own.pickup:0);
}
function pickupNodes(room) {
    const board=getBoard(room);if(board.pickups)return board.pickups;
    const ss=sources(room),stock=stores(room),hub=linkNetwork(room).hub,seen=new Set();
    return board.pickups=drops(room).filter(d=>d.resourceType===E).concat(
        stock.filter(s=>s.structureType===STRUCTURE_CONTAINER&&ss.some(src=>range(src,s)<=1)),
        tombstones(room),ruins(room),hub?[hub]:[],room.storage?[room.storage]:[])
        .filter(node=>{if(availableEnergy(node)<=0||seen.has(node.id))return false;seen.add(node.id);return true;});
}
function sourceAllowed(c,node,destination) {
    const avoid=c.memory.haulPickupAvoid;
    return !!destination&&node.id!==destination.id&&(!avoid||avoid.until<=Game.time||avoid.id!==node.id)&&
        !(node.structureType===STRUCTURE_STORAGE&&destination.structureType===STRUCTURE_STORAGE);
}
function pathLeg(from,to) {
    if(range(from,to)<=1)return {end:from.pos||from,length:0};
    const pos=from.pos||from;
    movementCount('pathSearches');
    const path=pos.findPathTo(to.pos||to,{range:1,ignoreCreeps:true,maxRooms:1,maxOps:2000});
    const end=path[path.length-1];
    return end&&range(end,to)<=1?{end:new RoomPosition(end.x,end.y,pos.roomName),length:path.length,path}:null;
}
function approachPossible(c,source) {
    const board=getBoard(c.room),key=c.pos.x+50*c.pos.y+'>'+source.id;
    if(board.approaches.has(key)){movementCount('haulApproachCacheHits');return board.approaches.get(key);}
    const version=haulRouteVersion(c.room),cacheKey=c.room.name+'|'+key,old=approachCache.get(cacheKey);
    const topology=topologyKey(c.room);
    let reachable;
    if(old&&old.version===version&&old.topology===topology&&Game.time>=old.at&&Game.time-old.at<(old.reachable?HAUL_ROUTE_TTL:15)){
        movementCount('haulApproachCacheHits');reachable=old.reachable;
    }else{
        movementCount('haulApproachCacheMisses');reachable=!!pathLeg(c,source);
        approachCache.delete(cacheKey);if(approachCache.size>=APPROACH_LIMIT)approachCache.delete(approachCache.keys().next().value);
        approachCache.set(cacheKey,{at:Game.time,version,topology,reachable});
    }
    board.approaches.set(key,reachable);return reachable;
}
function routePossible(c,source,destination) {
    // Both legs retain real reachability checks. Cache the immutable second
    // leg by node pair and approaches by exact start tile/source, never infer
    // connectivity from geometric distance. New structures invalidate both.
    const topology=topologyKey(c.room);
    const key=haulRouteKey(c.room,source,destination),version=haulRouteVersion(c.room),old=haulRouteCache.get(key);
    let route=old&&old.version===version&&old.topology===topology&&Game.time>=old.at&&Game.time-old.at<(old.reachable?HAUL_ROUTE_TTL:15)?old:null;
    if(route){movementCount('haulRouteCacheHits');}
    else{
        movementCount('haulRouteCacheMisses');
        const staticLeg=pathLeg(source,destination);
        route={key,version,topology,at:Game.time,reachable:!!staticLeg,length:staticLeg&&staticLeg.length||0};
        haulRouteCache.delete(key);
        if(haulRouteCache.size>=HAUL_ROUTE_LIMIT)haulRouteCache.delete(haulRouteCache.keys().next().value);
        haulRouteCache.set(key,route);
    }
    if(!route.reachable)return false;
    return approachPossible(c,source);
}
function reconcileTask(c,requests) {
    const h=haulMemory(c),task=h.task,position=c.pos.x+','+c.pos.y;
    const blocked=c.memory.haulBlocked||{};
    for(const id in blocked)if(blocked[id]<=Game.time)delete blocked[id];
    if(!energy(c)&&!pending(task,'pickup'))delete h.origin;
    if(!task){h.state='idle';return;}
    if(task.intent&&task.intent.at<Game.time){
        // Do not add expected pickup or subtract expected delivery from Memory.
        // Actual next-tick cargo alone decides which phase can continue.
        // A physically empty carrier has finished this trip. Never recycle
        // its old small quantity into the next pickup: that would turn a
        // one-off 9-energy delivery into an indefinitely 9-energy courier.
        if(task.intent.kind==='deliver'&&!energy(c)){clearTask(c);return;}
        if(task.intent.kind==='pickup'&&energy(c)>0)h.origin=task.source;
        delete task.intent;
    }
    if(pending(task))return;
    const board=getBoard(c.room),request=requests===board.requests?board.requestsById.get(task.id):requests.find(n=>n.node.id===task.id);
    if(!validDelivery(c,task)||blocked[task.id]||!request||deliveryGap(request)<=0||h.origin===task.id){clearTask(c);return;}
    task.priority=request.priority;
    if(task.position!==position||c.fatigue){task.position=position;task.progress=Game.time;}
    const source=task.source&&Game.getObjectById(task.source);
    if(energy(c)>0){
        // Finish the planned amount immediately. A partial carrier may top up
        // only at an adjacent source with at most two extra route steps, and
        // never while a spawn/defense/starvation request is urgent.
        const destination=Game.getObjectById(task.id),detour=source?range(c,source)+range(source,destination)-range(c,destination):Infinity;
        const topup=h.state==='pickup'&&energy(c)<task.amount&&task.priority>2&&source&&availableEnergy(source)>0&&range(c,source)<=1&&detour<=2;
        h.state=topup?'pickup':'deliver';
        if(!topup){task.amount=Math.min(task.amount,energy(c));task.pickupAmount=0;}
    }else if(!source||availableEnergy(source)<=0||Game.time-(task.progress||Game.time)>=15){
        if(source&&Game.time-(task.progress||Game.time)>=15)c.memory.haulPickupAvoid={id:source.id,until:Game.time+15};
        clearTask(c);
    }else h.state='pickup';
}
function reconcile(c,requests) {reconcileTask(c,requests);indexCreep(c);}
function reclaimSoft(c,request,amount) {
    const board=getBoard(c.room),sum=board.destinationTotals.get(request.node.id),own=board.entries.get(c.name);
    if(amount+(sum?sum.total:0)-(own&&own.id===request.node.id?own.total:0)<=deliveryGap(request))return;
    const others=peers(c,request.node.id).filter(p=>!pending(p.memory.haul.task,'deliver'));
    let excess=Math.max(0,amount+others.reduce((n,p)=>n+p.memory.haul.task.amount,0)-deliveryGap(request));
    for(const p of others.sort((a,b)=>range(b,request.node)-range(a,request.node))){
        const h=p.memory.haul,t=h.task,take=Math.min(excess,Math.max(0,t.amount-fundedDelivery(p,t)));
        if(!take)continue;t.amount-=take;excess-=take;
        t.pickupAmount=Math.min(t.pickupAmount||0,Math.max(0,t.amount-energy(p)));
        if(t.amount<=0)clearTask(p);else indexCreep(p);
        if(excess<=0)break;
    }
}
function reclaimSource(c,source) {
    let left=availableEnergy(source);
    for(const peer of Array.from(getBoard(c.room).sourceMembers.get(source.id)||[])){
        const h=peer.memory.haul,t=h&&h.task;
        if(peer===c||!t||h.state!=='pickup'||t.source!==source.id||pending(t)||!validDelivery(peer,t))continue;
        const keep=Math.min(left,Math.max(0,t.pickupAmount||t.amount-energy(peer)));left-=keep;
        t.pickupAmount=keep;t.amount=Math.min(t.amount,energy(peer)+keep);
        if(t.amount<=0)clearTask(peer);else{if(!keep)h.state='deliver';indexCreep(peer);}
    }
}
function assignTask(c,requests) {
    const h=haulMemory(c),old=h.task;
    if(pending(old))return old&&Game.getObjectById(old.id);
    const cargo=availableEnergy(c),funded=cargo>0,blocked=c.memory.haulBlocked||{},capacity=availableCapacity(c);
    const choices=requests.filter(n=>!blocked[n.node.id]&&n.node.id!==h.origin)
        .map(n=>({...n,gap:Math.max(0,deliveryGap(n)-reservedDelivery(c,n.node.id,funded))}))
        .filter(n=>n.gap>0).sort((a,b)=>a.priority-b.priority||Number(b.node.id===old?.id)-Number(a.node.id===old?.id)||range(c,a.node)-range(c,b.node));
    const routedPriorities=new Set();
    for(const request of choices){
        const same=old&&old.id===request.node.id;
        if(funded){
            if(!same&&!near(c,[request.node]))continue;
            const amount=Math.min(cargo,request.gap,same?old.amount:Infinity);
            reclaimSoft(c,request,amount);
            if(same&&h.state==='pickup'&&old.source){
                const source=Game.getObjectById(old.source),free=source&&Math.max(0,availableEnergy(source)-reservedSource(c,source.id));
                if(free&&old.priority>2&&range(c,source)<=1){
                    old.amount=Math.min(old.amount,request.gap,cargo+free);old.pickupAmount=Math.min(capacity,old.amount-cargo);return request.node;
                }
            }
            if(!same){movementCount(old?'deliverySwitches':'deliveryStarts');h.task={id:request.node.id,room:c.room.name,source:h.origin,expires:Game.time+200,position:c.pos.x+','+c.pos.y,progress:Game.time};}
            h.state='deliver';h.task.amount=amount;h.task.pickupAmount=0;h.task.priority=request.priority;
            return request.node;
        }
        if(same&&old.source){
            const node=Game.getObjectById(old.source),free=node&&Math.max(0,availableEnergy(node)-reservedSource(c,node.id));
            if(free&&sourceAllowed(c,node,request.node)){
                old.amount=Math.min(old.amount,request.gap,free,capacity);old.pickupAmount=Math.min(capacity,free,node.resourceType?capacity:old.amount);
                old.priority=request.priority;h.state='pickup';return request.node;
            }
        }
        if(routedPriorities.has(request.priority))continue;
        routedPriorities.add(request.priority);
        const nodes=pickupNodes(c.room),routes=choices.filter(n=>n.priority===request.priority).flatMap(destination=>
            nodes.filter(node=>sourceAllowed(c,node,destination.node)).map(node=>{
            const free=Math.max(0,availableEnergy(node)-reservedSource(c,node.id)),amount=Math.min(free,capacity,destination.gap);
            // Chebyshev lengths are explicitly estimates, not measured travel.
            // Both legs and the useful load participate; storage is an ordinary
            // candidate. Overflowing mining buffers receive a pressure benefit.
            const estimate=Math.max(0,range(c,node)-1)+Math.max(0,range(node,destination.node)-1)+2;
            const pressure=node.structureType===STRUCTURE_STORAGE?0:energy(node);
            return {node,destination,free,amount,estimate,score:require('hauler-policy').routeScore(c.room,destination.priority,amount,capacity,estimate/Math.max(1,amount)/(1+pressure/1000))};
        })).filter(r=>r.amount>0).sort((a,b)=>a.score-b.score||a.estimate-b.estimate||a.node.id.localeCompare(b.node.id));
        for(const route of routes){
            if(!routePossible(c,route.node,route.destination.node))continue;
            movementCount(old?'deliverySwitches':'deliveryStarts');
            h.state='pickup';h.task={id:route.destination.node.id,source:route.node.id,room:c.room.name,routeKey:haulRouteKey(c.room,route.node,route.destination.node),amount:route.amount,
                pickupAmount:Math.min(capacity,route.free,route.node.resourceType?capacity:route.amount),priority:route.destination.priority,
                expires:Game.time+200,position:c.pos.x+','+c.pos.y,progress:Game.time,routeEstimate:route.estimate};
            return route.destination.node;
        }
    }
    clearTask(c);return null;
}
function assign(c,requests) {const result=profile('assignment',()=>assignTask(c,requests));indexCreep(c);return result;}
function retainTask(c,requests,includeStorage=true) {
    const h=haulMemory(c),task=h.task;if(!task)return null;
    const board=getBoard(c.room),request=requests===board.requests?board.requestsById.get(task.id):requests.find(n=>n.node.id===task.id);
    if(!request||!includeStorage&&request.node.structureType===STRUCTURE_STORAGE||!validDelivery(c,task)||h.origin===task.id)return null;
    if(pending(task))return request.node;
    const cargo=availableEnergy(c),funded=cargo>0,blocked=c.memory.haulBlocked||{};
    if(blocked[task.id])return null;
    const gap=n=>deliveryGap(n)-reservedDelivery(c,n.node.id,funded);
    if(requests.some(n=>n.priority<request.priority&&n.node.id!==h.origin&&!blocked[n.node.id]&&gap(n)>0))return null;
    const available=gap(request);if(available<=0)return null;
    if(funded){
        if(h.state==='pickup')return null; // optional adjacent topup keeps its existing rules
        task.amount=Math.min(task.amount,cargo,available);task.pickupAmount=0;
    }else{
        const source=task.source&&Game.getObjectById(task.source),free=source&&Math.max(0,availableEnergy(source)-reservedSource(c,source.id));
        if(!source||!free||!sourceAllowed(c,source,request.node))return null;
        task.amount=Math.min(task.amount,available,free,availableCapacity(c));
        task.pickupAmount=Math.min(availableCapacity(c),free,source.resourceType?availableCapacity(c):task.amount);
    }
    task.priority=request.priority;indexCreep(c);movementCount('haulTaskReuse');return request.node;
}
function prepare(room,extra=null) {
    const board=getBoard(room,extra,true);if(board.prepared)return board;
    board.active++;board.prepared=true;
    try{
        const requests=profile('needs',()=>cachedNeeds(room)),list=board.members.slice();
        profile('reconcile',()=>{for(const c of list)reconcile(c,requests);});
        // Current cargo keeps first claim; empty future pickup remains soft.
        list.sort((a,b)=>Number(energy(b)>0)-Number(energy(a)>0)||Number(!!b.memory.haul.task)-Number(!!a.memory.haul.task)||a.name.localeCompare(b.name));
        for(const c of list){
            if(!retainTask(c,requests))assign(c,requests);
            const h=c.memory.haul;board.preparedTasks.set(c.name,{task:h.task,state:h.state,cargo:energy(c),amount:h.task&&h.task.amount});
        }
    }finally{board.active--;finishBoard(board);}
    return board;
}
function release(c) {if(c.memory.haul){clearTask(c);delete c.memory.haul.executorTick;}}
function chooseHaulTarget(c,includeStorage=true) {
    const h=haulMemory(c);
    if(c.memory.role!=='hauler')h.executorTick=Game.time;
    // The room-level prepare pass has already reconciled and prioritized every
    // real Hauler for this tick. Reusing that assignment avoids running the
    // full destination-gap and source reservation scan once per Hauler. A
    // temporary worker still takes the immediate path below because it was not
    // necessarily present during the room pass.
    const board=getBoard(c.room,null,true);
    if(c.memory.role==='hauler'&&board.prepared){
        if(pending(h.task))return Game.getObjectById(h.task.id);
        // Share physical reconciliation with prepare. Intent capacity and
        // claims still need a cheap live check for loaded AND empty carriers.
        const requests=cachedNeeds(c.room,includeStorage),prepared=board.preparedTasks.get(c.name);
        if(!prepared||prepared.task!==h.task||prepared.state!==h.state||prepared.cargo!==energy(c)||prepared.amount!==h.task?.amount)
            profile('reconcile',()=>reconcile(c,requests));
        const retained=retainTask(c,requests,includeStorage);if(retained)return retained;
        return assign(c,requests);
    }
    const requests=cachedNeeds(c.room,includeStorage);reconcile(c,requests);
    const task=h.task;
    if(pending(task))return Game.getObjectById(task.id);
    if(task){
        const request=requests.find(n=>n.node.id===task.id),funded=availableEnergy(c)>0;
        const uncovered=n=>deliveryGap(n)-reservedDelivery(c,n.node.id,funded);
        const urgent=requests.some(n=>n.priority<request.priority&&n.node.id!==h.origin&&
            !(c.memory.haulBlocked||{})[n.node.id]&&uncovered(n)>0);
        const source=h.state==='pickup'&&Game.getObjectById(task.source);
        if(!urgent&&uncovered(request)>=task.amount&&(!source||availableEnergy(source)-reservedSource(c,source.id)>=(task.pickupAmount||0))){
            task.priority=request.priority;return request.node;
        }
    }
    return assign(c,requests);
}
function haulTarget(c,includeStorage=true) {
    if(c.memory.role!=='hauler')haulMemory(c).executorTick=Game.time;
    // Refresh the fixture/engine snapshot before marking this executor active;
    // a newly completed spawn or depleted node must invalidate a prepared plan.
    prepare(c.room,c);
    const board=getBoard(c.room,c,true);board.active++;
    try{return profile('target',()=>chooseHaulTarget(c,includeStorage));}finally{indexCreep(c,board);board.active--;finishBoard(board);}
}
function obstacleTiles(board) {
    if(!board.future){const plan=economyMemory(board.room).plan;board.future=new Set((plan&&plan.structures||[]).filter(s=>OBSTACLE_OBJECT_TYPES.includes(s.type)).map(s=>s.x+50*s.y));}
    return board.future;
}
function deliveryPorts(room,target) {
    const board=getBoard(room,null,true),cached=board.layouts.get(target.id);if(cached)return cached;
    const station=controllerStation(room),future=obstacleTiles(board);
    const seats=station?station.seats:[],ports=[];
    for(let y=target.pos.y-1;y<=target.pos.y+1;y++)for(let x=target.pos.x-1;x<=target.pos.x+1;x++){
        const p={x,y};if(walkable(room,p)&&!future.has(x+50*y)&&!seats.some(s=>range(s,p)===0))ports.push(p);
    }
    const layout={ports,preferred:station&&station.node.id===target.id?station.port:null,seats};board.layouts.set(target.id,layout);return layout;
}
function deliveryPort(c,target,task,layout) {
    const board=getBoard(c.room,c,true);
    if(!board.occupants){
        movementCount('haulPortActorScans');board.occupants=new Map();
        for(const o of roomCreeps(c.room).concat(hostiles(c.room)))if(!o.my||Game.creeps[o.name]===o){
            const key=o.pos.x+50*o.pos.y,group=board.occupants.get(key)||new Set();group.add(o.name||o.id);board.occupants.set(key,group);
        }
    }
    if(!board.portClaims){
        movementCount('haulPortClaimScans');board.portClaims=new Map();
        for(const o of carriers(c.room)){
            const t=o.memory.haul&&o.memory.haul.task;
            if(Game.creeps[o.name]!==o||!holdsDeliveryPort(o,t))continue;
            const key=t.port.x+50*t.port.y,group=board.portClaims.get(key)||new Set();group.add(o.name);board.portClaims.set(key,group);
        }
    }
    const claims=board.portClaims;
    const avoid=task.portAvoid||{};
    for(const key in avoid)if(avoid[key]<=Game.time)delete avoid[key];
    const other=group=>group&&(group.size>1||!group.has(c.name));
    const free=p=>{const key=p.x+50*p.y;return !avoid[key]&&!other(board.occupants.get(key))&&!other(claims.get(key));};
    if(task.port&&layout.ports.some(p=>range(p,task.port)===0)){
        if(free(task.port)){movementCount('portCacheHits');return task.port;}
        // A blocked hint must not hide a reachable alternate endpoint. Keep
        // bounded waiting only when all legal endpoints are occupied.
        delete task.port;board.portClaims=null;movementCount('portCacheMisses');
    }else if(task.port){delete task.port;board.portClaims=null;}
    const candidates=layout.ports.filter(free).sort((a,b)=>Number(!!layout.preferred&&range(b,layout.preferred)===0)-Number(!!layout.preferred&&range(a,layout.preferred)===0)||range(c,a)-range(c,b));
    if(!candidates.length&&layout.ports.some(p=>!avoid[p.x+50*p.y])){
        // An occupied or near-term leased port is transient contention, not an
        // unreachable room node. Keep the amount lease through a short wait.
        if(task.portWaitSince===undefined)task.portWaitSince=Game.time;
        movementCount('portCacheWaits');
    }else delete task.portWaitSince;
    for(const p of candidates){
        // Exact range zero matters: reaching a neighboring tile does not prove
        // that this unloading tile itself is reachable. Bound each path search.
        movementCount('pathSearches');
        const path=c.pos.findPathTo(new RoomPosition(p.x,p.y,c.room.name),{range:0,ignoreCreeps:false,maxRooms:1,maxOps:1000,
            costCallback(name,matrix){if(name===c.room.name)for(const seat of layout.seats)matrix.set(seat.x,seat.y,255);}});
        const end=path[path.length-1];
        if(range(c,p)===0||end&&end.x===p.x&&end.y===p.y){task.port={x:p.x,y:p.y};board.portClaims=null;task.progress=Game.time;delete c.memory._move;return task.port;}
        (task.portAvoid||(task.portAvoid={}))[p.x+50*p.y]=Game.time+15;
    }
    return null;
}
function clearStationTraffic(c,target=null) {
    const station=controllerStation(c.room);if(!station&&!target)return;
    const node=target||station.node;
    if(range(c,node)>3&&(!station||range(c,station.node)>3))return;
    const board=getBoard(c.room),plan=economyMemory(c.room).plan,layout=deliveryPorts(c.room,node),future=obstacleTiles(board);
    const endpoints=[...layout.ports,...(station?[station.port,...station.seats]:[])];
    const roads=(plan&&plan.structures||[]).filter(s=>s.type===STRUCTURE_ROAD&&range(s,node)<=2);
    const reserved=[...endpoints,...roads];
    if(!reserved.some(p=>range(c,p)===0))return;
    const peers=roomCreeps(c.room).concat(hostiles(c.room)).filter(o=>(!o.my||Game.creeps[o.name]===o)&&o.name!==c.name);
    const options=[];
    for(let y=c.pos.y-1;y<=c.pos.y+1;y++)for(let x=c.pos.x-1;x<=c.pos.x+1;x++){
        const p={x,y};if(walkable(c.room,p)&&!future.has(x+50*y)&&!endpoints.some(s=>range(s,p)===0)&&
            !peers.some(o=>range(o,p)===0||o.memory&&holdsDeliveryPort(o,o.memory.haul&&o.memory.haul.task)&&range(o.memory.haul.task.port,p)===0))options.push(p);
    }
    // Prefer parking off roads; a free outward road is still better than
    // holding the only transfer endpoint when all nearby parking is occupied.
    const p=options.sort((a,b)=>Number(roads.some(r=>range(r,a)===0))-Number(roads.some(r=>range(r,b)===0))||range(node,b)-range(node,a))[0];
    if(p)go(c,new RoomPosition(p.x,p.y,c.room.name),0,{ignoreCreeps:false});
}
function collectTask(c) {
    const h=haulMemory(c),task=h.task;
    if(!task||h.state!=='pickup'||pending(task))return !!(task&&pending(task));
    const target=Game.getObjectById(task.source);
    if(!target||!sourceAllowed(c,target,Game.getObjectById(task.id))){clearTask(c);return false;}
    const free=Math.max(0,availableEnergy(target)-reservedSource(c,target.id));
    const amount=Math.min(availableCapacity(c),free,Math.max(0,task.amount-energy(c)));
    if(!amount){if(energy(c)){h.state='deliver';task.pickupAmount=0;}else clearTask(c);return false;}
    const result=target.resourceType?c.pickup(target):c.withdraw(target,E,amount);
    if(result===OK){
        const accepted=target.resourceType?Math.min(availableCapacity(c),availableEnergy(target)):amount;
        commitEnergy(target,c,accepted);
        task.intent={kind:'pickup',at:Game.time,amount:accepted,before:energy(c)};task.pickupAmount=0;task.progress=Game.time;h.origin=target.id;
        // Drop pickup has no quantity argument. Account for its full accepted
        // amount; next tick's physical cargo reconciles engine arbitration.
        const request=cachedNeeds(c.room).find(n=>n.node.id===task.id);
        task.amount=Math.min(energy(c)+accepted,request?deliveryGap(request):task.amount);
        if(request)reclaimSoft(c,request,task.amount);
        reclaimSource(c,target);
        return true;
    }
    if(result===ERR_TIRED||c.fatigue){task.progress=Game.time;return true;}
    if(result===ERR_NOT_IN_RANGE&&profile('movement',()=>go(c,target))!==ERR_NO_PATH)return true;
    c.memory.haulPickupAvoid={id:task.source,until:Game.time+15};
    if(energy(c)){h.state='deliver';task.pickupAmount=0;}else clearTask(c);
    return false;
}
function deliverTask(c,target) {
    const id=target.id||target.name,position=c.pos.x+','+c.pos.y;
    const h=haulMemory(c),task=h.task;
    if(!task||task.id!==id||task.room!==c.room.name)return false;
    if(pending(task))return true;
    h.state='deliver';
    if(task.position!==position||c.fatigue||range(c,target)<=1){task.position=position;task.progress=Game.time;}
    // Any adjacent tile can transfer immediately, including a courier that was
    // already in range before ports were assigned. Amount leases remain intact.
    // Reservations schedule trips; once at any destination, unload everything
    // that physically fits and record the complete accepted transfer intent.
    const amount=Math.min(availableEnergy(c),availableCapacity(target));
    if(!amount){clearTask(c);return false;}
    const result=c.transfer(target,E,amount);
    if(result===OK){
        commitEnergy(c,target,amount);
        task.amount=amount;task.intent={kind:'deliver',at:Game.time,amount,before:energy(c)};task.progress=Game.time;
        const request=cachedNeeds(c.room).find(n=>n.node.id===target.id);if(request)reclaimSoft(c,request,0);
        delete task.port;delete task.portAvoid;delete task.portWaitSince;getBoard(c.room).portClaims=null;clearStationTraffic(c,target);return true;
    }
    if(result===ERR_TIRED||c.fatigue)return true;
    if(result===ERR_NOT_IN_RANGE){
        const layout=deliveryPorts(c.room,target);
        if(Game.time-task.progress>=4&&task.port){
            (task.portAvoid||(task.portAvoid={}))[task.port.x+50*task.port.y]=Game.time+15;
            delete task.port;delete c.memory._move;getBoard(c.room).portClaims=null;
        }
        // A blocked preferred tile is not a blocked energy node. Exhaust only
        // this node's at most nine legal endpoints before its bounded cooldown.
        for(let tries=0;tries<layout.ports.length;tries++){
            const port=profile('port',()=>deliveryPort(c,target,task,layout));if(!port)break;
            const moved=profile('movement',()=>go(c,new RoomPosition(port.x,port.y,c.room.name),0,{ignoreCreeps:false,
                costCallback(name,matrix){if(name===c.room.name)for(const seat of layout.seats)matrix.set(seat.x,seat.y,255);}}));
            if(moved!==ERR_NO_PATH)return true;
            (task.portAvoid||(task.portAvoid={}))[port.x+50*port.y]=Game.time+15;delete task.port;delete c.memory._move;getBoard(c.room).portClaims=null;
        }
    }
    if(task.portWaitSince!==undefined&&Game.time-task.portWaitSince<8)return true;
    c.memory.haulBlocked=c.memory.haulBlocked||{};c.memory.haulBlocked[id]=Game.time+15;clearTask(c);
    return false;
}
function collectHaul(c) {
    const board=getBoard(c.room,c,true);board.active++;
    try{return profile('pickup',()=>collectTask(c));}finally{indexCreep(c,board);board.active--;finishBoard(board);}
}
function deliverHaul(c,target) {
    const board=getBoard(c.room,c,true);board.active++;
    try{return profile('delivery',()=>deliverTask(c,target));}finally{indexCreep(c,board);board.active--;finishBoard(board);}
}
function haul(c) {
    let h=haulMemory(c),board=getBoard(c.room,null,true);
    // prepare() has already assigned every real Hauler for this tick. An empty
    // idle carrier with no task has no action to submit; avoid repeating the
    // room lookup for the common W23 idle-carrier case. Direct helper calls
    // without prepare still take the normal path for compatibility/tests.
    if(c.memory.role==='hauler'&&board&&board.prepared&&h.state==='idle'&&!h.task&&!availableEnergy(c)){clearStationTraffic(c);return;}
    let target=haulTarget(c);
    if(h.task&&pending(h.task))return;
    if(h.state==='pickup'){
        if(collectHaul(c))return;
        if(!energy(c)){clearStationTraffic(c);return;}
        target=haulTarget(c);h=haulMemory(c);
    }
    for(let attempt=0;attempt<2;attempt++){
        if(!target||!energy(c)){clearStationTraffic(c);return;}
        if(deliverHaul(c,target))return;
        target=haulTarget(c);
    }
}
module.exports={prepare,release,deliveryNeeds,validDelivery,fundedDelivery,holdsDeliveryPort,haulTarget,deliveryPorts,deliveryPort,clearStationTraffic,collectHaul,deliverHaul,haul};
