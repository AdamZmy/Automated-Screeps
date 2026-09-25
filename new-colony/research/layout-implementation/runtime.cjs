'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {stripTypeScriptTypes}=require('node:module');
const constants=require('@screeps/common/lib/constants');
const K=p=>p.x+50*p.y, P=k=>({x:k%50,y:Math.floor(k/50)}), D=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
const offsets=[];for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)if(x||y)offsets.push({x,y});
const inRoom=(x,y)=>x>=0&&y>=0&&x<50&&y<50;
const range=(x,y,r)=>{const a=[];for(let xx=Math.max(0,x-r);xx<=Math.min(49,x+r);xx++)for(let yy=Math.max(0,y-r);yy<=Math.min(49,y+r);yy++)a.push({x:xx,y:yy});return a;};
const adjacent=p=>offsets.map(o=>({x:p.x+o.x,y:p.y+o.y})).filter(p=>inRoom(p.x,p.y));
class Pos{constructor(x,y,roomName){Object.assign(this,{x,y,roomName});}getRangeTo(p){return D(this,p.pos||p);}get isEdge(){return this.x===0||this.y===0||this.x===49||this.y===49;}}
class Matrix{constructor(){this.a=new Uint8Array(2500)}get(x,y){return this.a[x+y*50]||0}set(x,y,v){if(inRoom(x,y))this.a[x+y*50]=v}clone(){const b=new Matrix();b.a.set(this.a);return b}}
function search(world,start,goals,cm,{plainCost=3,swampCost=4}={}){
 if(!Array.isArray(goals))goals=[goals];const heap=[],dist=new Float64Array(2500).fill(Infinity),prev=new Int16Array(2500).fill(-1);
 const push=(v)=>{let i=heap.length;heap.push(v);while(i){let p=(i-1)>>1;if(heap[p][0]<v[0]||heap[p][0]===v[0]&&heap[p][1]<v[1])break;heap[i]=heap[p];i=p}heap[i]=v};
 const pop=()=>{const r=heap[0],v=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&(heap[j+1][0]<heap[j][0]||heap[j+1][0]===heap[j][0]&&heap[j+1][1]<heap[j][1]))j++;if(v[0]<heap[j][0]||v[0]===heap[j][0]&&v[1]<heap[j][1])break;heap[i]=heap[j];i=j}heap[i]=v}return r};
 const initial=K(start);dist[initial]=0;push([0,initial]);let found=-1;
 while(heap.length){const[c,k]=pop();if(c!==dist[k])continue;const p=P(k);if(goals.some(g=>D(p,g.pos)<=g.range)){found=k;break}
  for(const n of adjacent(p)){const j=K(n),v=cm.get(n.x,n.y);if((Number(world.terrain[j])&1)||v===255)continue;const step=v||((Number(world.terrain[j])&2)?swampCost:plainCost);if(c+step<dist[j]){dist[j]=c+step;prev[j]=k;push([c+step,j])}}
 }
 const result=[];if(found>=0)for(let k=found;k!==initial;k=prev[k])result.push(new Pos(k%50,Math.floor(k/50),world.name));
 return {path:result.reverse(),incomplete:found<0,cost:found<0?Infinity:dist[found],ops:dist.filter(Number.isFinite).length};
}
function loadTS(file,context,exportName){let src=fs.readFileSync(file,'utf8');src=src.replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*\n/gm,'').replace(/^import\s+['"][^'"]+['"];?\s*\n/gm,'').replace(/^@profile\s*\n/gm,'').replace(/\bexport /g,'');vm.runInContext(stripTypeScriptTypes(src,{mode:'strip'})+`\nthis.__loaded=${exportName};`,context,{filename:file});return context.__loaded;}
function makeRuntime(world){
 const sources=world.objects.sources.map(s=>({...s,pos:new Pos(s.x,s.y,world.name)}));const natural=[...sources,world.objects.controller,world.objects.mineral];
 const terrain={get:(x,y)=>Number(world.terrain[x+y*50])};
 let planner;
 const cmFor=args=>{const cm=new Matrix();for(const n of natural)cm.set(n.x,n.y,255);for(const maps of args.weightCoordMaps||[]){if(!maps)continue;for(let x=0;x<50;x++)for(let y=0;y<50;y++){const v=maps[x*50+y];if(v)cm.set(x,y,v)}}return cm};
 const room={name:world.name,controller:{...world.objects.controller,pos:new Pos(world.objects.controller.x,world.objects.controller.y,world.name)},getTerrain:()=>terrain,errorVisual(){},coordVisual(){},roomManager:{exitCoords:new Set()},find:()=>[]};
 for(let i=0;i<2500;i++){const p=P(i);if((p.x===0||p.y===0||p.x===49||p.y===49)&&!(Number(world.terrain[i])&1))room.roomManager.exitCoords.add(`${p.x},${p.y}`)}
 const _={range:(a,b)=>b===undefined?Array.from({length:a},(_,i)=>i):Array.from({length:Math.max(0,b-a)},(_,i)=>a+i),take:(a,n)=>a.slice(0,n),forEach:(a,f)=>a.forEach(f)};
 const context={...constants,console,Uint8Array,Uint16Array,Uint32Array,Int32Array,RoomPosition:Pos,PathFinder:{CostMatrix:Matrix,search:(start,goal,opts={})=>search(world,start,goal,opts.roomCallback?opts.roomCallback(world.name):new Matrix(),opts)},roomDimensions:50,defaultRoadPlanningPlainCost:3,defaultSwampCost:5,dynamicDistanceWeight:8,customColors:{},onPublicServer:()=>true,Pathing:{shouldAvoid:()=>false},log:{warning:console.warn,info:()=>{},debug:()=>{}},_,Game:{map:{getRoomTerrain:()=>terrain},rooms:{[world.name]:room}},Result:{success:'success',fail:'fail',action:'action',noAction:'noAction'},
 RoomOps:{getSources:()=>sources},CustomPathFinder:{findPath:args=>{const result=search(world,args.origin,args.goals,cmFor(args),args);return result.incomplete?[]:result.path}},
 adjacentOffsets:offsets,cardinalOffsets:offsets.filter(o=>o.x===0||o.y===0),packAsNum:p=>p.x*50+p.y,packXYAsNum:(x,y)=>x*50+y,unpackNumAsCoord:n=>({x:Math.floor(n/50),y:n%50}),packCoord:p=>`${p.x},${p.y}`,packXYAsCoord:(x,y)=>`${x},${y}`,unpackCoord:s=>{const[x,y]=s.split(',').map(Number);return{x,y}},
 findAdjacentCoordsToCoord:adjacent,findAdjacentCoordsToXY:(x,y)=>adjacent({x,y}),findCoordsInRange:(p,r)=>range(p.x,p.y,r),findCoordsInRangeXY:range,forAdjacentCoords:(p,f)=>adjacent(p).forEach(f),forCoordsAroundRange:(p,r,f)=>range(p.x,p.y,r).filter(q=>D(p,q)===r).forEach(f),forCoordsInRange:(p,r,f)=>range(p.x,p.y,r).forEach(f),
 getRange:D,getRangeXY:(x,y,xx,yy)=>D({x,y},{x:xx,y:yy}),isXYInRoom:inRoom,isXYExit:(x,y)=>x===0||y===0||x===49||y===49,isXYInBorder:(x,y,i)=>x<i||y<i||x>=50-i||y>=50-i,areCoordsEqual:(a,b)=>a.x===b.x&&a.y===b.y,sortBy:(arr,f)=>arr.sort((a,b)=>f(a)-f(b)),findClosestCoord:(p,a)=>{const s=a.map((q,i)=>[q,i]).sort((a,b)=>D(p,a[0])-D(p,b[0]));return s[0]},
 };
 vm.createContext(context);
 const root=path.resolve(__dirname,'vendor');
 let stampSource=fs.readFileSync(path.join(root,'international/src/constants/general.ts'),'utf8');stampSource=stampSource.slice(stampSource.indexOf('export const stamps:'),stampSource.indexOf('export const stampKeys')).replace('export ','');vm.runInContext(stripTypeScriptTypes(stampSource,{mode:'strip'})+'\nthis.stamps=stamps;',context);
 const CommunePlanner=loadTS(path.join(root,'international/src/room/construction/communePlanner.ts'),context,'CommunePlanner');
 const minCutToExit=loadTS(path.join(root,'international/src/room/construction/minCut.ts'),context,'minCutToExit');
 const roadContext={...context};vm.createContext(roadContext);const RoadPlanner=loadTS(path.join(root,'overmind/src/roomPlanner/RoadPlanner.ts'),roadContext,'RoadPlanner');
 return {context,room,sources,terrain,CommunePlanner,minCutToExit,RoadPlanner,roadContext,search:(s,g,c,o)=>search(world,s,g,c,o)};
}
module.exports={makeRuntime,constants,K,P,D,offsets,range,adjacent,Pos,Matrix,search};
