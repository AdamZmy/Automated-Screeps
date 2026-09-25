# Screeps Energy Observatory

Production: https://screeps-energy-observatory.vercel.app

Latest production: `dpl_7VB8CtJh17t8tHciwtpZx9MmXGoY`, 2026-09-25 06:28 UTC. [Room layout atlas](https://screeps-energy-observatory.vercel.app/#layout) verified with all 331 API-sourced placements and live telemetry tick73929674 (RCL3, stale=false); static structure snapshot tick73929558. Production assets match local files and integrated DOM interaction checks passed. Atlas implementation is isolated in `public/layout.js` and `public/layout.css`.

Live production data verified 2026-09-25 at 03:54 UTC and again at 03:56 UTC with advancing game ticks. Vercel CLI login and sensitive production credential configuration are complete. Deployment: dpl_4AxSEJv7tEvHECspazQSf6ei7bz1. The previous NOT_CONFIGURED blocker is resolved.

Plain HTML/CSS/JS and a read-only Vercel Node.js API. The server fetches only `Memory.frontier` from AdamZmy/shard1, exports selected telemetry and energy ledger fields, and never exposes a game control endpoint. The game ledger retains at most6000 ticks of history; the website is persistent, not an unlimited historical database.

## Runtime

- Configure `SCREEPS_TOKEN` as a **sensitive production** environment variable in the linked Vercel project, then redeploy production.
- Never put the token in frontend code, request parameters, source/deployment files, logs, or tests. Runtime access goes only to the fixed Screeps HTTPS origin and refuses redirects.
- Visible page polls every60s. Origin cache and CDN cache120s; game capturedAt and stopped tick observations distinguish cached/stale data. 401/403 return safe errors; 429 obeys Retry-After. A cached last-known response is explicitly stale after upstream failure.
- API has GET/HEAD only, no request parameters, and no write capability. `/.env`, local files and test artifacts are not deployed.

## Development and verification

Node22; `npm install`; `npm test`; `node verify-ui.cjs`. `npm run dev` serves on127.0.0.1:4173 when the secret is inherited in the process environment. Do not place it in a command argument or check it into a file.

The current local `.vercel/project.json` is linked to project `prj_cuwCiWWaf5RBdphW5cUTxReWNRhY` under team `team_es8bpWb8MWLmsGuuBTPTk6TR`. Use the existing project and stable alias, not a duplicate. CLI login is separate from connector login. `vercel deploy --prod --yes` applies production environment variables at deployment.

Metric specification and maintenance procedure: `/Users/zmy/screepsworld/new-colony/ENERGY_METRICS.md`. Game code is in that directory, not this frontend. Never touch Screeps Arena.

## Room layout atlas

The `#layout` section reads `/data/room-layouts.json`, an offline export of the actual `Memory.frontier.rooms.W21N26.plan` and an API room snapshot. Terrain, all 331 planned placements, RCLs, construction conditions and observed structure states are preserved. The snapshot date/tick belongs to built/site status; the existing telemetry request updates the current RCL separately through `screeps:telemetry`. The atlas does not add polling, persistent game Memory, pathfinding, or new game code. Static plans and observed construction are not silently presented as live state.

Root refreshes the snapshot after a layout revision or RCL milestone. Run from the game project, wait for a new game tick before reading `layoutProbe`, and verify the tick before export:

```sh
python3 screeps_api.py console --file tools/inspect-layout.js
python3 screeps_api.py memory --path frontier.layoutProbe > state/layout-world-W21N26.json
python3 screeps_api.py memory --path frontier.rooms.W21N26.plan > state/layout-plan-W21N26.json
python3 /Users/zmy/screepsworld/dashboard/tools/build-room-layouts.py --plan state/layout-plan-W21N26.json --snapshot state/layout-world-W21N26.json
python3 screeps_api.py console --file tools/clear-diagnostics.js
```

The exporter reads local artifacts only, publishes whitelisted fields and rejects malformed/incomplete data. From the dashboard directory run `node verify-layout-ui.cjs`, existing `npm test` and `node verify-ui.cjs`, then deploy the existing Vercel project. No token is copied into the atlas. Room coordinates are the original game's x/y, not Arena mirror coordinates.

## 2026-09-25：90%总用能目标

Production `dpl_FTiLVtRqeZvDUdV1n9fMLgGVujm2` 已发布到原域名。主指标使用新版ledger的`utilizationRate / utilization`，计入升级、计划建设、孵化、维修、塔耗能，目标90%。保留旧G/eta为发展投入，新增费用、续代估算和当前用能预算；link损耗、计划外建设、库存单列。

主指标分子分母使用同一组完整样本，不在前端混加旧率。上线初期只有新样本，显示预热和独立覆盖；高于100%保留原值并提示库存透支/可持续性限制。真实用能不等于每笔支出均有必要，禁止用额外消费美化效率。

语法和UI回归通过；生产HTML/JS/API加真实遥测DOM联合验证通过（tick73927638，game .5，新U24/1500 ticks）。没有使用computer use或浏览器自动化。
