#!/usr/bin/env node
'use strict';
// Independent offline acceptance of a concrete layout, including migration.
// node tools/verify-layout-candidate.cjs candidate.json world.json before.json output.json
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const C = require('@screeps/common/lib/constants');
const A = require('./audit-layout.cjs');
const K = p => p.x + p.y * 50;
const D = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const P = k => ({ x: k % 50, y: Math.floor(k / 50) });
const id = s => `${s.type}:${s.x}:${s.y}`;
const brief = s => ({ type: s.type, tag: s.tag, x: s.x, y: s.y, rcl: s.rcl });
const count = items => items.reduce((v, s) => ((v[s.type] = (v[s.type] || 0) + 1), v), {});
const wall = (w, p) => !!(Number(w.terrain[K(p)]) & C.TERRAIN_MASK_WALL);
const baseTypes = ['spawn', 'extension', 'storage', 'terminal', 'lab', 'tower', 'factory', 'observer', 'powerSpawn', 'nuker'];
function role(link) {
  if (['source', 'controller', 'hub'].includes(link.linkRole || link.role)) return link.linkRole || link.role;
  if (/source-link/.test(link.tag || '')) return 'source';
  if (/controller/.test(link.tag || '')) return 'controller';
  if (/hub/.test(link.tag || '')) return 'hub';
  return 'unknown';
}
function verifyCandidate(plan, world, previous, options = {}) {
  const failures = [], warnings = [];
  const check = (test, message) => { if (!test) failures.push(message); };
  check(plan.complete === true, 'Plan is not marked complete');
  check(plan.version === 3, 'Current execution schema requires version=3');
  check(plan.roadVersion === 1, 'Current road executor requires roadVersion=1');
  const structures = plan.structures, byKey = new Map(), actualCounts = count(structures);
  const natural = new Set(A.naturalObjects(world).map(K));
  for (const s of structures) {
    check(Number.isInteger(s.x) && Number.isInteger(s.y) && s.x > 0 && s.y > 0 && s.x < 49 && s.y < 49, 'Invalid room position: ' + id(s));
    check(Number.isInteger(s.rcl) && s.rcl >= 1 && s.rcl <= 8, 'Invalid RCL: ' + id(s));
    check(!!C.CONTROLLER_STRUCTURES[s.type], 'Unknown structure type: ' + s.type);
    check(Number.isFinite(s.priority), 'Missing finite construction priority: ' + id(s));
    check(typeof s.tag === 'string', 'Missing execution tag: ' + id(s));
    if (s.type === 'extractor') check(world.objects.mineral && K(s) === K(world.objects.mineral), 'Extractor not on the mineral');
    else { check(!wall(world, s), 'Structure on terrain wall: ' + id(s)); check(!natural.has(K(s)), 'Structure on natural object: ' + id(s)); }
    const peers = byKey.get(K(s)) || [];
    for (const p of peers) {
      const compatible = s.type !== p.type && (s.type === 'rampart' && p.type !== 'constructedWall' || p.type === 'rampart' && s.type !== 'constructedWall' || new Set([s.type, p.type]).size === 2 && [s.type, p.type].every(t => ['road', 'container'].includes(t)));
      check(compatible, `Illegal overlap: ${id(p)} + ${id(s)}`);
    }
    peers.push(s); byKey.set(K(s), peers);
  }
  check(JSON.stringify(Object.entries(actualCounts).sort()) === JSON.stringify(Object.entries(plan.counts || {}).sort()), 'Declared counts differ from concrete structures');
  for (const type of baseTypes) check(actualCounts[type] === C.CONTROLLER_STRUCTURES[type][8], `RCL8 ${type} incomplete: ${actualCounts[type] || 0}`);
  check(actualCounts.link >= 2 && actualCounts.link <= C.CONTROLLER_STRUCTURES.link[8], 'Link topology must provide explicit useful roles within quota');

  const persisted = [...world.structures, ...world.constructionSites].filter(s => s.type !== 'controller');
  const omitted = persisted.filter(s => !structures.some(p => id(p) === id(s)));
  check(omitted.length === 0, 'Migration omits existing buildings/sites: ' + omitted.map(id).join(', '));
  for (const s of persisted) {
    const p = structures.find(p => id(p) === id(s));
    if (p && p.type !== 'road') check(p.rcl <= world.currentRcl, 'Existing structure reassigned to future RCL: ' + id(p));
  }
  const primary = structures.find(s => s.tag === 'primary') || structures.find(s => s.type === 'spawn');
  check(primary && D(primary, plan.anchor) === 0, 'Anchor differs from primary spawn');
  const finalBlocked = A.movementBlocked(plan, world), minerBlocked = new Set([...finalBlocked, ...(plan.sourcePlans || []).map(K)]);
  const starts = primary ? A.serviceTiles(primary, world.terrain, finalBlocked) : [];
  check(starts.length > 0, 'Primary spawn has no walkable emergence tile');
  const walk = A.flood(world.terrain, starts, finalBlocked, 1, 48);
  const haulerWalk = A.flood(world.terrain, starts, minerBlocked, 1, 48);
  const spawnExits = structures.filter(s => s.type === 'spawn').map(s => {
    const free = A.serviceTiles(s, world.terrain, minerBlocked).filter(k => haulerWalk.visited.has(k));
    check(free.length > 0, 'Spawn lacks an exit after miners occupy stations: ' + id(s));
    return { ...brief(s), emergenceTiles: free.map(P) };
  });

  const stages = [];
  for (let level = 1; level <= 8; level++) {
    const stage = { ...plan, structures: structures.filter(s => s.rcl <= level) }, counts = count(stage.structures);
    for (const [type, amount] of Object.entries(counts)) check(amount <= (C.CONTROLLER_STRUCTURES[type]?.[level] || 0), `RCL${level} ${type} ${amount} exceeds quota`);
    for (const type of ['extension', 'spawn', 'tower', 'lab']) check((counts[type] || 0) === C.CONTROLLER_STRUCTURES[type][level], `RCL${level} misses useful ${type} capacity`);
    const stageBlocked = A.movementBlocked(stage, world), stageStarts = primary ? A.serviceTiles(primary, world.terrain, stageBlocked) : [];
    const stageMap = A.flood(world.terrain, stageStarts, stageBlocked, 1, 48);
    const inaccessible = stage.structures.filter(s => !['road', 'rampart', 'constructedWall'].includes(s.type) && !A.serviceTiles(s, world.terrain, stageBlocked).some(k => stageMap.visited.has(k)));
    check(!inaccessible.length, `RCL${level} unreachable targets: ` + inaccessible.map(id).join(','));
    stages.push({ rcl: level, counts, unreachable: inaccessible.map(brief) });
  }

  const sourceStations = (plan.sourcePlans || []).map(s => {
    const source = world.objects.sources.find(p => p.id === s.id);
    check(!!source, 'Unknown sourcePlan id: ' + s.id);
    check(source && D(source, s) === 1, 'Miner station is not adjacent to source: ' + s.id);
    check(structures.some(p => p.type === 'container' && K(p) === K(s)), 'Source station has no container: ' + s.id);
    check(walk.visited.has(K(s)), 'Miner cannot reach exact stand tile: ' + s.id);
    check(Number.isFinite(s.pathLength) && s.pathLength >= 0, 'Invalid source pathLength: ' + s.id);
    const pickup = A.serviceTiles(s, world.terrain, minerBlocked).filter(k => haulerWalk.visited.has(k));
    check(pickup.length > 0, 'Hauler cannot service occupied miner station: ' + s.id);
    return { ...s, primarySpawnStandDistance: walk.distance[K(s)], haulerPickupTiles: pickup.map(P), allTerrainHarvestTiles: source ? A.serviceTiles(source, world.terrain, finalBlocked).map(P) : [] };
  });
  check(sourceStations.length === world.objects.sources.length && new Set(sourceStations.map(s => s.id)).size === world.objects.sources.length, 'Exactly one station is required for each source');
  const controller = world.objects.controller, controllerSpot = plan.controllerSpot;
  check(controllerSpot && D(controllerSpot, controller) <= 3 && walk.visited.has(K(controllerSpot)), 'Controller work stand unreachable/out of upgrade range');
  check(A.serviceTiles(controller, world.terrain, finalBlocked).some(k => walk.visited.has(k)), 'Controller is not reachable at claim range 1');

  const inputs = structures.filter(s => s.type === 'lab' && /^lab-input/.test(s.tag));
  const outputs = structures.filter(s => s.type === 'lab' && /^lab-output/.test(s.tag));
  check(inputs.length === 2 && outputs.length === 8, 'Labs must declare two inputs and eight outputs');
  const labPairs = inputs.flatMap(input => outputs.map(output => ({ input: input.tag, output: output.tag, range: D(input, output) })));
  // Official engine run-reaction.js uses range 2; no LAB_REACTION_RANGE constant.
  for (const pair of labPairs) check(pair.range <= 2, `Lab reaction range exceeded: ${pair.input} -> ${pair.output}`);
  const blockedLabs = structures.filter(s => s.type === 'lab' && !A.serviceTiles(s, world.terrain, minerBlocked).some(k => haulerWalk.visited.has(k)));
  check(!blockedLabs.length, 'A lab lacks carrier access with miner stations occupied');

  const roadKeys = new Set(structures.filter(s => s.type === 'road').map(K));
  const roadRoutes = (plan.roadRoutes || []).map(route => {
    check(route.complete === true && route.tiles?.length > 0, 'Economic road route incomplete: ' + route.id);
    const tiles = route.tiles || [];
    check(route.length === tiles.length, 'Road route length metadata mismatch: ' + route.id);
    for (let i = 0; i < tiles.length; i++) {
      check(Number.isInteger(tiles[i]) && roadKeys.has(tiles[i]) && !minerBlocked.has(tiles[i]), 'Route leaves unoccupied road grid: ' + route.id);
      if (i) check(D(P(tiles[i]), P(tiles[i - 1])) === 1, 'Nonadjacent/repeated road path step: ' + route.id);
    }
    const target = route.kind === 'source' ? plan.sourcePlans.find(s => s.id === route.sourceId)
      : route.kind === 'controller' ? controllerSpot
      : route.kind === 'mineral' ? structures.find(s => s.type === 'container' && s.tag === 'mineral')
      : route.toTag ? structures.find(s => s.tag === route.toTag) : null;
    if (route.kind === 'service') check(!!target, 'Service route has no real target: ' + route.id);
    if (target && tiles.length) {
      const endpoints = [P(tiles[0]), P(tiles.at(-1))];
      check(endpoints.some(p => D(p, target) <= 1), 'Economic route fails to serve station: ' + route.id);
      check(endpoints.some(p => D(p, plan.roadCore) === 0), 'Economic route misses common roadCore: ' + route.id);
    }
    return { id: route.id, kind: route.kind, tiles: tiles.length };
  });
  for (const source of world.objects.sources) check(roadRoutes.some(r => r.id === 'source:' + source.id), 'Missing source road route: ' + source.id);
  check(roadRoutes.some(r => r.kind === 'controller'), 'Missing controller road route');

  const links = structures.filter(s => s.type === 'link'), hub = links.find(s => role(s) === 'hub'), controlLink = links.find(s => role(s) === 'controller');
  const storage = structures.find(s => s.type === 'storage');
  check(!!hub && !!controlLink, 'Missing explicit hub/controller link roles');
  for (const link of links) check(role(link) !== 'unknown', 'Link has no independently reviewable role: ' + id(link));
  const hubStand = hub && storage ? A.serviceTiles(hub, world.terrain, minerBlocked).filter(k => D(P(k), storage) <= 1 && haulerWalk.visited.has(k)) : [];
  check(hubStand.length > 0, 'Hub has no shared storage/link service station');
  const ctrlStand = controlLink ? A.serviceTiles(controlLink, world.terrain, minerBlocked).filter(k => D(P(k), controller) <= 3 && haulerWalk.visited.has(k)) : [];
  check(ctrlStand.length > 0, 'Controller link has no reachable withdrawal/upgrade station');
  const declaredStations = links.filter(l => l.serviceSpot).map(link => {
    const spot = link.serviceSpot, sourceStation = role(link) === 'source';
    const valid = !wall(world, spot) && !(sourceStation ? finalBlocked : minerBlocked).has(K(spot)) && (sourceStation ? walk : haulerWalk).visited.has(K(spot));
    check(valid, 'Declared link serviceSpot is not a walkable, carrier-reachable station: ' + link.tag);
    check(D(spot, link) <= 1, 'Declared link serviceSpot cannot transfer to link: ' + link.tag);
    if (role(link) === 'hub') check(storage && D(spot, storage) <= 1, 'Hub serviceSpot cannot service storage');
    if (role(link) === 'controller') check(D(spot, controller) <= 3, 'Controller link serviceSpot cannot upgrade');
    return { link: link.tag, position: spot, valid };
  });
  const occupiedHubSpot = hub?.serviceSpot;
  let occupiedHubAccess = null;
  if (occupiedHubSpot) {
    const occupied = new Set([...minerBlocked, K(occupiedHubSpot)]);
    const occupiedWalk = A.flood(world.terrain, A.serviceTiles(primary, world.terrain, occupied), occupied, 1, 48);
    const disconnected = structures.filter(s => baseTypes.includes(s.type) && !A.serviceTiles(s, world.terrain, occupied).some(k => occupiedWalk.visited.has(k)));
    check(disconnected.length === 0, 'Occupied hub station cuts carrier access to: ' + disconnected.map(id).join(', '));
    occupiedHubAccess = { station: occupiedHubSpot, disconnectedCore: disconnected.map(brief) };
  }
  const linkSources = links.filter(l => role(l) === 'source').map(link => {
    const source = sourceStations.find(s => D(s, link) <= 1);
    check(!!source, 'Source link not adjacent to an assigned miner station: ' + id(link));
    if (link.sourceId) check(link.sourceId === source?.id, 'Source link metadata refers to a different miner source: ' + link.tag);
    if (link.targetTag) check(links.some(l => [link.targetTag, link.fallbackTargetTag].includes(l.tag) && l.rcl <= link.rcl), 'Source link primary/fallback target absent at sender activation RCL: ' + link.tag);
    const range = hub ? D(link, hub) : null, cooldown = range && range * C.LINK_COOLDOWN;
    const receivedBatch = C.LINK_CAPACITY - Math.ceil(C.LINK_CAPACITY * C.LINK_LOSS_RATIO);
    const sourceRate = C.SOURCE_ENERGY_CAPACITY / C.ENERGY_REGEN_TIME;
    if (cooldown) check(C.LINK_CAPACITY / cooldown >= sourceRate, 'Source link cooldown limits production throughput: ' + id(link));
    return { ...brief(link), sourceId: source?.id, hubRange: range, fullBatchCooldown: cooldown, maxIdealSendingRate: cooldown ? C.LINK_CAPACITY / cooldown : null,
      maxIdealReceivedRate: cooldown ? receivedBatch / cooldown : null, sourceTheoreticalRate: sourceRate, activationRcl: Math.max(link.rcl, hub?.rcl || 0) };
  });
  check(new Set(linkSources.map(s => s.sourceId)).size === linkSources.length, 'Source links need distinct, real source assignments');
  check(linkSources.length > 0, 'No source-fed link exists to justify the receiving hub');
  const linkTopology = { hub: hub && brief(hub), controller: controlLink && brief(controlLink), hubStandTiles: hubStand.map(P), controllerWorkTiles: ctrlStand.map(P), declaredStations, occupiedHubAccess,
    sources: linkSources, sourcesKeptOnRoadHauling: sourceStations.filter(s => !linkSources.some(l => l.sourceId === s.id)).map(s => ({ sourceId: s.id, stand: {x:s.x,y:s.y}, primarySpawnStandDistance:s.primarySpawnStandDistance })),
    anticipatedHubInboundRate: linkSources.length * C.SOURCE_ENERGY_CAPACITY / C.ENERGY_REGEN_TIME * (1 - C.LINK_LOSS_RATIO),
    runtimeObligations: ['Source links choose useful hub/controller recipients.', 'Receiving hub must be drained to storage or useful demand; carrier withdrawal must include hub link.', 'Haulers must not repeatedly refill a receiving hub from storage.', 'Controller consumers must withdraw or receive energy; storage fallback remains when links are absent or full.'],
    caveat: 'Ideal transfer capacity only; receiving free capacity, miner uptime, carrier capacity, controller allocation and in-game link policy determine real throughput.' };

  const audit = A.auditPlan(plan, world), before = previous ? A.auditPlan(previous, world) : null;
  const outside = A.auditDefense(plan, world).exterior;
  const protectedBlocked = new Set([...minerBlocked, ...outside]);
  const protectedWalk = A.flood(world.terrain, A.serviceTiles(primary, world.terrain, protectedBlocked), protectedBlocked, 1, 48);
  for (const link of links.filter(l => l.serviceSpot && role(l) !== 'source')) check(protectedWalk.visited.has(K(link.serviceSpot)), 'Core link serviceSpot is outside the shared protected movement area: ' + link.tag);
  check(hubStand.some(k => protectedWalk.visited.has(k)), 'Hub/storage shared service position is outside shared protected movement area');
  check(ctrlStand.some(k => protectedWalk.visited.has(k)), 'No controller-link upgrade station is reachable through the shared protected movement area');
  if (occupiedHubSpot) {
    const occupied = new Set([...protectedBlocked, K(occupiedHubSpot)]);
    const safeOccupiedWalk = A.flood(world.terrain, A.serviceTiles(primary, world.terrain, occupied), occupied, 1, 48);
    const disconnected = structures.filter(s => baseTypes.includes(s.type) && !A.serviceTiles(s, world.terrain, occupied).some(k => safeOccupiedWalk.visited.has(k)));
    check(disconnected.length === 0, 'Occupied hub station forces protected core service outside perimeter');
    occupiedHubAccess.protectedDisconnectedCore = disconnected.map(brief);
  }
  if (options.requireRangedBuffer !== false) check(audit.defense.unroofedCoreWithinThreeOfExterior.length === 0,
    `${audit.defense.unroofedCoreWithinThreeOfExterior.length} unroofed core structures remain within range 3 of exterior terrain`);
  const declaredRoadTiles = new Set((plan.roadRoutes || []).flatMap(r => r.tiles));
  const existingRoadTiles = new Set(persisted.filter(s => s.type === 'road').map(K));
  const unassignedRoads = structures.filter(s => s.type === 'road' && !declaredRoadTiles.has(K(s)));
  // Full design files retain service-route explanations; lean execution plans
  // intentionally retain economic routes only and are compared separately.
  if ((plan.roadRoutes || []).some(r => r.kind === 'service')) check(unassignedRoads.every(s => existingRoadTiles.has(K(s))), 'New road tiles have no declared real service target');
  failures.push(...A.acceptanceFailures(audit, { maxExtensionSteps: options.maxExtensionSteps ?? 12, maxExtensionP95: options.maxExtensionP95 ?? 10, requireProtectedCoreService: true, requireExplicitLinkRoles: true }));
  if (audit.roads.targetFreeExitRoadTiles) warnings.push(`${audit.roads.targetFreeExitRoadTiles} road tiles only extend to exits: require explicit cross-room purpose or preservation justification`);
  const missingCarrierAccess = structures.filter(s => baseTypes.includes(s.type) && !A.serviceTiles(s, world.terrain, minerBlocked).some(k => haulerWalk.visited.has(k)));
  check(!missingCarrierAccess.length, 'Core facilities lose carrier access when miners occupy their stands');
  const comparisons = before ? Object.fromEntries(['spawn', 'storage'].map(name => [name, { before: before.distances.origins[name]?.extensionStats,
    after: audit.distances.origins[name]?.extensionStats, beforeExteriorDependentCore: before.distances.origins[name]?.nonResourceTargetsOutsideProtectedConnectedCore.length,
    afterExteriorDependentCore: audit.distances.origins[name]?.nonResourceTargetsOutsideProtectedConnectedCore.length }])) : null;
  return { passed: failures.length === 0, failures: [...new Set(failures)], warnings, snapshot: audit.snapshot, layoutRevision: plan.layoutRevision,
    preservation: { existing: persisted.length, retained: persisted.length - omitted.length, omitted: omitted.map(brief) },
    geometry: { counts: actualCounts, stages, spawnExits, labReactionPairs: labPairs },
    sourceStations, controllerStand: { position: controllerSpot, primarySpawnSteps: controllerSpot ? walk.distance[K(controllerSpot)] : null },
    linkTopology, roadRoutes, roadsWithoutDeclaredRoute: unassignedRoads.map(s => ({ ...brief(s), alreadyBuilt: existingRoadTiles.has(K(s)) })), comparisons, audit,
    policy: { maxExtensionSteps: options.maxExtensionSteps ?? 12, maxExtensionP95: options.maxExtensionP95 ?? 10,
      note: 'These explicit conservative review thresholds are not engine rules or a proof of optimum; protected-core service, preservation and geometry legality are mandatory.' } };
}

