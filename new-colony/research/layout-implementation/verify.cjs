#!/usr/bin/env node
'use strict';

// Offline reproducibility and independent geometry acceptance. No state/,
// game API, Steam install, or temporary upstream git clones are required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { verifyCandidate } = require('../../tools/verify-layout-candidate.cjs');
const read = name => JSON.parse(fs.readFileSync(name, 'utf8'));
const manifest = read(path.join(__dirname, 'vendor/SOURCES.json'));

for (const source of Object.values(manifest)) {
  assert.equal(source.license, 'MIT');
  assert.match(source.commit, /^[a-f0-9]{40}$/);
  assert(fs.readFileSync(path.join(__dirname, 'vendor', source.licenseFile), 'utf8').includes('Permission is hereby granted'));
  for (const file of source.files) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'vendor', file.path))).digest('hex');
    assert.equal(hash, file.sha256, `Vendored upstream source changed: ${file.path}`);
  }
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'screeps-layout-'));
try {
  const worldPath = path.join(__dirname, 'fixtures/world-W21N26.json');
  const previousPath = path.join(__dirname, 'fixtures/prior-plan-W21N26.json');
  const generated = [];
  for (let i = 0; i < 2; i++) {
    const output = path.join(temp, `candidate-${i}.json`);
    const result = spawnSync(process.execPath, [path.join(__dirname, 'generate.cjs'), worldPath, previousPath, output, path.join(temp, `summary-${i}.json`)], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    generated.push(read(output));
  }
  assert.deepEqual(generated[0], generated[1], 'Fixture generation must be deterministic');
  const plan = generated[0];
  const verdict = verifyCandidate(plan, read(worldPath), read(previousPath));
  assert.deepEqual(verdict.failures, [], JSON.stringify(verdict.failures));
  assert.equal(plan.provenance.adapter.lockedBuildings, 36);
  assert.equal(plan.counts.link, 3, 'No quota-only source or entrance link');
  assert.equal(plan.counts.extension, 60);
  assert.equal(plan.counts.rampart, 41);
  assert.equal(plan.roadRoutes.filter(route => route.kind === 'exit').length, 0);
  assert.equal(plan.optionalReservations.length, 3);
  assert(plan.optionalReservations.every(item => item.optional === true && item.enabled === false));
  assert.equal(verdict.audit.defense.unroofedCoreWithinThreeOfExterior.length, 0);
  const metrics = verdict.audit.distances.origins.storage.extensionStats;
  assert.deepEqual({ mean: metrics.mean, p95: metrics.p95, max: metrics.max }, { mean: 4.317, p95: 7, max: 7 });
  console.log(JSON.stringify({ passed: true, deterministic: true, vendoredFiles: 4, retained: verdict.preservation.retained, counts: plan.counts, storageExtensionSteps: metrics, rangedExposedCore: 0 }, null, 2));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
