'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Pinned npm packages match the Steam engine used to establish these checks.
// Only constants and selected processor source files are used; requiring this
// helper never imports the engine entry point or starts a Screeps server.
const constants = require('@screeps/common/lib/constants');
const enginePath = path.dirname(require.resolve('@screeps/engine/package.json'));
const sourceDirectory = path.resolve(__dirname, '..');
const readSource = name => fs.readFileSync(path.join(sourceDirectory, name), 'utf8');

module.exports = { constants, enginePath, readSource };
