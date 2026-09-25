#!/usr/bin/env node
'use strict';

// Offline, read-only geometry audit. No Game globals, API, intents, or credentials.
// node tools/audit-layout.cjs [plan.json] [world.json] [output.json]
// node tools/audit-layout.cjs --self-test
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const constants = require('@screeps/common/lib/constants');
const K = p => p.x + 50 * p.y;
const P = k => ({ x: k % 50, y: Math.floor(k / 50) });
const D = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const round = n => Math.round(n * 1000) / 1000;
const brief = p => ({ type: p.type, tag: p.tag, x: p.x, y: p.y, rcl: p.rcl });
const barriers = new Set(['rampart', 'constructedWall']);
const passive = new Set(['road', 'rampart', 'constructedWall']);
const coreTypes = new Set(['spawn', 'storage', 'terminal', 'extension', 'lab', 'tower', 'factory', 'observer', 'powerSpawn', 'nuker']);

function neighbors(k, min = 0, max = 49) {
  const { x, y } = P(k), result = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const xx = x + dx, yy = y + dy;
    if ((dx || dy) && xx >= min && xx <= max && yy >= min && yy <= max) result.push(xx + yy * 50);
  }
  return result;
}
function isWall(terrain, k) { return !!(Number(terrain[k]) & constants.TERRAIN_MASK_WALL); }
function exits(terrain) {
  return Array.from({ length: 2500 }, (_, k) => k).filter(k => {
    const { x, y } = P(k);
    return (x === 0 || x === 49 || y === 0 || y === 49) && !isWall(terrain, k);
  });
}
function flood(terrain, starts, blocked = new Set(), min = 0, max = 49) {
  const distance = new Int16Array(2500).fill(-1), parent = new Int16Array(2500).fill(-1), queue = [];
  for (const k of starts) {
    const p = P(k);
    if (p.x < min || p.y < min || p.x > max || p.y > max || isWall(terrain, k) || blocked.has(k) || distance[k] >= 0) continue;
    distance[k] = 0; queue.push(k);
  }
  for (let head = 0; head < queue.length; head++) {
    const k = queue[head];
    for (const n of neighbors(k, min, max)) {
      if (distance[n] >= 0 || blocked.has(n) || isWall(terrain, n)) continue;
      distance[n] = distance[k] + 1; parent[n] = k; queue.push(n);
    }
  }
  return { distance, parent, visited: new Set(queue) };
}
function naturalObjects(world) {
  return [...(world.objects.sources || []), world.objects.controller, world.objects.mineral].filter(Boolean);
}
function movementBlocked(plan, world) {
  return new Set([
    ...plan.structures.filter(s => constants.OBSTACLE_OBJECT_TYPES.includes(s.type)),
    ...(world.structures || []).filter(s => constants.OBSTACLE_OBJECT_TYPES.includes(s.type)),
    ...naturalObjects(world)
  ].map(K));
}
function serviceTiles(item, terrain, blocked) {
  return [K(item), ...neighbors(K(item), 1, 48)].filter(k => !isWall(terrain, k) && !blocked.has(k));
}
function getPath(map, end) {
  const route = [];
  for (let k = end; k >= 0; k = map.parent[k]) route.push(P(k));
  return route.reverse();
}
function summarize(values) {
  const finite = values.filter(v => v !== null).sort((a, b) => a - b);
  return {
    count: values.length, reachable: finite.length, unreachable: values.length - finite.length,
    mean: finite.length ? round(finite.reduce((a, b) => a + b, 0) / finite.length) : null,
    p95: finite.length ? finite[Math.ceil(finite.length * .95) - 1] : null,
    max: finite.length ? finite.at(-1) : null
  };
}
function isResourceService(s) {
  return s.type === 'extractor' || /^(source-|source-link-|controller|controller-link|mineral)/.test(s.tag || '');
}

