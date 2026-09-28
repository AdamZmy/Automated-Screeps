'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm');
const {constants:C,loadGameModule,readSource}=require('./test-support/runtime.cjs');
const store=(energy,capacity)=>({energy,getFreeCapacity(){return capacity-this.energy;}});
function sandbox(overrides={}){
 const ctx={...C,Memory:{frontier:{rooms:{}}},Game:{time:1,rooms:{},creeps:{}},console,global:{},gameModuleOverrides:overrides};
 vm.createContext(ctx);return ctx;
}
{
 const ctx=sandbox(),r=loadGameModule(ctx,'runtime');
 const a={id:'a',store:store(100,800)},b={id:'b',store:store(200,800)};
 r.commitEnergy(a,b,100,97);
 assert.equal(r.availableEnergy(a),0);assert.equal(r.availableEnergy(b),200,'received energy cannot be spent in its intent tick');
 assert.equal(r.availableCapacity(b),503);assert.equal(r.availableCapacity(a),700,'outgoing intent does not create initial space');
 ctx.Game.time++;assert.equal(r.availableEnergy(a),100,'accepted-intent reservations reset to actual game snapshot');
 ctx.Game.creeps.worker={memory:{home:'home'},pos:{roomName:'remote'},spawning:false};
 const unknown=r.roomContext('home');assert.equal(unknown.visible,false);assert.equal(unknown.creepsByHome.length,1);assert.equal(unknown.inTransit.length,1);assert.equal(unknown.sources.length,0);
 assert.equal(r.roomContext('remote').creepsByPosition.length,1);
 ctx.Game.time++;ctx.Game.rooms.home={name:'home',find:()=>[]};assert.equal(r.roomContext('home').visible,true,'nexttick visibility rebuilds context');
}
{
 const ctx=sandbox({colony:{economyMemory:room=>ctx.Memory.frontier.rooms[room.name]}}),r=loadGameModule(ctx,'runtime'),network=loadGameModule(ctx,'links');
 const objects=[],room={name:'R',controller:{pos:{x:20,y:20}},find(type){return type===C.FIND_MY_STRUCTURES?objects:type===C.FIND_SOURCES?[{pos:{x:10,y:10}},{pos:{x:12,y:10}}]:[];}};
 const transfers=[];function link(id,x,y,n){const o={id,structureType:C.STRUCTURE_LINK,pos:{x,y},my:true,store:store(n,800),cooldown:0,transferEnergy(to,amount){transfers.push([id,to.id,amount]);return C.OK;}};objects.push(o);return o;}
 const a=link('source',10,11,400),b=link('source2',12,11,400),hub=link('hub',25,25,0),ctrl=link('controller',20,21,200);
 ctx.Memory.frontier.rooms.R={plan:{structures:[{type:C.STRUCTURE_LINK,x:25,y:25,tag:'hub-link'}]}};
 network.links(room);assert.deepEqual(transfers,[['source','controller',400],['source2','controller',200]]);
 assert.equal(r.availableCapacity(ctrl),0);assert.equal(r.availableEnergy(hub),0);assert.equal(r.availableEnergy(b),200);
 assert.equal(transfers.length,2,'hub never forwards hypothetical received energy');
 ctx.Game.time++;ctrl.store.energy=800;hub.store.energy=300;transfers.length=0;network.links(room);
 assert.equal(r.availableEnergy(hub),300,'new inbound source energy is not included in hub pickup budget');
 assert(r.availableCapacity(hub)>=0);assert.equal(transfers.filter(x=>x[1]==='hub').reduce((n,x)=>n+x[2],0),500);
}
{
 const ctx=sandbox(),defense=loadGameModule(ctx,'defense'),calls=[];
 const room=(name,damage)=>({name,controller:{my:true,level:4,ticksToDowngrade:100000,safeModeAvailable:1,activateSafeMode(){calls.push(name);return C.OK;}}});
 const a=room('A'),b=room('B');ctx.Memory.frontier.rooms={A:{security:{immediate:true,damage:30}},B:{security:{immediate:true,damage:100}}};
 defense.arbitrateSafeMode([a,b]);assert.deepEqual(calls,['B'],'only highest-risk room submits global safeMode intent');
 b.controller.safeMode=100;defense.arbitrateSafeMode([a,b]);assert.equal(calls.length,1);
}
{
 const events=[],rooms=['A','B'].map(name=>({name,controller:{my:true,level:2},visual:{text(){}},find:()=>[]}));
 const ctx=sandbox({
  colony:{updateEconomy:room=>events.push('policy:'+room.name)},mining:{mine:()=>{},constructionRequests:()=>[]},
  development:{developmentPlan(){},finishDevelopment(){},runConstruction(){events.push('construction');},work(c){events.push('work:'+c.name);}},
  logistics:{prepare(){},haul(){}},workforce:{spawnRoom:room=>{events.push('spawn:'+room.name);if(room.name==='A')throw Error('synthetic population fault');}},
  defense:{defend:room=>events.push('defend:'+room.name),arbitrateSafeMode(){},evacuate:()=>false},links:{links(){}},
  ledger:{observe:()=>events.push('ledger')},expansion:{tick(owned,options){assert.equal(options.optional,false);events.push('active-mission');},plan(){events.push('mission-planning');},spawnRequests:()=>[],constructionRequests:()=>[]},
  planner:{run:()=>events.push('planner'),constructionRequests:()=>[]},monitor:{tick:()=>{events.push('monitor');throw Error('synthetic monitor fault');}}
 });
 ctx.console={log(){}};ctx.Game.rooms=Object.fromEntries(rooms.map(r=>[r.name,r]));ctx.Game.cpu={getUsed:()=>0,bucket:0};ctx.Game.gcl={};
 ctx.Game.creeps.c={name:'c',memory:{role:'builder',home:'B'},room:rooms[1],pos:{roomName:'B'}};
 const main=loadGameModule(ctx,'main');main.loop();
 assert.equal(events[0],'ledger');assert(events.indexOf('defend:B')<events.indexOf('spawn:A'));
 assert(events.includes('spawn:B'));assert(events.indexOf('active-mission')<events.indexOf('spawn:A'));assert(events.indexOf('work:c')<events.indexOf('mission-planning'),'optional candidate routing follows necessary role movement');assert(events.indexOf('work:c')<events.indexOf('planner'));
 assert.equal(ctx.Memory.frontier.modules['spawn:A'].status,'error');assert.equal(ctx.Memory.frontier.modules.monitor.status,'error');
 ctx.Game.time++;main.loop();assert.equal(events.filter(x=>x==='ledger').length,2,'monitor failure cannot prevent ledger nexttick');
}
console.log('PASS: initial-snapshot resource reservations, home/physical/vision context, Link conflicts, safeMode arbitration and cross-module fault isolation/order');
