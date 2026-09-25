'use strict';
const VERSION=3;
const ROAD_VERSION=1;
// Full dormant layouts live in the deployed, immutable plans module. Memory
// keeps candidate metadata; only current colonies and the active target execute
// building lists. The offline archive is built from acknowledged API snapshots.
let archive;
const archiveAttempts=new Map();
let coldMaintenanceTick=-1;
function planArchive(){
    if(archive===undefined){try{archive=require('plans');}catch(error){archive=null;}}
    return archive;
}
function executionActive(name,room){
    room=room||Game.rooms&&Game.rooms[name];
    if(room&&room.controller&&room.controller.my)return true;
    if(!room&&Memory.frontier.intel&&Memory.frontier.intel[name]&&Memory.frontier.intel[name].mine)return true;
    const target=Memory.frontier.expansion;
    return !!(target&&target.target===name&&!['complete','blocked'].includes(target.state));
}
function planSummary(plan,archiveId){
    const summary={};
    for(const field of ['version','created','complete','missing','anchor','sourcePlans','controllerSpot','counts'])if(field in plan)summary[field]=plan[field];
    summary.archiveId=archiveId;return summary;
}
function maintainColdPlans(activeRoom){
    if(coldMaintenanceTick===Game.time)return;
    coldMaintenanceTick=Game.time;
    const cpu=Game.cpu;
    if(cpu&&(cpu.bucket<2000||typeof cpu.getUsed==='function'&&cpu.getUsed()>=Math.min((cpu.limit||20)*.6,(cpu.limit||20)-4)))return;
    const saved=planArchive();if(!saved)return;
    for(const name of Object.keys(Memory.frontier.rooms)){
        const room=Game.rooms&&Game.rooms[name]||(activeRoom&&activeRoom.name===name?activeRoom:null);
        if(executionActive(name,room)||!saved.has(name))continue;
        const memory=Memory.frontier.rooms[name],plan=memory.plan;
        if(!plan||!Array.isArray(plan.structures)||Game.time<(archiveAttempts.get(name)||0))continue;
        // Full serialized equality prevents dropping changed or unacknowledged
        // plans. A mismatch is cheap thereafter and never blocks other rooms.
        archiveAttempts.set(name,Game.time+300);
        const id=saved.identify(name,plan);
        if(id)memory.plan=planSummary(plan,id);
        return; // At most one full comparison/migration per tick.
    }
}
const key=(x,y)=>x+50*y;
const dist=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
const POS=(p,r)=>new RoomPosition(p.x,p.y,r);
function getMemory(name){Memory.frontier.rooms[name]=Memory.frontier.rooms[name]||{};return Memory.frontier.rooms[name];}
function flood(terrain,start,blocked){
    const d=new Int16Array(2500),parent=new Int16Array(2500);d.fill(-1);parent.fill(-1);const queue=[];
    const k=key(start.x,start.y);d[k]=0;queue.push(k);
    for(let head=0;head<queue.length;head++){
        const i=queue[head],x=i%50,y=Math.floor(i/50);
        for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
            const xx=x+dx,yy=y+dy,j=key(xx,yy);
            if(xx<1||yy<1||xx>48||yy>48||d[j]>=0||(terrain.get(xx,yy)&TERRAIN_MASK_WALL)||blocked&&blocked.has(j))continue;
            d[j]=d[i]+1;parent[j]=i;queue.push(j);
        }
    }return {d,parent};
}
function isObstacle(s){return OBSTACLE_OBJECT_TYPES.includes(s.structureType)||s.structureType===STRUCTURE_RAMPART&&!s.my&&!s.isPublic;}
function chooseAnchor(room){
    const buildings=room.find(FIND_STRUCTURES),sites=room.find(FIND_MY_CONSTRUCTION_SITES);
    const existing=room.find(FIND_MY_SPAWNS)[0]||sites.find(s=>s.structureType===STRUCTURE_SPAWN);
    if(existing)return {x:existing.pos.x,y:existing.pos.y};
    const t=room.getTerrain(),objects=room.find(FIND_SOURCES).concat(room.controller?[room.controller]:[]);
    const natural=objects.concat(room.find(FIND_MINERALS));
    const blocked=new Set(buildings.concat(sites).filter(isObstacle).concat(natural).map(s=>key(s.pos.x,s.pos.y)));
    const reserved=new Set(buildings.concat(sites).map(s=>key(s.pos.x,s.pos.y)));
    const maps=objects.map(o=>flood(t,o.pos,blocked).d);let best=null,score=Infinity;
    for(let y=7;y<43;y++)for(let x=7;x<43;x++){
        if(t.get(x,y)&TERRAIN_MASK_WALL||reserved.has(key(x,y))||natural.some(o=>dist(o.pos,{x,y})<4))continue;
        const ds=maps.map(m=>m[key(x,y)]);if(ds.some(d=>d<0))continue;
        let open=0;for(let yy=y-4;yy<=y+4;yy++)for(let xx=x-4;xx<=x+4;xx++)if(!(t.get(xx,yy)&TERRAIN_MASK_WALL)&&!blocked.has(key(xx,yy)))open++;
        if(open<55)continue;
        const s=ds.reduce((a,d,i)=>a+d*(i===objects.length-1?1.8:1),0)-open*.15;
        if(s<score){score=s;best={x,y};}
    }return best;
}
function makePlan(room){
    const anchor=chooseAnchor(room);if(!anchor)return {version:VERSION,created:Game.time,complete:false,error:'no reachable anchor',missing:'no reachable anchor'};
    const terrain=room.getTerrain(),sources=room.find(FIND_SOURCES),ctrl=room.controller,mineral=room.find(FIND_MINERALS)[0];
    const existing=room.find(FIND_STRUCTURES).concat(room.find(FIND_MY_CONSTRUCTION_SITES));
    const items=[],occupied=new Map(),lanes=new Set(),laneLevel=new Map(),selected=new Set();
    const natural=sources.concat(ctrl?[ctrl]:[],mineral?[mineral]:[]),problems=[];
    const hard=new Set(natural.map(o=>key(o.pos.x,o.pos.y)));
    for(const s of existing){
        const k=key(s.pos.x,s.pos.y);
        if(isObstacle(s))hard.add(k);
        if(s.structureType===STRUCTURE_ROAD){lanes.add(k);laneLevel.set(k,3);}
        else if(s.structureType!==STRUCTURE_RAMPART)occupied.set(k,s.structureType);
    }
    function walk(x,y){return x>=1&&x<=48&&y>=1&&y<=48&&!(terrain.get(x,y)&TERRAIN_MASK_WALL);}
    function free(p,clear=0){return p.x>=2&&p.x<=47&&p.y>=2&&p.y<=47&&walk(p.x,p.y)&&!occupied.has(key(p.x,p.y))&&!hard.has(key(p.x,p.y))&&!lanes.has(key(p.x,p.y))&&!natural.some(o=>dist(o.pos,p)<=clear);}
    const itemKey=(type,p)=>type+':'+key(p.x,p.y);
    function add(type,p,rcl,priority,tag){
        const id=itemKey(type,p);if(selected.has(id))return items.find(i=>itemKey(i.type,i)===id);
        const i={type,x:p.x,y:p.y,rcl,priority,tag};items.push(i);selected.add(id);
        if(type!==STRUCTURE_ROAD&&type!==STRUCTURE_RAMPART)occupied.set(key(p.x,p.y),type);return i;
    }
    const unused=type=>existing.filter(s=>s.structureType===type&&!selected.has(itemKey(type,s.pos)));
    add(STRUCTURE_SPAWN,anchor,1,120,'primary');
    const matrices=()=>{
        const m=new PathFinder.CostMatrix();
        for(const k of hard)m.set(k%50,Math.floor(k/50),255);
        for(const [k,type] of occupied)if(!hard.has(k))m.set(k%50,Math.floor(k/50),type===STRUCTURE_CONTAINER?2:255);
        for(const k of lanes)if(m.get(k%50,Math.floor(k/50))!==255)m.set(k%50,Math.floor(k/50),1);
        return m;
    };
    function route(goal,r=1,level=3){
        const matrix=matrices();matrix.set(anchor.x,anchor.y,0);
        const result=PathFinder.search(POS(anchor,room.name),{pos:goal.pos||POS(goal,room.name),range:r},{maxRooms:1,maxOps:5000,plainCost:2,swampCost:5,roomCallback:()=>matrix});
        if(!result.incomplete)for(const p of result.path){const k=key(p.x,p.y);lanes.add(k);laneLevel.set(k,Math.min(laneLevel.get(k)||8,level));}
        return result;
    }
    // Reserve resource access before placing any part of the full RCL8 layout.
    function containerAt(object,range,rcl,priority,tag){
        const old=unused(STRUCTURE_CONTAINER).find(s=>dist(s.pos,object.pos)<=range);
        const path=route(old||object,old?0:range,Math.max(3,rcl));
        const p=path.path[path.path.length-1];
        if(path.incomplete||!p){problems.push(tag+' unreachable');return null;}
        if(!old&&occupied.has(key(p.x,p.y))&&occupied.get(key(p.x,p.y))!==STRUCTURE_CONTAINER){problems.push(tag+' has no free work tile');return null;}
        lanes.delete(key(p.x,p.y));add(STRUCTURE_CONTAINER,p,rcl,priority,tag);
        return {x:p.x,y:p.y,pathLength:path.path.length};
    }
    const sourcePlans=[];
    for(const source of sources){const p=containerAt(source,1,1,87,'source-'+source.id);if(p)sourcePlans.push({id:source.id,...p});}
    const controllerSpot=ctrl?containerAt(ctrl,2,2,88,'controller'):null;
    if(mineral){add(STRUCTURE_EXTRACTOR,mineral.pos,6,20,'extractor');containerAt(mineral,1,6,20,'mineral');}
    for(const s of unused(STRUCTURE_CONTAINER))add(STRUCTURE_CONTAINER,s.pos,1,20,'existing-container');
    const exitGoals=[];
    for(const direction of [FIND_EXIT_TOP,FIND_EXIT_RIGHT,FIND_EXIT_BOTTOM,FIND_EXIT_LEFT]){
        const exits=room.find(direction);if(exits.length){const mid=exits[Math.floor(exits.length/2)];exitGoals.push(mid);if(route(mid,1,4).incomplete)problems.push('exit '+direction+' unreachable');}
    }
    const candidates=[];for(let y=4;y<=45;y++)for(let x=4;x<=45;x++)if(walk(x,y))candidates.push({x,y});
    candidates.sort((a,b)=>dist(a,anchor)-dist(b,anchor)||(terrain.get(a.x,a.y)&2)-(terrain.get(b.x,b.y)&2)||a.y-b.y||a.x-b.x);
    const parity=(anchor.x+anchor.y)%2;
    function pick(type,rcl,priority,tag,filter,clear=2){
        // Reuse an existing building or site before allocating another quota slot.
        const old=unused(type)[0];
        const p=old?old.pos:candidates.find(p=>free(p,clear)&&(!filter||filter(p)));
        if(!p)return null;return add(type,p,rcl,priority,tag);
    }
    const grid=p=>(p.x+p.y)%2===parity&&dist(p,anchor)>=2;
    const storage=pick(STRUCTURE_STORAGE,4,82,'storage',grid);
    pick(STRUCTURE_TERMINAL,6,56,'terminal',p=>grid(p)&&storage&&dist(p,storage)<=3);
    pick(STRUCTURE_LINK,5,74,'hub-link',p=>grid(p)&&storage&&dist(p,storage)<=2);
    if(ctrl)pick(STRUCTURE_LINK,5,76,'controller-link',p=>dist(p,ctrl.pos)<=3&&(!controllerSpot||dist(p,controllerSpot)<=2));
    for(let n=0;n<sourcePlans.length;n++){const s=sourcePlans[n];pick(STRUCTURE_LINK,6+n,72,'source-link-'+s.id,p=>dist(p,s)<=1,0);}
    pick(STRUCTURE_SPAWN,7,105,'spawn-2',grid);pick(STRUCTURE_SPAWN,8,105,'spawn-3',grid);
    pick(STRUCTURE_FACTORY,7,40,'factory',grid);pick(STRUCTURE_OBSERVER,8,25,'observer',grid);
    pick(STRUCTURE_POWER_SPAWN,8,20,'powerSpawn',grid);pick(STRUCTURE_NUKER,8,15,'nuker',grid);
    // Ten labs, with all eight outputs within range two of both input labs.
    const labOffsets=[[0,0],[1,1],[-1,-1],[-1,0],[-1,1],[0,-1],[1,2],[2,0],[2,1],[2,2]];
    const oldLabs=unused(STRUCTURE_LAB);let labOrigin;
    for(const p of candidates){
        if(dist(p,anchor)<5||dist(p,anchor)>17)continue;
        const labTiles=new Set(labOffsets.map(d=>key(p.x+d[0],p.y+d[1])));
        if(oldLabs.some(s=>!labTiles.has(key(s.pos.x,s.pos.y))))continue;
        let ok=true;
        for(let dx=-1;dx<=2;dx++)for(let dy=-1;dy<=2;dy++){
            const at={x:p.x+dx,y:p.y+dy};
            const k=key(at.x,at.y),oldLab=oldLabs.some(s=>s.pos.x===at.x&&s.pos.y===at.y);
            const oldAisle=!labTiles.has(k)&&walk(at.x,at.y)&&!occupied.has(k)&&!hard.has(k)&&!natural.some(o=>dist(o.pos,at)<=2);
            if(!free(at,2)&&!oldLab&&!oldAisle)ok=false;
        }
        if(ok){labOrigin=p;break;}
    }
    if(labOrigin){
        labOffsets.forEach((d,i)=>add(STRUCTURE_LAB,{x:labOrigin.x+d[0],y:labOrigin.y+d[1]},i<3?6:i<6?7:8,35,i<2?'lab-input-'+i:'lab-output-'+i));
        for(let dx=-1;dx<=2;dx++)for(let dy=-1;dy<=2;dy++){const k=key(labOrigin.x+dx,labOrigin.y+dy);if(!occupied.has(k)){lanes.add(k);laneLevel.set(k,6);}}
    }else{problems.push('lab stamp unavailable');oldLabs.forEach((s,i)=>add(STRUCTURE_LAB,s.pos,i<3?6:i<6?7:8,35,'existing-lab'));}
    [3,5,7,8,8,8].forEach((rcl,i)=>pick(STRUCTURE_TOWER,rcl,100,'tower-'+i,grid));
    for(let n=0;n<60;n++)pick(STRUCTURE_EXTENSION,n<5?2:n<10?3:n<20?4:n<30?5:n<40?6:n<50?7:8,90,'extension-'+n,grid);
    for(let n=sourcePlans.length+2;n<6;n++)pick(STRUCTURE_LINK,8,40,'link-extra-'+n,grid);
    // One room traversal supplies every final access path (instead of ~90 PathFinder calls).
    const blocked=new Set(hard);
    for(const [k,type] of occupied)if(type!==STRUCTURE_CONTAINER)blocked.add(k);
    let accessStart;
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const p={x:anchor.x+dx,y:anchor.y+dy};if(walk(p.x,p.y)&&!blocked.has(key(p.x,p.y)))accessStart=p;}
    const access=accessStart?flood(terrain,accessStart,blocked):{d:new Int16Array(2500).fill(-1),parent:new Int16Array(2500).fill(-1)};
    if(!accessStart)problems.push('spawn exit blocked');
    function connect(p,range,level,label){
        let best=-1;
        for(let dx=-range;dx<=range;dx++)for(let dy=-range;dy<=range;dy++){
            const x=p.x+dx,y=p.y+dy,k=key(x,y);
            if(x<1||x>48||y<1||y>48||blocked.has(k)||access.d[k]<0)continue;
            if(best<0||access.d[k]<access.d[best])best=k;
        }
        if(best<0){problems.push(label+' unreachable');return;}
        for(let k=best;k>=0;k=access.parent[k]){
            lanes.add(k);laneLevel.set(k,Math.min(laneLevel.get(k)||8,level));
        }
    }
    for(const i of items)if(i.tag!=='primary')connect(i,i.type===STRUCTURE_CONTAINER?0:1,Math.max(3,i.rcl),i.tag);
    // A claimer needs range one even though the upgrader container uses range two.
    if(ctrl)connect(ctrl.pos,1,3,'controller claim access');
    for(const goal of exitGoals)connect(goal,1,4,'exit');
    for(const k of lanes){const x=k%50,y=Math.floor(k/50);if(walk(x,y)&&!occupied.has(k)&&!hard.has(k))add(STRUCTURE_ROAD,{x,y},laneLevel.get(k)||3,30,'road');}
    const critical=items.filter(i=>[STRUCTURE_SPAWN,STRUCTURE_STORAGE,STRUCTURE_TERMINAL,STRUCTURE_TOWER].includes(i.type));
    for(const i of critical)add(STRUCTURE_RAMPART,i,Math.max(3,i.rcl),18,'critical-rampart');
    for(let x=anchor.x-10;x<=anchor.x+10;x++)for(let y=anchor.y-10;y<=anchor.y+10;y++)if(Math.max(Math.abs(x-anchor.x),Math.abs(y-anchor.y))===10&&x>=2&&x<=47&&y>=2&&y<=47&&walk(x,y)&&!hard.has(key(x,y)))add(STRUCTURE_RAMPART,{x,y},5,8,'perimeter');
    const counts={};for(const i of items)counts[i.type]=(counts[i.type]||0)+1;
    const required={spawn:3,extension:60,lab:10,tower:6,storage:1,terminal:1,link:6,factory:1,observer:1,powerSpawn:1,nuker:1};
    for(const type in required)if(counts[type]!==required[type])problems.push(type+' capacity incomplete');
    for(let rcl=1;rcl<=8;rcl++){
        const byType={};for(const i of items)if(i.rcl<=rcl)byType[i.type]=(byType[i.type]||0)+1;
        for(const type in byType)if(byType[type]>(CONTROLLER_STRUCTURES[type][rcl]||0))problems.push(type+' exceeds RCL'+rcl+' limit');
    }
    if(sourcePlans.length!==sources.length)problems.push('source access incomplete');
    return classifyRoads(room,{version:VERSION,created:Game.time,anchor,sourcePlans,controllerSpot,structures:items,counts,complete:problems.length===0,missing:problems.length?Array.from(new Set(problems)).join('; '):null});
}
// Classify the existing layout in place: migrating roads never relocates buildings.
function classifyRoads(room,plan){
    if(!plan.structures||!plan.anchor)return plan;
    const terrain=room.getTerrain(),roads=new Map(),passable=new Set(),blocked=new Set();
    for(const s of room.find(FIND_STRUCTURES).concat(room.find(FIND_MY_CONSTRUCTION_SITES)))if(isObstacle(s))blocked.add(key(s.pos.x,s.pos.y));
    for(const s of room.find(FIND_SOURCES).concat(room.find(FIND_MINERALS),room.controller?[room.controller]:[]))blocked.add(key(s.pos.x,s.pos.y));
    for(const item of plan.structures){
        const k=key(item.x,item.y);
        if(item.type===STRUCTURE_ROAD){
            item.roadClass='access';item.sourceIds=[];item.roadSwamp=!!(terrain.get(item.x,item.y)&TERRAIN_MASK_SWAMP);
            item.rcl=Math.max(4,item.rcl);item.priority=30;delete item.roadOrder;roads.set(k,item);
        }
        if(item.type===STRUCTURE_ROAD){if(!blocked.has(k)&&!(terrain.get(item.x,item.y)&TERRAIN_MASK_WALL))passable.add(k);}
        else if(OBSTACLE_OBJECT_TYPES.includes(item.type))blocked.add(k);
        if(item.type===STRUCTURE_CONTAINER&&(item.tag==='controller'||item.tag.startsWith('source-')))item.priority=96;
    }
    for(const k of blocked)passable.delete(k);
    // All routes share one walkable core tile, so source-to-controller traffic is paved too.
    const parent=new Map(),queue=[],focus=plan.controllerSpot||plan.anchor;
    const core=Array.from(roads.values()).filter(p=>passable.has(key(p.x,p.y))&&dist(p,plan.anchor)<=1)
        .sort((a,b)=>dist(a,focus)-dist(b,focus)||key(a.x,a.y)-key(b.x,b.y))[0];
    if(core){const k=key(core.x,core.y);parent.set(k,-1);queue.push(k);plan.roadCore={x:core.x,y:core.y};}
    for(let i=0;i<queue.length;i++){
        const k=queue[i],x=k%50,y=Math.floor(k/50);
        for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
            const xx=x+dx,yy=y+dy,n=key(xx,yy);
            if(xx<1||xx>48||yy<1||yy>48||!passable.has(n)||parent.has(n))continue;
            parent.set(n,k);queue.push(n);
        }
    }
    const goals=(plan.sourcePlans||[]).map(p=>({id:'source:'+p.id,kind:'source',sourceId:p.id,pos:p}));
    if(plan.controllerSpot)goals.push({id:'controller',kind:'controller',pos:plan.controllerSpot});
    plan.roadRoutes=[];plan.roadMissing=[];
    for(const goal of goals){
        // Haulers withdraw/transfer at range one; do not pave the miner's occupied tile.
        const end=queue.find(k=>roads.has(k)&&dist(roads.get(k),goal.pos)<=1),tiles=[];
        if(end!==undefined)for(let k=end;k!==-1;k=parent.get(k))if(roads.has(k))tiles.push(k);
        const route={id:goal.id,kind:goal.kind,tiles,complete:end!==undefined,length:tiles.length,swampTiles:0};
        if(goal.sourceId)route.sourceId=goal.sourceId;
        if(!route.complete)plan.roadMissing.push(goal.id);
        tiles.forEach((k,index)=>{
            const item=roads.get(k);item.roadClass='economy';item.rcl=2;item.priority=94;
            item.roadOrder=Math.min(item.roadOrder===undefined?Infinity:item.roadOrder,index);
            if(goal.sourceId&&!item.sourceIds.includes(goal.sourceId))item.sourceIds.push(goal.sourceId);
            if(item.roadSwamp)route.swampTiles++;
        });
        plan.roadRoutes.push(route);
    }
    plan.roadVersion=ROAD_VERSION;return plan;
}
function ensure(room){
    const m=getMemory(room.name);
    if(m.plan&&m.plan.archiveId&&!Array.isArray(m.plan.structures)){
        // Scouts and candidate scoring need only the summary. Incomplete cold
        // archives stay ineligible; they do not trigger full-room work on visit.
        if(!executionActive(room.name,room))return m.plan;
        const saved=planArchive(),restored=saved&&saved.load(room.name,m.plan.archiveId);
        // Missing archives cannot strand a new colony waiting for Codex. Only
        // this activated room replans once, then uses the normal retry policy.
        m.plan=restored||makePlan(room);
    }
    // A blocked active survey must recover if its obstructions later disappear.
    if(!m.plan||m.plan.version!==VERSION||!m.plan.complete&&Game.time-(m.plan.created||0)>=500)m.plan=makePlan(room);
    if(m.plan.roadVersion!==ROAD_VERSION)classifyRoads(room,m.plan);
    return m.plan;
}
function build(room,plan){
    if(!plan.structures||!room.controller||!room.controller.my)return;
    const level=room.controller.level;
    const structures=room.find(FIND_STRUCTURES),sites=room.find(FIND_MY_CONSTRUCTION_SITES);
    let slots=Math.min(5,8-sites.length,90-Object.keys(Game.constructionSites).length);if(slots<=0)return;
    const count={},at=new Map(),siteTiles=new Set(sites.map(s=>key(s.pos.x,s.pos.y)));
    for(const s of structures.concat(sites)){count[s.structureType]=(count[s.structureType]||0)+1;const k=key(s.pos.x,s.pos.y);if(!at.has(k))at.set(k,[]);at.get(k).push(s.structureType);}
    let roadSlots=Math.max(0,3-sites.filter(s=>s.structureType===STRUCTURE_ROAD).length);
    const builtRoads=new Set(structures.filter(s=>s.structureType===STRUCTURE_ROAD).map(s=>key(s.pos.x,s.pos.y)));
    const economyPending=plan.structures.some(i=>i.type===STRUCTURE_ROAD&&i.roadClass==='economy'&&!builtRoads.has(key(i.x,i.y)));
    const sorted=plan.structures.slice().sort((a,b)=>b.priority-a.priority||
        (a.type===STRUCTURE_ROAD&&b.type===STRUCTURE_ROAD?(Number(b.roadSwamp)-Number(a.roadSwamp)||Number(!!(b.sourceIds&&b.sourceIds.length))-Number(!!(a.sourceIds&&a.sourceIds.length))||(a.roadOrder||0)-(b.roadOrder||0)):0)||a.rcl-b.rcl);
    for(const item of sorted){
        if(slots<=0)break;if(item.rcl>level)continue;
        if(item.type===STRUCTURE_ROAD){
            if(roadSlots<=0)continue;
            if(item.roadClass!=='economy'&&(economyPending||level<4||!room.storage||room.storage.store[RESOURCE_ENERGY]<20000))continue;
        }
        if(item.type===STRUCTURE_RAMPART&&(!room.storage||room.storage.store[RESOURCE_ENERGY]<10000))continue;
        if([STRUCTURE_LAB,STRUCTURE_FACTORY,STRUCTURE_NUKER,STRUCTURE_POWER_SPAWN,STRUCTURE_EXTRACTOR].includes(item.type)&&(!room.storage||room.storage.store[RESOURCE_ENERGY]<40000))continue;
        const k=key(item.x,item.y),here=at.get(k)||[];
        if(here.includes(item.type)||siteTiles.has(k))continue;
        // Roads, containers and ramparts may coexist; other occupied tiles must wait.
        if(here.some(type=>type!==STRUCTURE_RAMPART&&item.type!==STRUCTURE_RAMPART&&!(type===STRUCTURE_ROAD&&item.type===STRUCTURE_CONTAINER)&&!(type===STRUCTURE_CONTAINER&&item.type===STRUCTURE_ROAD)))continue;
        const limit=CONTROLLER_STRUCTURES[item.type][level]||0;if((count[item.type]||0)>=limit)continue;
        const result=room.createConstructionSite(item.x,item.y,item.type);
        if(result===OK){count[item.type]=(count[item.type]||0)+1;siteTiles.add(k);slots--;if(item.type===STRUCTURE_ROAD)roadSlots--;}
    }
}
module.exports={ensure,makePlan,chooseAnchor,run(room){
    const p=ensure(room);
    if(Game.time%10===0)build(room,p);
    if(Memory.frontier.showPlan&&p.structures)for(const s of p.structures){if(s.rcl>(Memory.frontier.planViewRcl||8))continue;room.visual.circle(s.x,s.y,{radius:s.type===STRUCTURE_ROAD?.08:.24,fill:room.controller&&s.rcl<=room.controller.level?'#6ce7a3':'#7593b8',opacity:.25,stroke:'transparent'});}
    maintainColdPlans(room);
}};