function auditDefense(plan, world) {
  const terrain = world.terrain, boundary = exits(terrain);
  const barrierSet = new Set(plan.structures.filter(s => barriers.has(s.type)).map(K));
  const outside = flood(terrain, boundary, barrierSet);
  const perimeterSet = new Set(plan.structures.filter(s => barriers.has(s.type) && s.tag !== 'critical-rampart').map(K));
  const outsideWithoutRoofs = flood(terrain, boundary, perimeterSet);
  const structures = plan.structures.filter(s => !passive.has(s.type)).map(s => {
    const k = K(s), adjacentOutside = neighbors(k).filter(n => outside.visited.has(n));
    const terrainWall = isWall(terrain, k), roofed = barrierSet.has(k);
    // Extractors occupy wall/mineral tiles: their service edge, not the mineral
    // tile itself, establishes whether they are outside the defended perimeter.
    const exposed = !roofed && (outside.visited.has(k) || terrainWall && adjacentOutside.length > 0);
    const closestExteriorRange = outside.visited.size ? Math.min(...[...outside.visited].map(n => D(P(n), s))) : null;
    return { ...brief(s), role: isResourceService(s) ? 'resource-service' : 'core', terrainWall, roofed,
      exitReachableTile: outside.visited.has(k), exteriorServiceNeighbors: adjacentOutside.map(P), exposed,
      closestExteriorRange, unroofedWithinRangedReach: !roofed && closestExteriorRange !== null && closestExteriorRange <= 3,
      protectedWithoutIndividualRoof: !outsideWithoutRoofs.visited.has(k) && !(terrainWall && neighbors(k).some(n => outsideWithoutRoofs.visited.has(n))) };
  });
  const byType = {};
  for (const s of structures) {
    const item = byType[s.type] ||= { count: 0, exposed: 0, roofed: 0 };
    item.count++; item.exposed += Number(s.exposed); item.roofed += Number(s.roofed);
  }
  const builtDefenses = new Set((world.structures || []).filter(s => barriers.has(s.type)).map(K));
  const builtOutside = flood(terrain, boundary, builtDefenses);
  return {
    result: { movement: '8-neighbor; only terrain walls and planned rampart/constructedWall block hostile flood',
      exitTiles: boundary.length, exitTilesBySide: { top: boundary.filter(k => P(k).y === 0).length, right: boundary.filter(k => P(k).x === 49).length,
        bottom: boundary.filter(k => P(k).y === 49).length, left: boundary.filter(k => P(k).x === 0).length },
      plannedBarrierCount: barrierSet.size, perimeterBarrierCount: perimeterSet.size,
      exteriorTerrainTiles: outside.visited.size, byType, exposed: structures.filter(s => s.exposed),
      exposedCoreCount: structures.filter(s => s.exposed && s.role === 'core').length,
      exposedResourceServiceCount: structures.filter(s => s.exposed && s.role === 'resource-service').length,
      unroofedCoreWithinThreeOfExterior: structures.filter(s => s.role === 'core' && s.unroofedWithinRangedReach).map(brief),
      allStructures: structures,
      currentBuilt: { barrierCount: builtDefenses.size, exposedCoreCount: (world.structures || []).filter(s => coreTypes.has(s.type) && builtOutside.visited.has(K(s))).length },
      limitation: 'This checks perimeter enclosure before breaches; it does not model ranged attack over barriers, tower coverage, barrier hitpoints, or defense cost.' },
    exterior: outside.visited
  };
}

