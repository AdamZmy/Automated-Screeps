'use strict';
// Local-only retrospective. Reuses the existing economy fixture and runs its
// regression suite first; no API, credential, deployment or source mutation.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const project = path.resolve(__dirname, '..');
const verifier = path.join(project, 'verify-economy.cjs');
const extra = String.raw`
{
 const f=fixture();f.room.controller.level=5;
 const box=f.structure(C.STRUCTURE_CONTAINER,'controller-box',16,23,400);box.hits=1000;
 const site={id:'persistent-site',structureType:C.STRUCTURE_RAMPART,pos:f.pos(18,23),progress:0,progressTotal:1};f.room.sites=[site];
 const c=f.creep('maintenance-builder','builder',17,23,50,50);
 // The fixture records intents without completing the site. This represents a
 // continuously available construction queue, not simulated engine decay.
 for(let i=0;i<10;i++){ctx.Game.time++;work(c);}
 assert.equal(c.actions.filter(a=>a[0]==='repair').length,0);
 assert.equal(c.actions.filter(a=>a[0]==='build').length,10);
 f.room.sites=[];ctx.Game.time++;work(c);assert.equal(c.actions.at(-1)[0],'repair');
 console.log('RETRO PASS 1: controller box1000/250000, 10 ticks with persistent site =10build/0repair; remove sites = repair');
}
{
 const f=fixture();f.room.controller.level=5;
 const box=f.structure(C.STRUCTURE_CONTAINER,'controller-box',16,23,400);box.hits=1000;
 const link=f.structure(C.STRUCTURE_LINK,'controller-link',18,22,400,800);
 assert.equal(controllerStation(f.room).node.id,box.id);
 const c=f.creep('maintenance-upgrader','upgrader',16,22,50,50);work(c);
 assert(!c.actions.some(a=>a[0]==='repair'));
 f.room.objects=f.room.objects.filter(o=>o!==box);
 assert.equal(controllerStation(f.room).node.id,link.id);
 console.log('RETRO PASS 2: RCL5 retains box before link; upgrader issues no repair; physical box removal permits link fallback');
}
{
 const f=marginalFixture();const savedCpu=ctx.Game.cpu;
 ctx.Game.cpu={limit:20,bucket:627};ctx.Memory.frontier.performance={mean:31.9};
 for(const c of f.ups)delete ctx.Game.creeps[c.name];
 const b=f.creep('remaining-builder','builder',20,25,50,50);
 spawnRoom(f.room);assert(!f.request);
 delete ctx.Game.creeps[b.name];spawnRoom(f.room);
 assert.equal(f.request.memory.role,'upgrader');
 console.log('RETRO PASS 3: CPU hold+no upgrader+remaining builder blocks upgrader recovery; no remaining WORK allows it');
 ctx.Game.cpu=savedCpu;delete ctx.Memory.frontier.performance;
}
`;
new Function('require', '__dirname', fs.readFileSync(verifier, 'utf8') + extra)(createRequire(verifier), project);
