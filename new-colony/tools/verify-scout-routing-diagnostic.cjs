'use strict';
// Diagnostic for X003: reproduces the CURRENT expensive rejection path.
// Synthetic graph callback counts are not live CPU or post-fix acceptance.
// When fixing target preflight, replace this with a safe-target oracle.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {constants:C,enginePath,loadGameModule}=require('../test-support/runtime.cjs');
const xyToName=(x,y)=>(x<0?'W'+(-x-1):'E'+x)+(y<0?'N'+(-y-1):'S'+y);
const toXY=name=>{const m=name.match(/^([WE])(\d+)([NS])(\d+)$/);return [m[1]==='W'?-Number(m[2])-1:Number(m[2]),m[3]==='N'?-Number(m[4])-1:Number(m[4])];};
const utils={getRuntimeDriver:()=>({constants:C}),getRoomNameFromXY:xyToName,roomNameToXY:toXY};
const engineModule={exports:{}};
vm.runInNewContext(fs.readFileSync(enginePath+'/src/game/map.js','utf8'),{exports:engineModule.exports,require(name){
  if(name==='../utils')return utils;if(name==='lodash')return require(require.resolve('lodash',{paths:[enginePath]}));
  if(name==='./path-utils')return require(enginePath+'/src/game/path-utils');throw Error(name);
}});
function fixture(hostile){
  const gridData={},names=[],intel={};
  for(let x=-60;x<0;x++)for(let y=-60;y<0;y++){gridData[x+','+y]={t:y>-60,b:y<-1,l:x>-60,r:x<-1};const name=xyToName(x,y);names.push(name);intel[name]={seen:999,terrain:{plain:2304,swamp:0}};}
  const map=engineModule.exports.makeMap({accessibleRooms:JSON.stringify(names),mapGrid:{gridData},roomStatusData:{closed:{},novice:{},respawn:{}}},{},{});
  const calls=[];const original=map.findRoute;map.findRoute=(from,to,opts)=>{const detail={from,to,callbackCalls:0};calls.push(detail);const result=original(from,to,{routeCallback(...args){detail.callbackCalls++;return opts.routeCallback(...args);}});detail.reachable=Array.isArray(result);return result;};
  intel.W22N26={seen:1,owner:hostile?'opponent':undefined,mine:false,hostiles:0,terrain:{plain:2304,swamp:0}};
  let terrainReads=0,exitSearches=0,used=0;
  const room={name:'W21N26',controller:null,getTerrain:()=>({get:()=>{terrainReads++;return 0;}}),find:type=>type===C.FIND_EXIT_LEFT?[{x:0,y:25,roomName:'W21N26'}]:type===C.FIND_EXIT_TOP?[{x:25,y:0,roomName:'W21N26'}]:type===C.FIND_EXIT_RIGHT?[{x:49,y:25,roomName:'W21N26'}]:type===C.FIND_EXIT_BOTTOM?[{x:25,y:49,roomName:'W21N26'}]:[]};
  const ctx={...C,console,Memory:{frontier:{intel,rooms:{}}},Game:{time:1000,map,creeps:{},rooms:{},cpu:{getUsed:()=>used}},RoomPosition:class{constructor(x,y,roomName){Object.assign(this,{x,y,roomName});}}};
  const creep={id:'scout',room,memory:{role:'scout',home:room.name},fatigue:0,pos:{x:25,y:25,roomName:room.name,findClosestByPath(exits){exitSearches++;return exits[0];}},moveTo:()=>C.OK};
  vm.createContext(ctx);const expansion=loadGameModule(ctx,'expansion'),movement=loadGameModule(ctx,'movement'),metrics=loadGameModule(ctx,'metrics');
  return {ctx,creep,calls,expansion,movement,metrics,terrainReads:()=>terrainReads,exitSearches:()=>exitSearches,setUsed:n=>used=n};
}
const safe=fixture(false);safe.expansion.run(safe.creep,{});assert.equal(safe.creep.memory.target,'W22N26');assert.equal(safe.calls.length,1);
const blocked=fixture(true);blocked.expansion.run(blocked.creep,{});assert.equal(blocked.calls[0].to,'W22N26');assert.equal(blocked.calls[0].reachable,false);assert.notEqual(blocked.creep.memory.target,'W22N26');
assert(blocked.calls[0].callbackCalls>safe.calls[0].callbackCalls*100,'Unsafe candidate produces much broader graph search');
const count=blocked.calls.length;blocked.movement.route('W21N26','W22N26');assert.equal(blocked.calls.length,count,'Failed route cached within ten ticks');blocked.ctx.Game.time+=10;blocked.movement.route('W21N26','W22N26');assert.equal(blocked.calls.length,count+1,'Failure retry runs after ten ticks');
delete safe.ctx.Memory.frontier.intel.W21N26.terrain;safe.expansion.record(safe.creep.room);assert.equal(safe.terrainReads(),2304);safe.expansion.record(safe.creep.room);assert.equal(safe.terrainReads(),2304,'Known terrain reused');
safe.metrics.startCpu();safe.metrics.measured('rooms','W21N26',()=>safe.setUsed(2));safe.metrics.measured('rooms','W22N28',()=>safe.metrics.measured('roles','scout',()=>safe.setUsed(182)));assert.equal(safe.metrics.currentRoomCpu('W21N26'),2);assert.equal(safe.metrics.currentRoomCpu('W22N28'),180);
console.log(JSON.stringify({result:'PASS mechanism only, no measured CPU',safeRoute:safe.calls[0],unsafeRoute:blocked.calls[0],unsafeScoutSelected:blocked.creep.memory.target,terrainFirstReads:safe.terrainReads(),roomAttribution:'W21N26=2, W22N28=180 synthetic units, distinct'}));