function auditDistances(plan, world, exterior) {
  const terrain = world.terrain, blocked = movementBlocked(plan, world), natural = new Set(naturalObjects(world).map(K));
  const protectedBlocked = new Set([...blocked, ...exterior]);
  const origins = [plan.structures.find(s => s.tag === 'primary') || plan.structures.find(s => s.type === 'spawn'), plan.structures.find(s => s.type === 'storage')].filter(Boolean);
  const result = {};
  for (const origin of origins) {
    const starts = serviceTiles(origin, terrain, blocked), map = flood(terrain, starts, blocked, 1, 48);
    const safe = flood(terrain, starts, protectedBlocked, 1, 48);
    const terrainOnly = flood(terrain, serviceTiles(origin, terrain, natural), natural, 1, 48);
    const targets = plan.structures.filter(s => !passive.has(s.type)).map(target => {
      const ends = serviceTiles(target, terrain, blocked).filter(k => map.distance[k] >= 0).sort((a, b) => map.distance[a] - map.distance[b] || a - b);
      const terrainEnds = serviceTiles(target, terrain, natural).filter(k => terrainOnly.distance[k] >= 0);
      const steps = ends.length ? map.distance[ends[0]] : null, lowerBound = Math.max(0, D(origin, target) - 2);
      const route = ends.length ? getPath(map, ends[0]) : [];
      const protectedReachable = serviceTiles(target, terrain, blocked).some(k => safe.distance[k] >= 0);
      return { ...brief(target), steps, chebyshevServiceLowerBound: lowerBound,
        detourSteps: steps === null ? null : steps - lowerBound,
        terrainOnlySteps: terrainEnds.length ? Math.min(...terrainEnds.map(k => terrainOnly.distance[k])) : null,
        protectedInteriorReachable: protectedReachable,
        exteriorTilesOnOneShortestPath: route.filter(p => exterior.has(K(p))).length,
        path: route };
    });
    const extensions = targets.filter(s => s.type === 'extension');
    result[origin.type] = { origin: brief(origin), possibleStartTiles: starts.map(P),
      extensionStats: summarize(extensions.map(s => s.steps)),
      extensionsOutsideProtectedConnectedCore: extensions.filter(s => !s.protectedInteriorReachable).map(brief),
      nonResourceTargetsOutsideProtectedConnectedCore: targets.filter(s => !isResourceService(s) && !s.protectedInteriorReachable).map(brief),
      worstExtensions: [...extensions].sort((a, b) => (b.steps ?? Infinity) - (a.steps ?? Infinity)).slice(0, 10), targets };
  }
  return { metric: 'Shortest 8-neighbor movement steps, excluding the initial service tile: any walkable tile at range <=1 of origin to any walkable tile at range <=1 of target. Terrain walls, natural objects, all RCL8 obstacle structures and existing obstacles block movement. Friendly ramparts/roads/containers are passable. Room boundary exits are not used.',
    caveat: 'Movement steps are a geometric lower bound, not measured creep ticks, a full refill tour, or hauling throughput; fatigue, road speed, bodies, traffic and dynamic target choice are not modeled.', origins: result };
}

