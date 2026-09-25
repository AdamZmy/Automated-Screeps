// Read-only research: test upstream Overmind's actual static stamp against API terrain.
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const raw=fs.readFileSync(path.join(__dirname,'planner-sources/overmind/src/roomPlanner/layouts/bunker.ts'),'utf8');
const start=raw.indexOf('export const bunkerLayout: StructureLayout = ')+ 'export const bunkerLayout: StructureLayout = '.length;
const literal=raw.slice(start,raw.indexOf('\n};',start)+2);
// Parse the data literal only; do not run upstream game code or import its runtime.
const data=JSON.parse(literal.replace(/'/g,'"').replace(/([{,]\s*)([a-zA-Z_$][\w$]*|\d+)\s*:/g,'$1"$2":').replace(/,\s*([}\]])/g,'$1'));
const snapshot=JSON.parse(fs.readFileSync(path.join(root,'state/layout-world-W21N26.json')));
const all=[];
for(const [type,group] of Object.entries(data[8].buildings))for(const p of group.pos)all.push({type,...p});
const primary=data[1].buildings.spawn.pos[0],home=snapshot.structures.find(s=>s.type==='spawn');
const natural=[...snapshot.objects.sources,snapshot.objects.controller,snapshot.objects.mineral];
const k=p=>p.x+50*p.y;
const naturals=new Set(natural.map(k));
const essential=snapshot.structures.filter(s=>!['road','rampart','controller'].includes(s.type));
const transform=(p,rot,mirror,slot=primary)=>{let x=p.x-slot.x,y=p.y-slot.y;if(mirror)x=-x;for(let i=0;i<rot;i++)[x,y]=[-y,x];return {x,y};};
function inspect(x,y,rot,mirror,detail=false,slot=primary){
 const placements=all.map(p=>{const v=transform(p,rot,mirror,slot);return {type:p.type,x:x+v.x,y:y+v.y};});
 const walls=placements.filter(p=>p.x<1||p.y<1||p.x>48||p.y>48||Number(snapshot.terrain[k(p)])&1);
 const collisions=placements.filter(p=>naturals.has(k(p)));
 const builtConflicts=placements.filter(p=>essential.some(s=>k(p)===k(s)&&p.type!==s.type&&p.type!=='rampart'&&!(s.type==='container'&&p.type==='road')));
 const retained=essential.filter(s=>placements.some(p=>k(s)===k(p)&&s.type===p.type));
 return {spawn:{x,y},rotation:rot*90,mirror,wallPlacements:walls.length,naturalCollisions:collisions.length,builtConflicts:builtConflicts.length,
   retainedExisting:retained.length,existingEssential:essential.length,retainedExtensions:retained.filter(s=>s.type==='extension').length,
   ...(detail?{wallExamples:walls.slice(0,5),conflictExamples:builtConflicts.slice(0,5)}:{})};
}
const fixed=[],fixedAnySlot=[],elsewhere=[];
for(let rot=0;rot<4;rot++)for(const mirror of [false,true]){
 fixed.push(inspect(home.x,home.y,rot,mirror,true));
 for(let y=1;y<=48;y++)for(let x=1;x<=48;x++){
  const test=inspect(x,y,rot,mirror);
  if(!test.wallPlacements&&!test.naturalCollisions)elsewhere.push(test);
 }
}
for(const [slotIndex,slot] of data[8].buildings.spawn.pos.entries())for(let rot=0;rot<4;rot++)for(const mirror of [false,true]){
 fixedAnySlot.push({slotIndex,...inspect(home.x,home.y,rot,mirror,false,slot)});
}
const result={snapshotTick:snapshot.tick,source:'Overmind/src/roomPlanner/layouts/bunker.ts',
 method:'Exact upstream RCL8 footprint, all 8 rotations/mirrors; first-spawn anchor fixed to current spawn, then all interior positions. Natural-wall roads are rejected. This is a placement test, not logistics/defense validation.',
 stampPlacements:all.length,fixedSpawn:fixed,fixedSpawnTerrainFits:fixed.filter(t=>!t.wallPlacements&&!t.naturalCollisions).length,
 fixedAnySpawnSlot:fixedAnySlot,fixedAnySpawnSlotTerrainFits:fixedAnySlot.filter(t=>!t.wallPlacements&&!t.naturalCollisions).length,
 terrainFitCountElsewhere:elsewhere.length,elsewhereExamples:elsewhere.slice(0,5),
 caveat:'Elsewhere fits do not retain the existing RCL3 room or prove safe migration. No candidate was installed.'};
fs.writeFileSync(path.join(__dirname,'bunker-fit.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({stampPlacements:result.stampPlacements,fixedSpawnTerrainFits:result.fixedSpawnTerrainFits,
 fixedSpawnWallCounts:fixed.map(t=>t.wallPlacements),fixedAnySpawnSlotTerrainFits:result.fixedAnySpawnSlotTerrainFits,terrainFitCountElsewhere:elsewhere.length},null,2));
