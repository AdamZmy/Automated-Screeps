'use strict';
// Negative controls for the independent verifier, using real terrain.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const A = require('./audit-layout.cjs');
const { verifyCandidate } = require('./verify-layout-candidate.cjs');
const root = path.resolve(__dirname, '..');
function fixtureOrSnapshot(fixture, snapshot) {
  const file = path.join(root, 'fixtures', fixture);
  return fs.existsSync(file) ? file : path.join(root, 'state', snapshot);
}
const before = JSON.parse(fs.readFileSync(process.argv[2] || fixtureOrSnapshot('layout-plan-before.json', 'layout-plan-W21N26.json')));
const world = JSON.parse(fs.readFileSync(process.argv[3] || fixtureOrSnapshot('layout-world-before.json', 'layout-world-implementation-before.json')));
const clone = p => JSON.parse(JSON.stringify(p));
const baseline = verifyCandidate(before, world, before);
assert.equal(baseline.preservation.retained, 36);
assert.equal(baseline.audit.defense.exposedCoreCount, 0, 'Old core target tiles are enclosed');
assert.equal(baseline.audit.distances.origins.spawn.extensionStats.max, 24);
assert.equal(baseline.audit.roads.targetFreeExitRoadTiles, 34);
assert.equal(baseline.audit.distances.origins.spawn.nonResourceTargetsOutsideProtectedConnectedCore.length, 6);
assert(baseline.failures.some(f => f.includes('exterior trip')), 'Reachability alone must not pass');
assert(!baseline.failures.some(f => f.includes('Lab reaction range')), 'Known valid lab geometry is a positive control');

const omitted = clone(before), existing = world.structures.find(s => s.type === 'extension');
omitted.structures = omitted.structures.filter(s => !(s.type === existing.type && s.x === existing.x && s.y === existing.y));
assert(verifyCandidate(omitted, world, before).failures.some(f => f.includes('Migration omits')), 'A new plan cannot silently drop an existing extension');

const brokenLab = clone(before);
brokenLab.structures.find(s => s.tag === 'lab-output-9').x = 40;
assert(verifyCandidate(brokenLab, world, before).failures.some(f => f.includes('Lab reaction range exceeded')), 'Counts cannot substitute for valid lab reactions');

const openDefense = clone(before);
openDefense.structures = openDefense.structures.filter(s => !(s.type === 'rampart' && s.x === 11 && s.y === 25));
assert(A.auditPlan(openDefense, world).defense.exposedCoreCount > 0, 'A one-tile breach must be found by independent exterior flood');

const overQuota = clone(before);
overQuota.structures.push({ type: 'extension', x: 2, y: 10, rcl: 2, tag: 'bad-extra', priority: 1 });
assert(verifyCandidate(overQuota, world, before).failures.some(f => f.includes('RCL2 extension') && f.includes('exceeds')), 'Early-RCL quota regression must fail');

const lostMining = clone(before);
lostMining.sourcePlans[0].x++;
assert(verifyCandidate(lostMining, world, before).failures.some(f => f.includes('Miner station is not adjacent')), 'A traversable but invalid miner tile must fail');
console.log('Independent layout verifier: 6 negative/positive control groups passed on real W21N26 terrain.');
