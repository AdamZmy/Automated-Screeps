#!/usr/bin/env node
'use strict';
// Execute the real construction scheduler in a VM with synthetic Game objects.
// No server, API, or real gameplay intents are used. Resources are abundant so
// this verifies staging and construction reachability, not economic timing.
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), assert = require('node:assert/strict');
const C = require('@screeps/common/lib/constants');
const root = path.resolve(__dirname, '..');
const clone = p => JSON.parse(JSON.stringify(p));
const id = p => `${p.type}:${p.x}:${p.y}`;
function simulateConstruction(plan, world, { existing = true, plannerFile = path.join(root, 'planner.js') } = {}) {
  const input = clone(plan), name = world.name, sites = [], created = [], stages = [];
  class Position {
    constructor(x, y, roomName = name) { Object.assign(this, { x, y, roomName }); }
    getRangeTo(p) { p = p.pos || p; return Math.max(Math.abs(this.x - p.x), Math.abs(this.y - p.y)); }
  }
  const make = (s, index) => ({ id: s.id || 'mock-' + index, structureType: s.type, pos: new Position(s.x, s.y), my: true,
    store: { energy: 100000, getFreeCapacity: () => 100000 }, hits: 10000, hitsMax: 10000 });
  const initial = existing ? world.structures.filter(s => s.type !== 'controller') : [world.structures.find(s => s.type === 'spawn')];
  const buildings = initial.map(make), original = initial.map(id);
  const controller = { ...make({ ...world.objects.controller, type: 'controller' }, 'controller'), level: existing ? world.currentRcl : 1, my: true };
  const room = { name, controller, getTerrain: () => ({ get: (x, y) => Number(world.terrain[x + y * 50]) }),
    get storage() { return buildings.find(s => s.structureType === C.STRUCTURE_STORAGE); },
    find(type) {
      if (type === C.FIND_STRUCTURES) return [...buildings, controller];
      if (type === C.FIND_MY_CONSTRUCTION_SITES) return sites;
      if (type === C.FIND_MY_SPAWNS) return buildings.filter(s => s.structureType === C.STRUCTURE_SPAWN);
      if (type === C.FIND_SOURCES) return world.objects.sources.map((s, i) => make({ ...s, type: 'source' }, i));
      if (type === C.FIND_MINERALS) return [make({ ...world.objects.mineral, type: 'mineral' }, 'mineral')];
      throw new Error('Unexpected room query ' + type);
    },
    createConstructionSite(x, y, type) {
      const p = input.structures.find(p => p.type === type && p.x === x && p.y === y);
      assert(p, 'Scheduler attempted an unreviewed structure');
      assert(p.rcl <= controller.level, 'Scheduler built ahead of its planned RCL');
      assert(!(room.getTerrain().get(x, y) & C.TERRAIN_MASK_WALL) || type === C.STRUCTURE_EXTRACTOR, 'Scheduler builds on terrain wall');
      assert(buildings.concat(sites).filter(s => s.structureType === type).length < C.CONTROLLER_STRUCTURES[type][controller.level], 'Scheduler exceeded engine RCL quota');
      assert(!sites.some(s => s.pos.x === x && s.pos.y === y), 'Two construction sites occupy one tile');
      const here = buildings.filter(s => s.pos.x === x && s.pos.y === y);
      for (const s of here) assert(s.structureType !== type && (type === C.STRUCTURE_RAMPART || s.structureType === C.STRUCTURE_RAMPART || [type, s.structureType].every(t => [C.STRUCTURE_ROAD, C.STRUCTURE_CONTAINER].includes(t))), 'Illegal built-structure overlap');
      const site = make(p, 'site-' + created.length); sites.push(site); created.push({ ...p, builtAtRcl: controller.level });
      context.Game.constructionSites[site.id] = site;
      return C.OK;
    }
  };
  const context = { ...C, console, module: { exports: {} }, RoomPosition: Position,
    Memory: { frontier: { rooms: { [name]: { plan: clone(input) } }, intel: {} } },
    Game: { time: 100000, rooms: { [name]: room }, constructionSites: {}, cpu: { limit: 20, bucket: 10000, getUsed: () => 0 } },
    require(request) { if (request === 'plans') return { has: () => false, load: () => clone(input), identify: () => null }; throw new Error('Unexpected module: ' + request); },
    PathFinder: { search() { throw new Error('Reviewed plan must not invoke runtime replanning'); } }
  };
  vm.createContext(context); vm.runInContext(fs.readFileSync(plannerFile, 'utf8'), context, { filename: plannerFile });
  const scheduler = context.module.exports;
  for (let level = controller.level; level <= 8; level++) {
    controller.level = level;
    let ticks = 0;
    for (; ticks < 300; ticks++) {
      const previous = created.length; context.Game.time += 10;
      scheduler.run(room);
      assert(sites.length <= 5, 'Scheduler exceeded per-tick construction batch');
      assert(sites.filter(s => s.structureType === C.STRUCTURE_ROAD).length <= 3, 'Scheduler exceeded road construction batch');
      buildings.push(...sites.splice(0)); context.Game.constructionSites = {};
      if (created.length === previous) break;
    }
    assert(ticks < 300, 'Construction did not reach a fixed point');
    const built = new Set(buildings.map(s => `${s.structureType}:${s.pos.x}:${s.pos.y}`));
    const pending = input.structures.filter(p => p.rcl <= level && !built.has(id(p)));
    const gated = p => p.type === C.STRUCTURE_RAMPART && !room.storage || p.type === C.STRUCTURE_ROAD && p.roadClass !== 'economy' && level < 4;
    assert(pending.every(gated), `Unexpected unbuilt RCL${level}: ` + pending.filter(p => !gated(p)).map(id).join(', '));
    stages.push({ rcl: level, batches: ticks, built: buildings.length, intentionallyGated: pending.map(id) });
  }
  const built = new Set(buildings.map(s => `${s.structureType}:${s.pos.x}:${s.pos.y}`));
  assert(input.structures.every(p => built.has(id(p))), 'Endgame plan was not fully constructed');
  assert(original.every(i => built.has(i)), 'An initial building disappeared during migration');
  return { passed: true, mode: existing ? 'migration-from-current-built-room' : 'fresh-spawn-RCL1-through-8', snapshotTick: world.tick,
    initialBuildings: initial.length, placements: input.structures.length, newConstructionSites: created.length, stages,
    caveat: 'All sites instantly finish and storage has ample resources. This proves legal scheduling, preservation and eventual completion under satisfied gates, not in-game build time.' };
}
module.exports = { simulateConstruction };
if (require.main === module) {
  const plan = JSON.parse(fs.readFileSync(process.argv[2] || path.join(root, 'fixtures/layout-plan-reviewed.json')));
  const world = JSON.parse(fs.readFileSync(process.argv[3] || path.join(root, 'fixtures/layout-world-before.json')));
  const result = [simulateConstruction(plan, world)];
  if (process.argv[4]) fs.writeFileSync(process.argv[4], JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
