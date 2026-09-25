# Offline verification runtime

From the repository root, with Node.js 22 and Python 3.11 installed:

```sh
npm ci --ignore-scripts
npm test
```

The root command runs the economy, planner, expansion, monitor, ledger, and
Python API regression checks. Individual JavaScript checks also work from any
working directory, for example `node new-colony/verify-ledger.cjs` from the root.
The Python HTTP tests use mocked responses and temporary fake tokens.

`runtime.cjs` resolves the exact npm versions of the official Screeps packages
used by the original Steam-based checks: `@screeps/common@2.16.0-beta` and
`@screeps/engine@4.3.0-beta`. The lockfile fixes their transitive dependencies.
Tests use the constants and evaluate selected engine processor source files in
isolated VM contexts with explicit mocks. They do not import the engine entry
point, start a private server, build native modules, read game credentials, or
connect to Screeps. Keep `--ignore-scripts` when installing these test packages.

Dashboard checks have their own dependencies and remain separate:

```sh
cd dashboard
npm ci --ignore-scripts
npm test
node verify-ui.cjs
node verify-layout-ui.cjs
```

The GitHub workflow runs both groups with read-only repository permissions and
no game or deployment secrets. UI checks simulate DOM interactions without a
browser or live service. These checks verify offline behavior; they do not prove
live CPU cost, actual throughput, or successful deployment.