function graphComponents(nodes, adjacent) {
  const left = new Set(nodes), result = [];
  while (left.size) {
    const start = left.values().next().value, group = new Set([start]), queue = [start]; left.delete(start);
    for (let head = 0; head < queue.length; head++) for (const n of adjacent.get(queue[head]) || []) {
      if (!left.delete(n)) continue; group.add(n); queue.push(n);
    }
    result.push(group);
  }
  return result;
}
function roadDistances(nodes, adjacent, start) {
  const distance = new Map(), queue = [];
  if (nodes.has(start)) { distance.set(start, 0); queue.push(start); }
  for (let head = 0; head < queue.length; head++) for (const n of adjacent.get(queue[head]) || []) {
    if (nodes.has(n) && !distance.has(n)) { distance.set(n, distance.get(queue[head]) + 1); queue.push(n); }
  }
  return distance;
}
function auditRoads(plan, world, exterior) {
  const roads = new Set(plan.structures.filter(s => s.type === 'road').map(K));
  const adjacent = new Map([...roads].map(k => [k, neighbors(k).filter(n => roads.has(n))]));
  const targets = [...plan.structures.filter(s => !passive.has(s.type)), ...(world.objects.controller ? [{ ...world.objects.controller, type: 'controller', tag: 'controller-object' }] : [])];
  const service = new Set([...roads].filter(k => targets.some(s => D(P(k), s) <= 1)));
  const boundary = exits(world.terrain), exitApproach = new Set([...roads].filter(k => boundary.some(n => D(P(k), P(n)) <= 1)));
  const core = K(plan.roadCore || plan.anchor), original = roadDistances(roads, adjacent, core);
  const targetFree = new Set([...roads].filter(k => !service.has(k)));
  const components = graphComponents(targetFree, adjacent).filter(group => [...group].some(k => exitApproach.has(k)));
  const branches = components.map(group => {
    const attachments = new Set([...group].flatMap(k => adjacent.get(k)).filter(k => !group.has(k)));
    const remaining = new Set([...roads].filter(k => !group.has(k))), after = roadDistances(remaining, adjacent, core);
    return { roadTiles: group.size, tiles: [...group].sort((a, b) => a - b).map(P),
      exitApproaches: [...group].filter(k => exitApproach.has(k)).map(P), attachmentTiles: [...attachments].map(P),
      directLocalServiceTargets: [],
      localServiceRoadTilesDisconnectedIfRemoved: [...service].filter(k => original.has(k) && !after.has(k)).length,
      localServiceRoadTilesWithLongerPathsIfRemoved: [...service].filter(k => original.has(k) && after.has(k) && after.get(k) > original.get(k)).length };
  });
  const allBranchTiles = new Set(components.flatMap(c => [...c])), pruned = new Set([...roads].filter(k => !allBranchTiles.has(k)));
  const afterAll = roadDistances(pruned, adjacent, core);
  return { totalRoadTiles: roads.size, exteriorRoadTiles: [...roads].filter(k => exterior.has(k)).length,
    localServiceRoadTiles: service.size, targetFreeExitComponents: branches,
    targetFreeExitRoadTiles: allBranchTiles.size,
    simultaneousRemoval: { remainingRoadTiles: pruned.size,
      localServiceRoadTilesDisconnected: [...service].filter(k => original.has(k) && !afterAll.has(k)).length,
      localServiceRoadTilesWithLongerPaths: [...service].filter(k => original.has(k) && afterAll.has(k) && afterAll.get(k) > original.get(k)).length },
    caveat: 'Exit components have no local building/controller within transfer/service range and lead to actual exit approaches. They may still support an explicit inter-room route. Tests concern road-graph connectivity and distance from roadCore; road removal here is hypothetical and does not change the plan or game.' };
}

function auditLinks(plan, world, distances) {
  const links = plan.structures.filter(s => s.type === 'link'), controller = world.objects.controller;
  const receiverCandidates = links.filter(l => controller && D(l, controller) <= 3);
  return { controllerReceiverCandidates: receiverCandidates.map(brief),
    legacyRuntimeReview: { scope: 'Reviewed before layout revision: historical version at tick73929558. This section does not claim that a subsequently edited main.js retains the same behavior.',
      minerDeposit: 'main.js:344-348 deposits into an adjacent owned link with room, before source container.',
      haulerFill: 'main.js:390 fills ANY link with <600 energy, controller range >3, and no source at range <=2; tags and strategic roles are ignored.',
      routing: 'main.js:563-568 chooses the first owned link at controller range <=3; every other link sends to it when energy>100, cooldown=0, and receiver free>100.',
      withdrawal: 'main.js:225 permits workers to withdraw from any energized link.',
      hub: 'No storage receiver mode, hub-to-storage draining policy, or link-specific role table exists in the current runtime.' },
    links: links.map(link => {
      const adjacentMiners = (plan.sourcePlans || []).filter(s => D(link, s) <= 1);
      const haulerFillEligible = controller && D(link, controller) > 3 && !(world.objects.sources || []).some(s => D(link, s) <= 2);
      const metric = distances.origins.storage?.targets.find(t => t.type === 'link' && t.x === link.x && t.y === link.y);
      return { ...brief(link), declaredRole: link.linkRole || link.role || null, declaredFlow: link.flow || null,
        controllerRange: controller ? D(link, controller) : null,
        sourceRanges: (world.objects.sources || []).map(s => ({ sourceId: s.id, range: D(link, s) })),
        adjacentAssignedMinerSources: adjacentMiners.map(s => s.id), haulerFillEligible: !!haulerFillEligible,
        legacyInferredRuntimeRole: receiverCandidates.includes(link) ? 'controller receiver; worker withdrawal' : adjacentMiners.length ? 'miner-fed sender to controller' : haulerFillEligible ? 'hauler-fed sender to controller' : 'sender without a normal fill source',
        storageServiceSteps: metric?.steps ?? null, protectedInteriorReachable: metric?.protectedInteriorReachable ?? null,
        selectedToFillQuota: /^link-extra-/.test(link.tag || '') };
    }),
    finding: links.some(l => /^link-extra-/.test(l.tag || ''))
      ? 'Quota-added extra links are present. In the legacy reviewed runtime generic haulers could fill them and forward to the controller; this is not proof of useful demand.'
      : 'No quota-added extra links are present. Declared roles and spatial station feasibility still require verification against the revised runtime and actual future energy flow.' };
}

