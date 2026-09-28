'use strict';
const {E,vals,range,energy,near,go,allCreeps,roomCreeps,hostiles,drops,tombstones,ruins,sources,stores}=require('runtime');
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
function validDelivery(c,task) {
    const target=task&&Game.getObjectById(task.id);
    return task&&task.room===c.room.name&&task.expires>Game.time&&Number.isInteger(task.amount)&&task.amount>0&&
        (task.sent===undefined||task.sent===Game.time)&&target&&target.structureType&&target.store&&target.store.getFreeCapacity(E)>0;
}
// Pickup plans reserve future capacity, but loaded cargo and accepted intents
// are firm. A ready carrier may reclaim only the unfunded portion of a pickup.
function fundedDelivery(c,task) {
    if(task.sent===Game.time||task.phase!=='pickup')return task.amount;
    return Math.min(task.amount,energy(c)+(task.pickupTick===Game.time?task.pickupAmount||0:0));
}
function holdsDeliveryPort(c,task) {
    return task&&task.phase==='deliver'&&task.sent===undefined&&task.port&&validDelivery(c,task)&&range(c,task.port)<=3;
}
function haulTarget(c,includeStorage=true) {
    const room=c.room,blocked=c.memory.haulBlocked||{};
    for(const id in blocked)if(blocked[id]<=Game.time)delete blocked[id];
    let task=c.memory.haulDelivery;
    if(task&&task.pickupTick<Game.time){delete task.pickupTick;delete task.pickupAmount;}
    if(!validDelivery(c,task)||task.sent!==undefined&&task.sent<Game.time||blocked[task.id]){delete c.memory.haulDelivery;task=null;}
    const capacity=energy(c)+c.store.getFreeCapacity(E);
    const ready=energy(c)>0&&(c.memory.loaded||energy(c)>=Math.ceil(capacity*.9)||task&&energy(c)>=task.amount);
    const load=ready?energy(c):capacity;
    if(task&&task.sent===undefined)task.phase=ready?'deliver':'pickup';
    const commitments=id=>allCreeps().filter(peer=>Game.creeps[peer.name]===peer&&peer.name!==c.name&&peer.memory.haulDelivery&&peer.memory.haulDelivery.id===id&&validDelivery(peer,peer.memory.haulDelivery));
    const reserved=id=>commitments(id).reduce((n,peer)=>n+(ready?fundedDelivery(peer,peer.memory.haulDelivery):peer.memory.haulDelivery.amount),0);
    const needs=deliveryNeeds(room,includeStorage).filter(n=>!blocked[n.node.id]&&n.node.id!==c.memory.withdrawnFrom)
        .map(n=>({...n,gap:Math.max(0,Math.floor(n.high-energy(n.node))),amount:Math.max(0,Math.floor(n.high-energy(n.node)-reserved(n.node.id)))})).filter(n=>n.amount>0);
    // Finish a batch inside its priority class; small normal gaps wait for the
    // next batch, while spawn/defense/controller emergency gaps remain urgent.
    needs.sort((a,b)=>a.priority-b.priority||Number(b.node.id===task?.id)-Number(a.node.id===task?.id)||range(c,a.node)-range(c,b.node));
    for(const request of needs){
        const committed=task&&request.node.id===task.id;
        if(!committed&&!near(c,[request.node]))continue;
        if(ready){
            const peers=commitments(request.node.id),claim=committed?Math.min(task.amount,load,Math.floor(request.amount)):Math.min(load,Math.floor(request.amount));
            let reclaim=Math.max(0,claim+peers.reduce((n,p)=>n+p.memory.haulDelivery.amount,0)-request.gap);
            // Only edit pickup promises after choosing this destination. Existing
            // cargo, same-tick transfers and accepted pickups cannot be stolen.
            for(const peer of peers.sort((a,b)=>range(b,request.node)-range(a,request.node))){
                if(reclaim<=0)break;
                const t=peer.memory.haulDelivery,take=Math.min(reclaim,Math.max(0,t.amount-fundedDelivery(peer,t)));
                if(!take)continue;
                t.amount-=take;reclaim-=take;
                if(t.amount<=0)delete peer.memory.haulDelivery;
            }
        }
        if(!committed){
            movementCount(task?'deliverySwitches':'deliveryStarts');
            task=c.memory.haulDelivery={id:request.node.id,room:room.name,amount:Math.min(load,Math.floor(request.amount)),priority:request.priority,
                phase:ready?'deliver':'pickup',expires:Game.time+200,position:c.pos.x+','+c.pos.y,progress:Game.time};
        }else task.amount=Math.min(task.amount,load,Math.floor(request.amount));
        return request.node;
    }
    delete c.memory.haulDelivery;return null;
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
    const promised=allCreeps().filter(o=>Game.creeps[o.name]===o&&o.name!==c.name).map(o=>({creep:o,task:o.memory.haulDelivery}))
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
            !peers.some(o=>range(o,p)===0||o.memory&&holdsDeliveryPort(o,o.memory.haulDelivery)&&range(o.memory.haulDelivery.port,p)===0))options.push(p);
    }
    // Prefer parking off roads; a free outward road is still better than
    // holding the only transfer endpoint when all nearby parking is occupied.
    const p=options.sort((a,b)=>Number(roads.some(r=>range(r,a)===0))-Number(roads.some(r=>range(r,b)===0))||range(node,b)-range(node,a))[0];
    if(p)go(c,new RoomPosition(p.x,p.y,c.room.name),0,{ignoreCreeps:false});
}
function collectHaul(c) {
    const position=c.pos.x+','+c.pos.y;
    let task=c.memory.haulPickup,target=task&&Game.getObjectById(task.id);
    if(task&&(task.position!==position||c.fatigue)){task.position=position;task.progress=Game.time;}
    const stalled=task&&Game.time-task.progress>=15;
    if(task&&(!target||task.room!==c.room.name||energy(target)<=0||stalled)){
        if(stalled)c.memory.haulPickupAvoid={id:task.id,until:Game.time+15};
        delete c.memory.haulPickup;task=null;target=null;
    }
    if(!task){
        const ss=sources(c.room),stock=stores(c.room),avoid=c.memory.haulPickupAvoid;
        const allowed=t=>(!avoid||avoid.until<=Game.time||avoid.id!==t.id)&&t.id!==c.memory.haulDelivery?.id;
        const allDrops=drops(c.room).filter(d=>d.resourceType===E&&d.amount>0);
        const boxes=stock.filter(s=>energy(s)>0&&s.structureType===STRUCTURE_CONTAINER&&ss.some(src=>range(src,s)<=1));
        const loot=tombstones(c.room).concat(ruins(c.room)).filter(s=>energy(s)>0);
        const pressure=new Map(ss.map(src=>[src.id,stock.filter(s=>s.structureType===STRUCTURE_CONTAINER&&range(src,s)<=1).reduce((n,s)=>n+energy(s),0)+allDrops.filter(d=>range(src,d)<=2).reduce((n,d)=>n+energy(d),0)]));
        const free=c.store.getFreeCapacity(E);
        const score=t=>{const src=ss.find(s=>range(s,t)<=2);return Math.min(energy(t),free)/(range(c,t)+3)*(1+(src?pressure.get(src.id):energy(t))/500);};
        const hub=linkNetwork(c.room).hub,receivers=hub&&energy(hub)>0?[hub]:[];
        const choices=allDrops.concat(boxes,loot,receivers).filter(allowed).sort((a,b)=>score(b)-score(a));
        target=choices[0]||(!energy(c)&&c.memory.haulDelivery&&c.room.storage&&energy(c.room.storage)>0&&allowed(c.room.storage)?c.room.storage:null);
        if(!target)return false;
        task=c.memory.haulPickup={id:target.id,room:c.room.name,position,progress:Game.time};
    }
    const delivery=c.memory.haulDelivery;
    if(delivery)delivery.source=target.id;
    const amount=Math.min(c.store.getFreeCapacity(E),delivery?Math.max(0,delivery.amount-energy(c)):c.store.getFreeCapacity(E));
    if(!amount)return false;
    const result=target.resourceType?c.pickup(target):c.withdraw(target,E,Math.min(amount,energy(target)));
    if(result===OK){
        c.memory.withdrawnFrom=target.id;task.progress=Game.time;
        if(delivery){delivery.pickupTick=Game.time;delivery.pickupAmount=Math.min(target.resourceType?c.store.getFreeCapacity(E):amount,energy(target));}
        return true;
    }
    if(result===ERR_NOT_IN_RANGE&&go(c,target)!==ERR_NO_PATH)return true;
    c.memory.haulPickupAvoid={id:task.id,until:Game.time+15};delete c.memory.haulPickup;return false;
}
function deliverHaul(c,target) {
    const id=target.id||target.name,position=c.pos.x+','+c.pos.y;
    const task=c.memory.haulDelivery;
    if(!task||task.id!==id||task.room!==c.room.name)return false;
    task.phase='deliver';
    if(task.position!==position||c.fatigue||range(c,target)<=1){task.position=position;task.progress=Game.time;}
    // Any adjacent tile can transfer immediately, including a courier that was
    // already in range before ports were assigned. Amount leases remain intact.
    // Reservations schedule trips; once at any destination, unload everything
    // that physically fits and record the complete accepted transfer intent.
    const amount=Math.min(energy(c),target.store.getFreeCapacity(E));
    const result=c.transfer(target,E,amount);
    if(result===OK){
        task.amount=amount;task.sent=Game.time;task.progress=Game.time;
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
    c.memory.haulBlocked=c.memory.haulBlocked||{};c.memory.haulBlocked[id]=Game.time+15;delete c.memory.haulDelivery;
    return false;
}
function haul(c) {
    if(!energy(c)){c.memory.loaded=false;delete c.memory.withdrawnFrom;}
    let target=haulTarget(c);
    const capacity=energy(c)+c.store.getFreeCapacity(E);
    if(energy(c)>0&&(energy(c)>=Math.ceil(capacity*.9)||c.memory.haulDelivery&&energy(c)>=c.memory.haulDelivery.amount))c.memory.loaded=true;
    if(c.memory.loaded)delete c.memory.haulPickup;
    if(!c.memory.loaded){
        if(collectHaul(c))return;
        if(energy(c))c.memory.loaded=true;else{clearStationTraffic(c);return;}
    }
    for(let attempt=0;attempt<2;attempt++){
        if(!target){delete c.memory.haulDelivery;clearStationTraffic(c);return;}
        if(deliverHaul(c,target))return;
        target=haulTarget(c);
    }
}
// Capacity estimates size future bodies; fueled workers keep acting every tick.
// The ledger measures actual expenditure, not these estimated duty factors.

module.exports={deliveryNeeds,validDelivery,fundedDelivery,holdsDeliveryPort,haulTarget,deliveryPorts,deliveryPort,clearStationTraffic,collectHaul,deliverHaul,haul};
