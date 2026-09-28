'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Pinned npm packages match the Steam engine used to establish these checks.
// Only constants and selected processor source files are used; requiring this
// helper never imports the engine entry point or starts a Screeps server.
const constants = require('@screeps/common/lib/constants');
const enginePath = path.dirname(require.resolve('@screeps/engine/package.json'));
const sourceDirectory = path.resolve(__dirname, '..');
const readSource = name => fs.readFileSync(path.join(sourceDirectory, name), 'utf8');

const localModules = new Set([
  'main', 'runtime', 'development', 'logistics', 'workforce',
  'infrastructure', 'metrics', 'planner', 'plans', 'expansion',
  'monitor', 'ledger',
]);

// Load Screeps-style modules inside one VM context. Overrides keep integration
// tests able to replace planner/monitor without flattening production files.
function loadGameModule(context, name) {
  const cache = context.__gameModuleCache || (context.__gameModuleCache = {});
  if (context.gameModuleOverrides && Object.hasOwn(context.gameModuleOverrides, name)) {
    return context.gameModuleOverrides[name];
  }
  if (cache[name]) return cache[name].exports;
  if (!localModules.has(name)) {
    if (typeof context.requireExternal === 'function') return context.requireExternal(name);
    throw new Error('Unknown game module: ' + name);
  }
  const module = { exports: {} };
  cache[name] = module;
  const wrapper = vm.runInContext('(function(require,module,exports){' + readSource(name + '.js') + '\n})', context);
  wrapper(required => loadGameModule(context, required), module, module.exports);
  return module.exports;
}

module.exports = { constants, enginePath, readSource, loadGameModule };