function auditPlan(plan, world) {
  assert.equal(world.terrain.length, 2500, 'Expected one 50x50 terrain grid');
  const defense = auditDefense(plan, world), distances = auditDistances(plan, world, defense.exterior);
  return { room: world.name, snapshot: { tick: world.tick, capturedAt: world.capturedAt,
      capturedAtIso: new Date(world.capturedAt).toISOString(), currentRcl: world.currentRcl,
      structureCount: world.structures.length, constructionSiteCount: world.constructionSites.length,
      planVersion: plan.version, planCreatedTick: plan.created, historicalSnapshot: true },
    generatedAt: new Date().toISOString(), defense: defense.result, distances,
    roads: auditRoads(plan, world, defense.exterior), links: auditLinks(plan, world, distances),
    findings: [
      `${defense.result.exposedCoreCount} core targets and ${defense.result.exposedResourceServiceCount} resource-service targets are exterior-exposed. External source/mineral infrastructure is not itself evidence of a broken core defense.`,
      'Enclosure of every target tile is insufficient: a target may occupy a separate sealed terrain pocket and require carriers to leave the defended region.',
      'In the audited planner v3, candidate ordering uses Chebyshev distance from the spawn (planner.js:136-139); true walk distance is only used later to prove reachability (176-198). This permits cross-mountain targets despite long service routes.',
      'The radius-10 square perimeter (planner.js:202) has no shared protected-core service test. Current verify-planner.cjs checks general accessibility, exact quotas and legality but does not check exterior flood, protected service connectivity, route distance distribution, or semantic link demand.',
      'Exit lanes are reserved once by weighted PathFinder and again by an unweighted flood tree (planner.js:131-134,198). The union retains multiple exit paths without an explicit active remote objective; access roads are nevertheless postponed until RCL4 and storage surplus.',
      'Link quota completion is hard-coded separately from runtime function. This produces extra hauler-fed controller senders, including one across the mountain, rather than a validated storage/source/controller topology.'
    ] };
}

// Policy thresholds are explicit caller choices; the audit does not invent an
// optimal distance cutoff. A default acceptance catches the separated pockets.
function acceptanceFailures(report, { maxExtensionSteps = Infinity, maxExtensionP95 = Infinity,
  requireProtectedCoreService = true, requireExplicitLinkRoles = false } = {}) {
  const failures = [];
  if (report.defense.exposedCoreCount) failures.push(`${report.defense.exposedCoreCount} core targets exposed from exits`);
  for (const [name, origin] of Object.entries(report.distances.origins)) {
    const stats = origin.extensionStats;
    if (stats.unreachable) failures.push(`${name}: ${stats.unreachable} extensions unreachable`);
    if (stats.max > maxExtensionSteps) failures.push(`${name}: extension max ${stats.max} exceeds ${maxExtensionSteps}`);
    if (stats.p95 > maxExtensionP95) failures.push(`${name}: extension p95 ${stats.p95} exceeds ${maxExtensionP95}`);
    if (requireProtectedCoreService && origin.nonResourceTargetsOutsideProtectedConnectedCore.length) {
      failures.push(`${name}: ${origin.nonResourceTargetsOutsideProtectedConnectedCore.length} non-resource targets need an exterior trip`);
    }
  }
  if (requireExplicitLinkRoles && report.links.links.some(l => l.selectedToFillQuota)) failures.push('Quota-only extra links lack independently justified logistical roles');
  return failures;
}
function assertAcceptance(report, options) { assert.deepEqual(acceptanceFailures(report, options), []); }