function verifyExecutionEquivalence(design, execution) {
  const failures = [], check = (a, b, label) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(label + ' changed during compilation');
  };
  const project = (value, fields) => Object.fromEntries(fields.filter(k => value[k] !== undefined).map(k => [k, value[k]]));
  const structureFields = ['type', 'x', 'y', 'rcl', 'priority', 'tag', 'linkRole', 'sourceId', 'flow', 'targetTag', 'fallbackTargetTag', 'serviceSpot', 'serviceMode', 'roadClass', 'sourceIds', 'roadSwamp', 'roadOrder'];
  const projected = p => p.structures.map(s => project(s, structureFields)).sort((a, b) => id(a).localeCompare(id(b)));
  check(projected(design), projected(execution), 'Executable structure geometry/staging/link/road fields');
  for (const field of ['version', 'layoutRevision', 'anchor', 'sourcePlans', 'controllerSpot', 'counts', 'complete', 'roadVersion', 'roadCore', 'roadMissing', 'hubServiceSpot']) check(design[field], execution[field], field);
  const routeFields = ['id', 'kind', 'sourceId', 'tiles', 'length', 'complete', 'swampTiles'];
  const economic = p => (p.roadRoutes || []).filter(r => ['source', 'controller'].includes(r.kind)).map(r => project(r, routeFields)).sort((a, b) => a.id.localeCompare(b.id));
  check(economic(design), economic(execution), 'Economic route geometry/metadata');
  if ((execution.structures || []).some(s => s.optional || s.enabled === false)) failures.push('Optional/disabled reservation entered active structures');
  return { passed: failures.length === 0, failures, structures: design.structures.length, economicRoutes: economic(design).length,
    omittedDesignOnlyFieldsAllowed: ['optionalReservations', 'provenance', 'label', 'purpose', 'serviceArea', 'non-economic service roadRoutes'] };
}

module.exports = { verifyCandidate, verifyExecutionEquivalence };
if (require.main === module) {
  const [planFile, worldFile, beforeFile, outputFile] = process.argv.slice(2);
  assert(planFile && worldFile && beforeFile && outputFile, 'Usage: verify-layout-candidate.cjs candidate.json world.json before.json output.json');
  const read = file => JSON.parse(fs.readFileSync(file));
  const result = verifyCandidate(read(planFile), read(worldFile), read(beforeFile));
  result.inputs = Object.fromEntries(Object.entries({ planFile, worldFile, beforeFile }).map(([name, file]) => [name, { path: path.resolve(file), sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }]));
  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ outputFile, passed: result.passed, failures: result.failures, warnings: result.warnings, preservation: result.preservation,
    comparisons: result.comparisons, links: result.linkTopology }, null, 2));
  if (!result.passed) process.exitCode = 1;
}
