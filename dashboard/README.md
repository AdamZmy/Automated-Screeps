# Screeps Energy Observatory

Production: https://screeps-energy-observatory.vercel.app

Inspection journal: https://screeps-energy-observatory.vercel.app/logs . This independent page reads public per-run logs from the existing GitHub repository through `/api/inspections`; it does not read Screeps credentials or call game APIs. Records include findings, linked Issue progress, actions, verification and next steps. Dates are archived in UTC; displayed times use the viewer's local timezone. Each run has a shareable `/logs?id=<run-id>` URL and a GitHub Markdown record with revision history.

The index shows the latest 50 runs; choosing a date loads that day's full index. Initial `running` records and later progress/final updates share one run ID. Kind `setup` is system work and `backfill` is explicitly historical; neither is silently treated as a fresh game observation. Empty, unavailable and stale states are distinct. The page polls while visible every60s; the read API uses short bounded caching, a fixed GitHub source, no secrets and no write methods. Pushing journal files updates the page without a Vercel redeployment. Format and publication procedure live in `operations/inspection-format.md` and `operations/inspection-logging.md` at repository root.

Journal checks: `npm test` includes the API suite; `node verify-logs-ui.cjs` exercises deep links, filtering, progress/evidence, error retention and text safety. Log-only commits run the small Python archive validator in GitHub Actions instead of all game regressions.

Latest production: `dpl_8XDer13JsGK6pTeijgo1p4Vu7frB`, 2026-09-26, refreshes the RCL4 construction atlas from API tick73952842 (54 matched built, 151 planned, zero sites; Storage at24,29). Export checks7/7, API tests28/28, layout/UI regressions passed. The preceding `dpl_BResWyWLagg3GKWRPZ7UPXTZuP2X`, 2026-09-25, added the inspection journal. Production HTML/JS/CSS match local assets; root/day/detail log APIs and combined real-data DOM rendering passed. A second record pushed after deployment appeared without redeployment.

Prior layout release: `dpl_2QHBtL9eZefWFx8L9oyVX1y4ytet`, 2026-09-25. [Room layout atlas](https://screeps-energy-observatory.vercel.app/#layout) publishes reviewed revision `2026-09-25-international-adapter-1`: 205 formal placements, 3 formal Links and 3 explicitly optional reservations. Geometry exactly matches the live API plan; observed construction snapshot tick73930304 has 36 built / 3 sites / 166 planned. Link directions, use conditions and advisory neighboring-room roles are included without extra game Memory or polling. At that release production API verified tick73930409, game build `2026-09-25.10`, `stale=false`; downloaded assets and combined energy/layout DOM checks passed.

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

The `#layout` section reads `/data/room-layouts.json`, an offline export of the actual `Memory.frontier.rooms.W21N26.plan` and an API room snapshot. Terrain, planned placements, RCLs, construction conditions and observed structure states are preserved. The snapshot date/tick belongs to built/site status; the existing telemetry request updates the current RCL separately through `screeps:telemetry`. The atlas does not add polling, persistent game Memory, pathfinding, or new game code. Static plans and observed construction are not silently presented as live state.

Root refreshes the snapshot after a layout revision or RCL milestone. Run from the game project, wait for a new game tick before reading `layoutProbe`, and verify the tick before export:

```sh
python3 screeps_api.py console --file tools/inspect-layout.js
python3 screeps_api.py memory --path frontier.layoutProbe > state/layout-world-W21N26.json
python3 screeps_api.py memory --path frontier.rooms.W21N26.plan > state/layout-plan-W21N26.json
python3 /Users/zmy/screepsworld/dashboard/tools/build-room-layouts.py --plan state/layout-plan-W21N26.json --snapshot state/layout-world-W21N26.json --design fixtures/layout-design-reviewed.json --intel state/expansion-research-input.json
python3 screeps_api.py console --file tools/clear-diagnostics.js
```

The exporter reads local artifacts only, publishes whitelisted fields and rejects malformed/incomplete data. From the dashboard directory run `python3 verify-layout-export.py`, `node verify-layout-ui.cjs`, existing `npm test` and `node verify-ui.cjs`, then root deploys the existing Vercel project. No token is copied into the atlas. Room coordinates are the original game's x/y, not Arena mirror coordinates.

### Link semantics and regional planning

Schema v2 accepts explicit `linkRole`, `label`, `purpose`, `targetTag`, `fallbackTargetTag`, `flow`, `serviceArea` and `serviceSpot`. Use `--design` for the local reviewed design: the exporter requires an identical nonempty `layoutRevision` and an exact ordered match of every `(type,x,y,rcl,tag)` against the final API execution plan. A mismatch is an error. Only display semantics, optional reservations and whitelisted provenance are read from the design; coordinates, RCL, build state and observation time remain authoritative from the API plan/snapshot. The lean execution plan does not need long descriptions or optional strategies in game Memory.

H/C/S map labels and dashed arrows show planned transport responsibilities, not measured energy flow or road paths. Arrows appear only when both formal endpoints are visible at the selected RCL/type filter; when the preferred controller Link is not yet in the selected stage, the documented hub fallback is used. The linked role cards locate the building and explain its service area. Existing dated construction states remain unchanged by telemetry.

`plan.optionalReservations` is separate from `structures`: these positions are candidate reservations, always disabled in this export, omitted from formal structure/RCL counts and rendered with a dashed `?` only at their stated earliest RCL. They list their active-remote, saved-CARRY and narrative prerequisites; reaching a level does not activate construction. Enabled entries must migrate into a formal plan rather than be silently exported as disabled candidates. The exporter rejects malformed coordinates, terrain walls and enabled reservations. Missing planning semantics are shown as unavailable instead of inferred as completed work.

The optional `--intel` input joins root-provided, dated `intel.exits/sources/seen` to local recommendations for W22N26, W21N25, W23N26 and W21N24. Paths follow observed exits. The resulting regional cards explicitly describe candidate uses, retain each room's separate observation tick and never claim mining or colonization is enabled. This planning context is static and refreshes only when root exports a new verified payload. It does not change the game policy or add another HTTP request. Research basis: `/Users/zmy/screepsworld/new-colony/research/remote-link-strategy.md`.

The new display/export logic was verified locally with DOM and exporter checks. A new public payload must come from root's final API readback; local plan-generation output alone does not prove the plan is active in game. Deployment remains root's responsibility. For an unpublished candidate preview, add `--preview --output test-output/room-layouts-candidate.json` and run `node verify-layout-ui.cjs test-output/room-layouts-candidate.json test-output/layout-candidate.svg`; this labels it as an unverified local candidate and refuses output under `public/`. Omit `--preview` only after root has verified the final API readback. SVG rendering can be performed locally with a file renderer and needs no browser automation.

## 2026-09-25：90%总用能目标

Production `dpl_FTiLVtRqeZvDUdV1n9fMLgGVujm2` 已发布到原域名。主指标使用新版ledger的`utilizationRate / utilization`，计入升级、计划建设、孵化、维修、塔耗能，目标90%。保留旧G/eta为发展投入，新增费用、续代估算和当前用能预算；link损耗、计划外建设、库存单列。

主指标分子分母使用同一组完整样本，不在前端混加旧率。上线初期只有新样本，显示预热和独立覆盖；高于100%保留原值并提示库存透支/可持续性限制。真实用能不等于每笔支出均有必要，禁止用额外消费美化效率。

语法和UI回归通过；生产HTML/JS/API加真实遥测DOM联合验证通过（tick73927638，game .5，新U24/1500 ticks）。没有使用computer use或浏览器自动化。
