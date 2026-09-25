#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {makeRuntime,constants:C,K,P,D,range,adjacent,Pos,Matrix}=require('./runtime.cjs');
const root=path.resolve(__dirname,'../..');
const worldPath=path.resolve(process.argv[2]||path.join(__dirname,'fixtures/world-W21N26.json'));
const priorPath=path.resolve(process.argv[3]||path.join(__dirname,'fixtures/prior-plan-W21N26.json'));
const outputPath=path.resolve(process.argv[4]||path.join(__dirname,'candidate-W21N26.json'));
const world=JSON.parse(fs.readFileSync(worldPath)),old=JSON.parse(fs.readFileSync(priorPath));
const isWall=p=>!!(Number(world.terrain[K(p)])&1), natural=[...world.objects.sources,world.objects.controller,world.objects.mineral],naturalKeys=new Set(natural.map(K));
const built=world.structures.filter(s=>s.type!=='controller').concat(world.constructionSites||[]);
const coreTypes=new Set(['spawn','extension','storage','terminal','factory','lab','tower','observer','powerSpawn','nuker']);
const priority={spawn:105,extension:90,storage:82,terminal:56,factory:40,lab:35,tower:100,link:74,container:96,extractor:20,observer:25,powerSpawn:20,nuker:15,road:30,rampart:12};
const spawn=built.find(s=>s.type==='spawn');assert(spawn,'A fixed main spawn is required');
function flood(starts,blocked=new Set()){
 const d=new Int16Array(2500).fill(-1),queue=[];for(const p of starts){const k=K(p);if(isWall(p)||blocked.has(k))continue;d[k]=0;queue.push(k)}
 for(let h=0;h<queue.length;h++)for(const p of adjacent(P(queue[h]))){const k=K(p);if(isWall(p)||blocked.has(k)||d[k]>=0)continue;d[k]=d[queue[h]]+1;queue.push(k)}return {d,queue};
}
const builtObstacle=new Set([...built.filter(s=>C.OBSTACLE_OBJECT_TYPES.includes(s.type)),...natural].map(K));
const initialDist=flood(adjacent(spawn),builtObstacle).d;
function makeCandidate(radius,phase){
 const rt=makeRuntime(world),p=new rt.CommunePlanner({}),items=[],at=new Map(),counts={},reserved=new Set();
 p.room=rt.room;p.roomManager={isStartRoom:()=>true};p.terrainCoords=new Uint8Array(2500);p.baseCoords=new Uint8Array(2500);p.roadCoords=new Uint8Array(2500);p.byExitCoords=new Uint8Array(2500);p.byPlannedRoad=new Uint8Array(2500);
 p.stampAnchors={};for(const k of Object.keys(rt.context.stamps))p.stampAnchors[k]=[];
 p.stampAnchors.fastFiller=[new Pos(spawn.x+(phase%2),spawn.y+Math.floor(phase/2),world.name)];
 p.centerUpgradePos=new Pos(old.controllerSpot.x,old.controllerSpot.y,world.name);p.communeSources=rt.sources;
 p.stampAnchors.sourceExtension=[];
 // Existing extension count replaces only the fast-filler quota; we do not build its incompatible stamp.
 rt.context.stamps.fastFiller.structures.extension=Array.from({length:built.filter(s=>s.type==='extension').length},()=>({x:0,y:0}));
 const knownOld=new Map(old.structures.map(s=>[`${s.type}:${K(s)}`,s]));
 function add(type,x,y,rcl,tag,extra={}){
  const pos={x,y},k=K(pos),same=at.get(k)||[],existing=same.find(s=>s.type===type);if(existing){existing.rcl=Math.min(existing.rcl,rcl||8);return existing}
  if(type!=='extractor'&&(isWall(pos)||naturalKeys.has(k)))throw Error(`natural collision ${type} ${x},${y}`);
  if(same.some(s=>s.type!=='rampart'&&type!=='rampart'&&!(s.type==='road'&&type==='container')&&!(s.type==='container'&&type==='road')))throw Error(`overlap ${type} ${x},${y} ${same.map(s=>s.type)}`);
  counts[type]=(counts[type]||0)+1;if(rcl===undefined){rcl=1;while(rcl<=8&&C.CONTROLLER_STRUCTURES[type][rcl]<counts[type])rcl++;}
  if(rcl>8)throw Error(`over quota ${type} ${counts[type]}`);
  const v={type,x,y,rcl,priority:priority[type]||20,tag:tag||`${type}-${counts[type]-1}`,...extra};items.push(v);same.push(v);at.set(k,same);return v;
 }
 for(let x=0;x<50;x++)for(let y=0;y<50;y++){const i=x*50+y,k=x+y*50;const no=isWall({x,y})||naturalKeys.has(k);p.terrainCoords[i]=no?255:0;if(no||x<3||y<3||x>46||y>46||initialDist[k]<0||initialDist[k]>radius)p.baseCoords[i]=255;}
 const locked=[];
 for(const b of built){const prior=knownOld.get(`${b.type}:${K(b)}`);const v=add(b.type,b.x,b.y,prior?.rcl||3,prior?.tag||`retained-${b.type}`,{locked:true});locked.push(v);
  if(b.type==='road')p.roadCoords[b.x*50+b.y]=1;else {p.baseCoords[b.x*50+b.y]=255;p.roadCoords[b.x*50+b.y]=b.type==='container'?20:255;}}
 const sourcePlans=old.sourcePlans.map(s=>({...s}));
 const roadCore=old.roadCore||{x:21,y:27};
 const standSpots=[...sourcePlans,p.centerUpgradePos];standSpots.forEach(q=>reserved.add(K(q)));
 const longest=[...sourcePlans].sort((a,b)=>initialDist[K(b)]-initialDist[K(a)]),far=longest[0],near=longest[1];
 const canPlace=q=>q.x>1&&q.y>1&&q.x<48&&q.y<48&&!isWall(q)&&!naturalKeys.has(K(q))&&!at.has(K(q))&&!reserved.has(K(q));
 function chooseNear(stand,type){const options=adjacent(stand).filter(canPlace).sort((a,b)=>initialDist[K(a)]-initialDist[K(b)]||D(a,spawn)-D(b,spawn)||K(a)-K(b));if(!options.length)throw Error('No '+type+' near '+JSON.stringify(stand));return options[0]}
 const farLinkPos=chooseNear(far,'far-link');const farLink=add('link',farLinkPos.x,farLinkPos.y,5,`source-link-${far.id}`,{linkRole:'source',sourceId:far.id,flow:'sender',targetTag:'controller-link',fallbackTargetTag:'hub-link',label:'远矿发送 Link',purpose:'由远矿固定矿工直接装载，优先发送控制器；其余发送核心以替代长途搬运。',serviceArea:'远矿矿工与核心/控制器链路',serviceSpot:{x:far.x,y:far.y}});
 const ctrlPos=chooseNear(p.centerUpgradePos,'controller-link');const ctrlLink=add('link',ctrlPos.x,ctrlPos.y,6,'controller-link',{linkRole:'controller',flow:'receiver',label:'控制器接收 Link',purpose:'接收源端能量，供固定升级位取能；不作为搬运工填充目标。',serviceArea:'控制器升级区',serviceSpot:{x:p.centerUpgradePos.x,y:p.centerUpgradePos.y}});
 for(const s of [farLink,ctrlLink]){p.baseCoords[s.x*50+s.y]=255;p.roadCoords[s.x*50+s.y]=255;}
 const nearLinkPos=chooseNear(near,'optional-near-link');reserved.add(K(nearLinkPos));p.baseCoords[nearLinkPos.x*50+nearLinkPos.y]=255;p.roadCoords[nearLinkPos.x*50+nearLinkPos.y]=255;
 const mineral=world.objects.mineral,priorMineral=old.structures.find(s=>s.tag==='mineral');
 const mineralPos=priorMineral&&canPlace(priorMineral)?priorMineral:adjacent(mineral).filter(canPlace).sort((a,b)=>initialDist[K(a)]-initialDist[K(b)])[0];if(!mineralPos)throw Error('No mineral station');
 add('extractor',mineral.x,mineral.y,6,'extractor');add('container',mineralPos.x,mineralPos.y,6,'mineral',{purpose:'矿物采集站'});p.baseCoords[mineralPos.x*50+mineralPos.y]=255;p.roadCoords[mineralPos.x*50+mineralPos.y]=20;
 // Reserve real economic paths before any new buildings; existing routes remain exactly retained.
 const reserveCM=new Matrix();for(const n of natural)reserveCM.set(n.x,n.y,255);for(const s of items)if(C.OBSTACLE_OBJECT_TYPES.includes(s.type))reserveCM.set(s.x,s.y,255);
 for(const q of standSpots)if(!at.get(K(q))?.some(s=>s.type==='road'))reserveCM.set(q.x,q.y,20);
 for(const goal of standSpots){const r=rt.search(new Pos(roadCore.x,roadCore.y,world.name),{pos:goal,range:1},reserveCM,{plainCost:1,swampCost:1});if(r.incomplete)throw Error('Economic route blocked');for(const q of r.path){if(at.get(K(q))?.some(s=>s.type==='container'))continue;add('road',q.x,q.y,2,`economy-reserved`,{purpose:'源矿/控制器共同经济干线'});p.roadCoords[q.x*50+q.y]=1;}}
 p.setBasePlansXY=(x,y,type,rcl)=>{const v=add(type,x,y,rcl);return v.rcl};
 const originalExits=rt.room.roomManager.exitCoords;p.exitCoords=[...originalExits].map(s=>rt.context.unpackCoord(s));
 for(const e of p.exitCoords)for(const q of range(e.x,e.y,1))p.byExitCoords[q.x*50+q.y]=255;
 // Upstream grid grouping / connector paths / pruning retained; suppress unrequested exit-group seeds.
 rt.room.roomManager.exitCoords=new Set();p.generateGrid();rt.room.roomManager.exitCoords=originalExits;
 for(const s of items.filter(s=>s.type==='road'))for(const q of adjacent(s)){if(!p.gridCoords[q.x*50+q.y]&&p.baseCoords[q.x*50+q.y]!==255)p.byPlannedRoad[q.x*50+q.y]=1;}
 // True terrain walking distance is an adapter hard constraint, rather than Chebyshev ordering across mountains.
 p._reverseExitFlood=new Uint32Array(2500);for(let x=0;x<50;x++)for(let y=0;y<50;y++){const d=initialDist[x+y*50];p._reverseExitFlood[x*50+y]=d<0?60000:d*12;}
 const baseViable=p.isViableDynamicStampAnchor.bind(p);
 p.isViableDynamicStampAnchor=(args,q)=>!reserved.has(K(q))&&baseViable(args,q);
 if(p.hub()!=='success')throw Error('upstream hub failed');
 const hubSpot=p.stampAnchors.hub[0];reserved.add(K(hubSpot));const storage=items.find(s=>s.type==='storage'),hub=items.find(s=>s.type==='link'&&s!==farLink&&s!==ctrlLink);
 Object.assign(storage,{tag:'storage',label:'核心仓库'});Object.assign(hub,{tag:'hub-link',rcl:5,linkRole:'hub',flow:'receiver',label:'核心接收 Link',purpose:'接收远矿或已启用入口来能，由相邻核心工位移入Storage或供给本地。',serviceArea:'核心储存/补能区',serviceSpot:{x:hubSpot.x,y:hubSpot.y},serviceMode:'adjacent-link-storage-transfer'});
 // Hub's dedicated bay cannot be used as a through-road, and its cardinal buildings must avoid retained roads.
 if(at.get(K(hubSpot))?.some(s=>s.type==='road'))throw Error('hub bay overlaps economic road');
 if(p.labs()!=='success')throw Error('upstream labs failed');
 const labs=items.filter(s=>s.type==='lab');labs.forEach((s,i)=>{s.tag=i<2?'lab-input-'+i:'lab-output-'+i;s.rcl=i<3?6:i<6?7:8;});
 function dynamic(type,count,rcl,tagPrefix){const stampName='adapter-'+type;p.stampAnchors[stampName]=[];rt.context.stamps[stampName]={...rt.context.stamps.gridExtension};return p.planStamps({stampType:stampName,count,startCoords:[p.stampAnchors.hub[0]],dynamic:true,weighted:true,dynamicWeight:p._reverseExitFlood,conditions:q=>p.byPlannedRoad[q.x*50+q.y]===1&&p.gridCoords[q.x*50+q.y]===0,consequence:q=>{add(type,q.x,q.y,typeof rcl==='function'?rcl(counts[type]||0):rcl,`${tagPrefix}-${counts[type]||0}`);p.baseCoords[q.x*50+q.y]=255;p.roadCoords[q.x*50+q.y]=255;}})}
 if(dynamic('spawn',2,n=>n===1?7:8,'spawn')!=='success')throw Error('spawn placement');
 if(dynamic('tower',5,n=>n===1?5:n===2?7:8,'tower')!=='success')throw Error('tower placement');
 for(const method of ['observer','nuker','powerSpawn'])if(p[method]()!=='success')throw Error(method+' placement');
 if(p.gridExtensions()!=='success')throw Error('upstream extensions failed');
 // Full actual obstacle geometry for the upstream road planner. Optional positions and hub worker bay stay free.
 const blocked=new Set([...natural,...items.filter(s=>C.OBSTACLE_OBJECT_TYPES.includes(s.type))].map(K));
 const roadPlanner=Object.create(rt.RoadPlanner.prototype);roadPlanner.colony={name:world.name,roomNames:[world.name],print:world.name};roadPlanner.costMatrices={};
 rt.room.find=type=>type===C.FIND_STRUCTURES?items.filter(s=>C.OBSTACLE_OBJECT_TYPES.includes(s.type)).map(s=>({pos:new Pos(s.x,s.y,world.name),isWalkable:false})):[];
 const originalMatrix=roadPlanner.generateRoadPlanningCostMatrix.bind(roadPlanner);
 roadPlanner.generateRoadPlanningCostMatrix=(name,obstacles)=>{const cm=originalMatrix(name,obstacles);for(let k=0;k<2500;k++){const q=P(k);if(isWall(q)||naturalKeys.has(k)||reserved.has(k))cm.set(q.x,q.y,255)}for(const s of items.filter(s=>s.type==='road'))if(cm.get(s.x,s.y)!==255)cm.set(s.x,s.y,2);return cm;};
 const obstacles=[...items.filter(s=>C.OBSTACLE_OBJECT_TYPES.includes(s.type)),...natural].map(s=>new Pos(s.x,s.y,world.name));
 const routes=[];const targetList=[...sourcePlans.map(s=>({pos:s,id:'source:'+s.id,kind:'source',sourceId:s.id,rcl:2,purpose:'矿边容器至核心的经济道路'})),{pos:p.centerUpgradePos,id:'controller',kind:'controller',rcl:2,purpose:'控制器升级站至核心的经济道路'},...items.filter(s=>coreTypes.has(s.type)||s.type==='link').map(s=>({pos:s,id:'service:'+s.tag,kind:'service',rcl:Math.max(4,s.rcl),purpose:'核心建筑服务道路',toTag:s.tag})),{pos:mineralPos,id:'mineral',kind:'mineral',rcl:6,purpose:'矿物采集站服务道路'}];
 const protection=new Map();const addProtection=(q,pad=1)=>{for(const n of range(q.x,q.y,pad))if(!isWall(n)&&n.x>1&&n.y>1&&n.x<48&&n.y<48)protection.set(K(n),n);};
 for(const s of items.filter(s=>coreTypes.has(s.type)||s.tag==='hub-link'))addProtection(s,3);addProtection(hubSpot);addProtection(roadCore);
 for(const target of targetList){const pathFound=roadPlanner.generateRoadPath(new Pos(roadCore.x,roadCore.y,world.name),new Pos(target.pos.x,target.pos.y,world.name),obstacles);if(!pathFound)throw Error('upstream road failed '+target.id);
  const routeTiles=[{...roadCore},...pathFound];const economic=target.kind==='source'||target.kind==='controller';
  for(const q of routeTiles){if(at.get(K(q))?.some(s=>s.type==='container'))continue;const road=add('road',q.x,q.y,economic?2:target.rcl,`road-${target.kind}`,{});road.purposes=[...new Set([...(road.purposes||[]),target.id])];road.purpose=road.purposes.join(', ');if(economic){road.roadClass='economy';road.priority=94;road.rcl=2;road.sourceIds=[...new Set([...(road.sourceIds||[]),...(target.sourceId?[target.sourceId]:[])])];}}
  routes.push({id:target.id,kind:target.kind,tiles:routeTiles.map(K).reverse(),length:routeTiles.length,complete:true,swampTiles:routeTiles.filter(q=>Number(world.terrain[K(q)])&2).length,sourceId:target.sourceId,purpose:target.purpose,fromTag:'road-core',toTag:target.toTag});
  if(target.kind==='service'&&!target.id.startsWith('service:source-link-')||target.kind==='controller')for(const q of routeTiles)addProtection(q);
 }
 // Protect every actual core service path together; a roof on an isolated pocket is insufficient.
 const cm=new Matrix();for(let k=0;k<2500;k++){const q=P(k);cm.set(q.x,q.y,isWall(q)?255:1)}for(const q of protection.values())cm.set(q.x,q.y,254);
 const cut=rt.minCutToExit([...protection.values()],cm);for(const q of cut){if(naturalKeys.has(K(q)))throw Error('mincut on natural object');add('rampart',q.x,q.y,4,'perimeter-mincut',{purpose:'International最小割连续核心防线'});}
 // No private-structure roof is used to fake perimeter safety.
 for(const s of items.filter(s=>s.type==='road')){s.roadClass=s.roadClass||'access';s.sourceIds=s.sourceIds||[];s.roadSwamp=!!(Number(world.terrain[K(s)])&2);if(s.roadClass==='access'){s.rcl=Math.max(4,s.rcl);s.priority=30}if(s.locked&&!s.purpose)s.purpose='保留已有经济道路';}
 for(const route of routes.filter(r=>r.kind==='source'||r.kind==='controller'))route.tiles.forEach((k,index)=>{const s=at.get(k)?.find(s=>s.type==='road');if(s)s.roadOrder=Math.min(s.roadOrder??Infinity,index);});
 const sourceRoutes=routes.filter(r=>r.kind==='source');for(const s of sourcePlans)s.pathLength=sourceRoutes.find(r=>r.sourceId===s.id).length-1;
 const controllerSpot={x:p.centerUpgradePos.x,y:p.centerUpgradePos.y,pathLength:routes.find(r=>r.id==='controller').length-1};
 const optionalReservations=[{type:'link',...nearLinkPos,rcl:7,tag:`source-link-${near.id}`,linkRole:'source',sourceId:near.id,label:'近矿 Link 可选位',purpose:'近矿道路短；只有实测可节约至少2 CARRY或解决拥堵时启用。',flow:'sender',targetTag:'controller-link',fallbackTargetTag:'hub-link',serviceSpot:{x:near.x,y:near.y},optional:true,enabled:false,activation:{minSavedCarry:2,requiresMeasuredBenefit:true,notes:['短矿路目前继续由容器和道路搬运','不因RCL配额空余自动施工']}}];
 // Entrance reservations have no roads/sites until a real remote economic route justifies them.
 for(const side of ['west','south']){const exits=p.exitCoords.filter(q=>side==='west'?q.x===0:q.y===49);let best;
  const exitCM=new Matrix();for(const k of blocked){const q=P(k);exitCM.set(q.x,q.y,255)}
  for(const e of exits){const r=rt.search(new Pos(roadCore.x,roadCore.y,world.name),{pos:e,range:0},exitCM,{plainCost:1,swampCost:1});if(!r.incomplete&&(!best||r.path.length<best.path.length))best={...r,exit:e};}
  if(best){const station=best.path[Math.max(0,best.path.length-5)];const q=adjacent(station).filter(canPlace).filter(q=>side==='west'?q.x>=3:q.y<=46).sort((a,b)=>D(a,spawn)-D(b,spawn))[0];if(q)optionalReservations.push({type:'link',...q,rcl:8,tag:'remote-entry-'+side,linkRole:'remote-entry',flow:'sender',targetTag:'hub-link',label:(side==='west'?'西':'南')+'入口 Link 可选位',purpose:'仅在该入口存在持续外矿回流、可抵消装卸及损耗时启用。',serviceArea:(side==='west'?'西':'南')+'侧外矿回流',serviceSpot:{x:station.x,y:station.y},optional:true,enabled:false,activation:{requiresActiveRemote:true,minSavedCarry:2,minExpectedEnergyPerTick:5,notes:['此坐标仅由本房至出口路径生成，尚未经相邻房矿点路线验证','需外矿经济闭环稳定并实测节省搬运','需要安全装卸位和相应入口道路','目前不生成工地或出口支路']}});}
 }
 const plan={version:3,layoutRevision:'2026-09-25-international-adapter-1',created:world.tick,anchor:{x:spawn.x,y:spawn.y},sourcePlans,controllerSpot,structures:items,counts,complete:true,missing:null,roadVersion:1,roadCore,roadRoutes:routes,roadMissing:[],optionalReservations,hubServiceSpot:{x:hubSpot.x,y:hubSpot.y},provenance:{generator:'research/layout-implementation/generate.cjs',worldSnapshot:path.basename(worldPath),tick:world.tick,terrainHash:crypto.createHash('sha256').update(world.terrain).digest('hex'),internationalCommit:'7e5106eebffb9627cf08cf893b6846012d970b90',overmindCommit:'5eca49a0d988a1f810a11b9c73d4d8961efca889',reused:['International.generateGrid/pruneGridCoords','International.planStamps/findDynamicStampAnchorWeighted','International.hub/labs/gridExtensions/observer/nuker/powerSpawn','International.minCutToExit','Overmind.RoadPlanner.generateRoadPlanningCostMatrix/generateRoadPath'],adapter:{radius,phase,lockedBuildings:locked.length,suppressedExitGridSeeds:true,linkPolicy:'far-source/hub RCL5; controller RCL6; near-source and entrances optional',protection:'Range-3 buffer around every core building; range-1 buffer around every core service path; common minimum cut',optionalNotConstruction:true}}};
 const report=require(path.join(root,'tools/audit-layout.cjs')).auditPlan(plan,world);
 const failures=require(path.join(root,'tools/audit-layout.cjs')).acceptanceFailures(report,{maxExtensionSteps:14,maxExtensionP95:11,requireExplicitLinkRoles:true});
 if(failures.length)throw Error(failures.join('; '));
 // Dedicated hub worker is present in this graph: don't hide a traffic choke under the service bay.
 const exterior=new Set();for(let k=0;k<2500;k++){const q=P(k);if(q.x===0||q.y===0||q.x===49||q.y===49)exterior.add(k)}
 const out=flood([...exterior].map(P),new Set(cut.map(K)));const finalBlocked=new Set([...blocked,...out.queue,K(hubSpot)]),safe=flood(adjacent(spawn),finalBlocked);
 for(const s of items.filter(s=>coreTypes.has(s.type)))if(!adjacent(s).some(q=>safe.d[K(q)]>=0))throw Error('hub worker blocks '+s.tag);
 const byKey=new Set(items.map(s=>`${s.type}:${K(s)}`));for(const s of built)assert(byKey.has(`${s.type}:${K(s)}`),'Lost existing '+JSON.stringify(s));
 for(let level=1;level<=8;level++){const c={};for(const s of items)if(s.rcl<=level)c[s.type]=(c[s.type]||0)+1;for(const type in c)assert(c[type]<=C.CONTROLLER_STRUCTURES[type][level],`RCL${level} ${type}`);}
 assert.equal(counts.extension,60);assert.equal(counts.lab,10);assert.equal(counts.spawn,3);assert.equal(counts.tower,6);assert.equal(counts.link,3);
 const inputLabs=items.filter(s=>s.tag.startsWith('lab-input')),outputLabs=items.filter(s=>s.tag.startsWith('lab-output'));for(const i of inputLabs)for(const o of outputLabs)assert(D(i,o)<=2);
 const metrics=report.distances.origins.storage.extensionStats;
 return {plan,report,metrics,score:metrics.mean*15+metrics.max*2+counts.road*.1+counts.rampart*.2};
}
const candidates=[],failures=[];
for(const radius of [10,11,12])for(const phase of [0,1,2,3]){try{const c=makeCandidate(radius,phase);candidates.push(c);console.log('PASS',radius,phase,JSON.stringify({score:c.score,counts:c.plan.counts,metrics:c.metrics}));}catch(e){failures.push({radius,phase,error:e.message});console.log('FAIL',radius,phase,e.message);if(process.env.DEBUG_LAYOUT)console.log(e.stack);}}
if(!candidates.length){fs.writeFileSync(path.join(__dirname,'failures.json'),JSON.stringify(failures,null,2)+'\n');throw Error('No acceptable candidate');}
candidates.sort((a,b)=>a.score-b.score);const best=candidates[0];
fs.writeFileSync(outputPath,JSON.stringify(best.plan,null,2)+'\n');fs.writeFileSync(outputPath.replace('.json','-audit.json'),JSON.stringify(best.report,null,2)+'\n');
fs.writeFileSync(process.argv[5]||path.join(__dirname,'candidate-summary.json'),JSON.stringify({input:{worldPath:path.basename(worldPath),priorPath:path.basename(priorPath),tick:world.tick},selected:{score:best.score,radius:best.plan.provenance.adapter.radius,phase:best.plan.provenance.adapter.phase},candidates:candidates.map(c=>({score:c.score,metrics:c.metrics,counts:c.plan.counts,adapter:c.plan.provenance.adapter})),failures},null,2)+'\n');
console.log('WROTE',outputPath);