function selfTest() {
  const open = '0'.repeat(2500), start = K({ x: 25, y: 25 });
  const cross = new Set(neighbors(start).filter(k => P(k).x === 25 || P(k).y === 25));
  assert(flood(open, [start], cross).visited.has(K({ x: 24, y: 24 })), 'Diagonal movement must be admitted');
  const ring = new Set(neighbors(start));
  assert.equal(flood(open, [start], ring).visited.size, 1, 'Eight blocked neighbors enclose a tile');
  assert.equal(summarize([1, 2, 3, null]).unreachable, 1);
  assert.equal(summarize(Array.from({ length: 60 }, (_, i) => i + 1)).p95, 57, 'Nearest-rank p95');
  const mini = { defense: { exposedCoreCount: 0 }, distances: { origins: { spawn: { extensionStats: { max: 24, p95: 23, unreachable: 0 }, nonResourceTargetsOutsideProtectedConnectedCore: [{}] } } }, links: { links: [] } };
  assert.equal(acceptanceFailures(mini).length, 1, 'Accessible but exterior-dependent targets must fail protected-core service');
  assert.equal(acceptanceFailures(mini, { requireProtectedCoreService: false, maxExtensionSteps: 12 }).length, 1);
  console.log('audit-layout self-tests passed');
}

module.exports = { auditPlan, auditDefense, auditDistances, auditRoads, auditLinks, flood, summarize, acceptanceFailures, assertAcceptance,
  movementBlocked, serviceTiles, naturalObjects, neighbors, exits };
if (require.main === module) {
  if (process.argv.includes('--self-test')) selfTest();
  else {
    const root = path.resolve(__dirname, '..'), args = process.argv.slice(2);
    const planFile = args[0] || path.join(root, 'state/layout-plan-W21N26.json');
    const worldFile = args[1] || path.join(root, 'state/layout-world-W21N26.json');
    const outputFile = args[2] || path.join(root, 'state/layout-audit-before.json');
    const result = auditPlan(JSON.parse(fs.readFileSync(planFile)), JSON.parse(fs.readFileSync(worldFile)));
    result.inputs = { plan: path.resolve(planFile), world: path.resolve(worldFile) };
    result.inputSha256 = Object.fromEntries(Object.entries({ plan: planFile, world: worldFile,
      planner: path.join(root, 'planner.js'), runtime: path.join(root, 'main.js') })
      .map(([name, file]) => [name, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
    result.codeReviewScope = 'Link runtime conclusions and planner root-cause notes describe the source hashes recorded in inputSha256. Recheck those conclusions when game code changes; geometry and acceptance functions are independently reusable.';
    result.acceptance = { defaultFailures: acceptanceFailures(result) };
    fs.writeFileSync(outputFile, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ outputFile, snapshot: result.snapshot, defense: { exposedCore: result.defense.exposedCoreCount,
      exposedResources: result.defense.exposedResourceServiceCount },
      extensions: Object.fromEntries(Object.entries(result.distances.origins).map(([k, v]) => [k, v.extensionStats])),
      exteriorDependentCore: result.distances.origins.spawn.nonResourceTargetsOutsideProtectedConnectedCore,
      roads: { total: result.roads.totalRoadTiles, targetFreeExit: result.roads.targetFreeExitRoadTiles, removal: result.roads.simultaneousRemoval },
      acceptance: result.acceptance }, null, 2));
  }
}
