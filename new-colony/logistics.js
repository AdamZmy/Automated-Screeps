'use strict';
const {E,vals,range,energy,availableEnergy,availableCapacity,commitEnergy,near,go,allCreeps,roomCreeps,hostiles,drops,tombstones,ruins,sources,stores}=require('runtime');
const {controllerStation,upgraderAssignment,economyMemory,routeTravel,constructionJobs,walkable}=require('development');
const {linkNetwork}=require('infrastructure');
const movementCount=name=>require('metrics').movementCount(name);
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
function clearTask(c) {const h=haulMemory(c);h.task=null;h.state='idle';}
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
function carriers(room,extra=null) {
    const list=allCreeps().filter(c=>Game.creeps[c.name]===c&&!c.spawning&&c.room&&c.room.name===room.name&&
        (c.memory.role==='hauler'||c.memory.haul&&c.memory.haul.executorTick===Game.time));
    if(extra&&!list.includes(extra))list.push(extra);
    return list;
}
function deliveryGap(request) {
    // A Link or another courier may already have accepted a transfer this tick.
    const incoming=Math.max(0,request.node.store.getFreeCapacity(E)-availableCapacity(request.node));
    return Math.max(0,Math.floor(Math.min(availableCapacity(request.node),request.high-energy(request.node)-incoming)));
}
function peers(c,id) {
    return carriers(c.room).filter(p=>p!==c&&p.memory.haul&&p.memory.haul.task&&p.memory.haul.task.id===id&&validDelivery(p,p.memory.haul.task));
}
function reservedSource(c,id) {
    return carriers(c.room).filter(p=>p!==c&&p.memory.haul&&p.memory.haul.state==='pickup'&&p.memory.haul.task&&
        p.memory.haul.task.source===id&&validDelivery(p,p.memory.haul.task)&&!pending(p.memory.haul.task))
        .reduce((n,p)=>n+Math.max(0,p.memory.haul.task.pickupAmount||p.memory.haul.task.amount-energy(p)),0);
}
function pickupNodes(room) {
    const ss=sources(room),stock=stores(room),hub=linkNetwork(room).hub;
    return drops(room).filter(d=>d.resourceType===E).concat(
        stock.filter(s=>s.structureType===STRUCTURE_CONTAINER&&ss.some(src=>range(src,s)<=1)),
        tombstones(room),ruins(room),hub?[hub]:[],room.storage?[room.storage]:[])
        .filter((node,i,arr)=>availableEnergy(node)>0&&arr.findIndex(other=>other.id===node.id)===i);
}
function sourceAllowed(c,node,destination) {
    const avoid=c.memory.haulPickupAvoid;
    return !!destination&&node.id!==destination.id&&(!avoid||avoid.until<=Game.time||avoid.id!==node.id)&&
        !(node.structureType===STRUCTURE_STORAGE&&destination.structureType===STRUCTURE_STORAGE);
}
function pathLeg(from,to) {
    if(range(from,to)<=1)return {end:from.pos||from,length:0};
    const pos=from.pos||from,path=pos.findPathTo(to.pos||to,{range:1,ignoreCreeps:true,maxRooms:1,maxOps:2000});
    const end=path[path.length-1];
    return end&&range(end,to)<=1?{end:new RoomPosition(end.x,end.y,pos.roomName),length:path.length}:null;
}
function routePossible(c,source,destination) {
    const first=pathLeg(c,source);if(!first)return false;
    return !!pathLeg(first.end,destination);
}
function reconcile(c,requests) {
    const h=haulMemory(c),task=h.task,position=c.pos.x+','+c.pos.y;
    const blocked=c.memory.haulBlocked||{};
    for(const id in blocked)if(blocked[id]<=Game.time)delete blocked[id];
    if(!energy(c)&&!pending(task,'pickup'))delete h.origin;
    if(!task){h.state='idle';return;}
    if(task.intent&&task.intent.at<Game.time){
        // Do not add expected pickup or subtract expected delivery from Memory.
        // Actual next-tick cargo alone decides which phase can continue.
        if(task.intent.kind==='pickup'&&energy(c)>0)h.origin=task.source;
        delete task.intent;
    }
    if(pending(task))return;
    if(!validDelivery(c,task)||blocked[task.id]||!requests.some(n=>n.node.id===task.id&&deliveryGap(n)>0)||h.origin===task.id){clearTask(c);return;}
    task.priority=requests.find(n=>n.node.id===task.id).priority;
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
function reclaimSoft(c,request,amount) {
    const others=peers(c,request.node.id).filter(p=>!pending(p.memory.haul.task,'deliver'));
    let excess=Math.max(0,amount+others.reduce((n,p)=>n+p.memory.haul.task.amount,0)-deliveryGap(request));
    for(const p of others.sort((a,b)=>range(b,request.node)-range(a,request.node))){
        const h=p.memory.haul,t=h.task,take=Math.min(excess,Math.max(0,t.amount-fundedDelivery(p,t)));
        if(!take)continue;t.amount-=take;excess-=take;
        t.pickupAmount=Math.min(t.pickupAmount||0,Math.max(0,t.amount-energy(p)));
        if(t.amount<=0)clearTask(p);
        if(excess<=0)break;
    }
}
function reclaimSource(c,source) {
    let left=availableEnergy(source);
    for(const peer of carriers(c.room)){
        const h=peer.memory.haul,t=h&&h.task;
        if(peer===c||!t||h.state!=='pickup'||t.source!==source.id||pending(t)||!validDelivery(peer,t))continue;
        const keep=Math.min(left,Math.max(0,t.pickupAmount||t.amount-energy(peer)));left-=keep;
        t.pickupAmount=keep;t.amount=Math.min(t.amount,energy(peer)+keep);
        if(t.amount<=0)clearTask(peer);else if(!keep)h.state='deliver';
    }
}
function assign(c,requests) {
    const h=haulMemory(c),old=h.task;
    if(pending(old))return old&&Game.getObjectById(old.id);
    const cargo=availableEnergy(c),funded=cargo>0,blocked=c.memory.haulBlocked||{},capacity=availableCapacity(c);
    const choices=requests.filter(n=>!blocked[n.node.id]&&n.node.id!==h.origin)
        .map(n=>({...n,gap:Math.max(0,deliveryGap(n)-peers(c,n.node.id).reduce((sum,p)=>sum+
            (funded?fundedDelivery(p,p.memory.haul.task):pending(p.memory.haul.task,'deliver')?0:p.memory.haul.task.amount),0))}))
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
            return {node,destination,free,amount,estimate,score:estimate/Math.max(1,amount)/(1+pressure/1000)};
        })).filter(r=>r.amount>0).sort((a,b)=>a.score-b.score||a.estimate-b.estimate||a.node.id.localeCompare(b.node.id));
        for(const route of routes){
            if(!routePossible(c,route.node,route.destination.node))continue;
            movementCount(old?'deliverySwitches':'deliveryStarts');
            h.state='pickup';h.task={id:route.destination.node.id,source:route.node.id,room:c.room.name,amount:route.amount,
                pickupAmount:Math.min(capacity,route.free,route.node.resourceType?capacity:route.amount),priority:route.destination.priority,
                expires:Game.time+200,position:c.pos.x+','+c.pos.y,progress:Game.time,routeEstimate:route.estimate};
            return route.destination.node;
        }
    }
    clearTask(c);return null;
}
let preparedTick=-1,preparedRooms=new Map();
function prepare(room,extra=null) {
    if(preparedTick!==Game.time){preparedTick=Game.time;preparedRooms=new Map();}
    const old=preparedRooms.get(room.name),list=carriers(room,extra);
    if(old&&old.room===room&&old.root===Game.creeps&&(!extra||old.names.has(extra.name)))return old;
    const requests=deliveryNeeds(room),record={room,root:Game.creeps,names:new Set(list.map(c=>c.name))};
    preparedRooms.set(room.name,record);
    for(const c of list)reconcile(c,requests);
    // Current cargo gets first claim, including cargo whose old loaded flag was
    // false. Empty promises remain reclaimable until an action is accepted.
    list.sort((a,b)=>Number(energy(b)>0)-Number(energy(a)>0)||Number(!!b.memory.haul.task)-Number(!!a.memory.haul.task)||a.name.localeCompare(b.name));
    for(const c of list)assign(c,requests);
    return record;
}
function release(c) {if(c.memory.haul){clearTask(c);delete c.memory.haul.executorTick;}}
function haulTarget(c,includeStorage=true) {
    if(c.memory.role!=='hauler')haulMemory(c).executorTick=Game.time;
    prepare(c.room,c);
    const requests=deliveryNeeds(c.room,includeStorage);reconcile(c,requests);
    const h=haulMemory(c),task=h.task;
    if(pending(task))return Game.getObjectById(task.id);
    if(task){
        const request=requests.find(n=>n.node.id===task.id),funded=availableEnergy(c)>0;
        const uncovered=n=>deliveryGap(n)-peers(c,n.node.id).reduce((sum,p)=>sum+
            (funded?fundedDelivery(p,p.memory.haul.task):pending(p.memory.haul.task,'deliver')?0:p.memory.haul.task.amount),0);
        const urgent=requests.some(n=>n.priority<request.priority&&n.node.id!==h.origin&&
            !(c.memory.haulBlocked||{})[n.node.id]&&uncovered(n)>0);
        const source=h.state==='pickup'&&Game.getObjectById(task.source);
        if(!urgent&&uncovered(request)>=task.amount&&(!source||availableEnergy(source)-reservedSource(c,source.id)>=(task.pickupAmount||0))){
            task.priority=request.priority;return request.node;
        }
    }
    return assign(c,requests);
}
function deliveryPorts(room,target) {
    const station=controllerStation(room),plan=economyMemory(room).plan;
    const future=new Set((plan&&plan.structures||[]).filter(s=>OBSTACLE_OBJECT_TYPES.includes(s.type)).map(s=>s.x+50*s.y));
    const seats=station?station.seats:[],ports=[];
    for(let y=target.pos.y-1;y<=target.pos.y+1;y++)for(let x=target.pos.x-1;x<=target.pos.x+1;x++){
        const p={x,y};if(walkable(room,p)&&!future.has(x+50*y)&&!seats.some(s=>range(s,p)===0))ports.push(p);
    }
    return {ports,preferred:station&&station.node.id===target.id?station.port:null,seats};
}
function deliveryPort(c,target,task,layout) {
    const peers=roomCreeps(c.room).concat(hostiles(c.room)).filter(o=>(!o.my||Game.creeps[o.name]===o)&&o.name!==c.name);
    const promised=allCreeps().filter(o=>Game.creeps[o.name]===o&&o.name!==c.name).map(o=>({creep:o,task:o.memory.haul&&o.memory.haul.task}))
        .filter(o=>o.task&&o.task.room===c.room.name&&holdsDeliveryPort(o.creep,o.task)).map(o=>o.task.port);
    const avoid=task.portAvoid||{};
    for(const key in avoid)if(avoid[key]<=Game.time)delete avoid[key];
    const free=p=>!avoid[p.x+50*p.y]&&!peers.some(o=>range(o,p)===0)&&!promised.some(q=>range(q,p)===0);
    if(task.port&&layout.ports.some(p=>range(p,task.port)===0)&&free(task.port))return task.port;
    delete task.port;
    const candidates=layout.ports.filter(free).sort((a,b)=>Number(!!layout.preferred&&range(b,layout.preferred)===0)-Number(!!layout.preferred&&range(a,layout.preferred)===0)||range(c,a)-range(c,b));
    if(!candidates.length&&layout.ports.some(p=>!avoid[p.x+50*p.y])){
        // An occupied or near-term leased port is transient contention, not an
        // unreachable room node. Keep the amount lease through a short wait.
        if(task.portWaitSince===undefined)task.portWaitSince=Game.time;
    }else delete task.portWaitSince;
    for(const p of candidates){
        // Exact range zero matters: reaching a neighboring tile does not prove
        // that this unloading tile itself is reachable. Bound each path search.
        const path=c.pos.findPathTo(new RoomPosition(p.x,p.y,c.room.name),{range:0,ignoreCreeps:false,maxRooms:1,maxOps:1000,
            costCallback(name,matrix){if(name===c.room.name)for(const seat of layout.seats)matrix.set(seat.x,seat.y,255);}});
        const end=path[path.length-1];
        if(range(c,p)===0||end&&end.x===p.x&&end.y===p.y){task.port={x:p.x,y:p.y};task.progress=Game.time;delete c.memory._move;return task.port;}
        (task.portAvoid||(task.portAvoid={}))[p.x+50*p.y]=Game.time+15;
    }
    return null;
}
function clearStationTraffic(c,target=null) {
    const station=controllerStation(c.room);if(!station&&!target)return;
    const node=target||station.node,plan=economyMemory(c.room).plan,layout=deliveryPorts(c.room,node);
    const future=new Set((plan&&plan.structures||[]).filter(s=>OBSTACLE_OBJECT_TYPES.includes(s.type)).map(s=>s.x+50*s.y));
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
function collectHaul(c) {
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
        const request=deliveryNeeds(c.room).find(n=>n.node.id===task.id);
        task.amount=Math.min(energy(c)+accepted,request?deliveryGap(request):task.amount);
        if(request)reclaimSoft(c,request,task.amount);
        reclaimSource(c,target);
        return true;
    }
    if(result===ERR_TIRED||c.fatigue){task.progress=Game.time;return true;}
    if(result===ERR_NOT_IN_RANGE&&go(c,target)!==ERR_NO_PATH)return true;
    c.memory.haulPickupAvoid={id:task.source,until:Game.time+15};
    if(energy(c)){h.state='deliver';task.pickupAmount=0;}else clearTask(c);
    return false;
}
function deliverHaul(c,target) {
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
        const request=deliveryNeeds(c.room).find(n=>n.node.id===target.id);if(request)reclaimSoft(c,request,0);
        delete task.port;delete task.portAvoid;delete task.portWaitSince;clearStationTraffic(c,target);return true;
    }
    if(result===ERR_TIRED||c.fatigue)return true;
    if(result===ERR_NOT_IN_RANGE){
        const layout=deliveryPorts(c.room,target);
        if(Game.time-task.progress>=4&&task.port){
            (task.portAvoid||(task.portAvoid={}))[task.port.x+50*task.port.y]=Game.time+15;
            delete task.port;delete c.memory._move;
        }
        // A blocked preferred tile is not a blocked energy node. Exhaust only
        // this node's at most nine legal endpoints before its bounded cooldown.
        for(let tries=0;tries<layout.ports.length;tries++){
            const port=deliveryPort(c,target,task,layout);if(!port)break;
            const moved=go(c,new RoomPosition(port.x,port.y,c.room.name),0,{ignoreCreeps:false,
                costCallback(name,matrix){if(name===c.room.name)for(const seat of layout.seats)matrix.set(seat.x,seat.y,255);}});
            if(moved!==ERR_NO_PATH)return true;
            (task.portAvoid||(task.portAvoid={}))[port.x+50*port.y]=Game.time+15;delete task.port;delete c.memory._move;
        }
    }
    if(task.portWaitSince!==undefined&&Game.time-task.portWaitSince<8)return true;
    c.memory.haulBlocked=c.memory.haulBlocked||{};c.memory.haulBlocked[id]=Game.time+15;clearTask(c);
    return false;
}
function haul(c) {
    let target=haulTarget(c),h=haulMemory(c);
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
