'use strict';
// Replays the real construction runner through all eight RCLs, without API.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {constants:C,loadGameModule}=require('./test-support/runtime.cjs');
const {compile,geometry}=require('./tools/compile-reviewed-plan.cjs');
const root=__dirname,read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const design=read('fixtures/layout-design-reviewed.json'),plan=read('fixtures/layout-plan-reviewed.json');
assert.deepEqual(compile(design),plan,'Committed execution plan must match design compiler');
assert.deepEqual(geometry(plan),geometry(design));
assert(!plan.optionalReservations&&!plan.provenance,'Research stays outside runtime Memory');
assert(plan.structures.every(s=>!s.purpose&&!s.purposes&&!s.label),'Per-building prose stays local');
assert.equal(plan.roadRoutes.length,3,'Only runtime economic routes are serialized');
const invalid=JSON.parse(JSON.stringify(design));invalid.complete=false;assert.throws(()=>compile(invalid));
const world=read('fixtures/layout-world-before.json'),K=s=>s.x+50*s.y;
const natural=new Set([...world.objects.sources,world.objects.controller,world.objects.mineral].map(K));
let tick=100,requests=0;
const placements=new Map(plan.structures.map(s=>[s.type+':'+K(s),s]));
const buildings=[],sites=[],memory={frontier:{rooms:{[world.name]:{plan:JSON.parse(JSON.stringify(plan))}}}};
const ctx={...C,console,module:{exports:{}},Memory:memory,Game:{time:tick,constructionSites:{},rooms:{},creeps:{}},
    require(){return {has(){return false;},load(){return JSON.parse(JSON.stringify(plan));}};},
    PathFinder:{search(){throw Error('Executing reviewed coordinates must not run pathfinding');}}};
const room={name:world.name,controller:{my:true,level:1,pos:{x:world.objects.controller.x,y:world.objects.controller.y,roomName:world.name}},getTerrain(){return{get:(x,y)=>Number(world.terrain[x+50*y])};},storage:{store:{[C.RESOURCE_ENERGY]:100000}},
    find(type){return type===C.FIND_STRUCTURES?buildings:type===C.FIND_MY_CONSTRUCTION_SITES?sites:type===C.FIND_MINERALS?[{id:'mineral',pos:{x:world.objects.mineral.x,y:world.objects.mineral.y}}]:[];},
    createConstructionSite(x,y,type){
        const k=K({x,y}),item=placements.get(type+':'+k),level=this.controller.level;
        assert(item&&item.rcl<=level,'Wrong coordinate or premature construction');
        assert(!natural.has(k)||type===C.STRUCTURE_EXTRACTOR,'Natural object collision');
        assert(!(Number(world.terrain[k])&C.TERRAIN_MASK_WALL)||type===C.STRUCTURE_EXTRACTOR,'Terrain wall collision');
        assert(!sites.some(s=>K(s.pos)===k),'Only one site per tile');
        const here=buildings.filter(s=>K(s.pos)===k);
        assert(!here.some(s=>s.structureType===type),'Duplicate construction');
        assert(!here.some(s=>s.structureType!==C.STRUCTURE_RAMPART&&type!==C.STRUCTURE_RAMPART&&
            ![s.structureType,type].every(t=>[C.STRUCTURE_ROAD,C.STRUCTURE_CONTAINER].includes(t))),'Incompatible tile');
        assert(buildings.concat(sites).filter(s=>s.structureType===type).length<C.CONTROLLER_STRUCTURES[type][level],'Quota exceeded');
        const site={id:'site-'+(++requests),structureType:type,pos:{x,y}};sites.push(site);ctx.Game.constructionSites[site.id]=site;return C.OK;
    }};
ctx.Game.rooms[world.name]=room;
vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,process.argv[2]||'planner.js'),'utf8'),ctx);
const development=loadGameModule(ctx,'development');
for(let level=1;level<=8;level++){
    room.controller.level=level;
    for(let batch=0;batch<200;batch++){
        ctx.Game.time=(tick+=10);const before=requests;ctx.module.exports.run(room);development.runConstruction(room,ctx.module.exports.constructionRequests(room));
        assert(sites.length<=C.MAX_CONSTRUCTION_SITES,'Physical global construction site cap');
        buildings.push(...sites.splice(0));ctx.Game.constructionSites={};if(requests===before)break;
    }
    for(const item of plan.structures.filter(s=>s.rcl<=level&&s.type!==C.STRUCTURE_RAMPART))assert(buildings.some(s=>s.structureType===item.type&&K(s.pos)===K(item)),`RCL${level} omitted ${item.tag}`);
    assert(!buildings.some(s=>s.structureType===C.STRUCTURE_RAMPART),'Automatic Rampart construction must stay disabled');
}
assert.equal(requests,plan.structures.filter(s=>s.type!==C.STRUCTURE_RAMPART).length);
for(const optional of design.optionalReservations||[])assert(!buildings.some(s=>s.structureType===optional.type&&K(s.pos)===K(optional)),'Optional reservation constructed');
console.log(`PASS compact execution: all non-Rampart placements, Rampart auto-build disabled, 3 economic routes, no optional construction, no layout search`);
