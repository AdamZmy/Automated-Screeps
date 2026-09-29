# Changelog

Version numbers apply to the combined World colony and observatory project.
Each release records its game build identifier separately. Major versions mark
incompatible architecture/configuration changes, minor versions add behavior,
and patch versions correct existing behavior. Development commits remain
individually reviewable; tested releases receive immutable version tags.

## 0.6.2 — 2026-09-29

- Game build `2026-09-29.2` reuses stable Hauler tasks, reconciles physical cargo
  once per room/tick and shares bounded approach and near-field port indexes.
  Preserve same-tick accepted resource intents, urgent preemption, legal alternate
  endpoints and idle-carrier traffic clearing.
- Confirmed empty deliveries end their trip before a new pickup is sized; a
  small historical order can no longer cap every subsequent trip.
- Standard half-capacity Haulers renew against future CARRY and serial/parallel
  spawn deadlines, using affordable emergency bodies only at the actual deadline.
  Preserve the 20-WORK worker pool and natural replacement without suicide.
- Add nested self-time CPU breakdown and focused regressions. Online performance
  acceptance remains separate from passing tests and deployment readback.

## 0.6.1 — 2026-09-28

- Game build `2026-09-28.7` shares static Hauler source-to-destination route
  checks across carriers, retains delivery-port leases through short contention,
  and extends stable local path reuse to 50 ticks. Add bounded movement counters
  for route/path cache hits and searches; empty pickup waiting is unchanged.

## 0.6.0 — 2026-09-28

- Game build `2026-09-28.6` implements the reviewed Colony module boundaries:
  economy, mining, development, defense, links and movement own separate work;
  runtime shares tick contexts and accepted resource intents.
- Replace overlapping Hauler flags with idle/pickup/deliver and one stable task,
  dual-end quantity reservations, ordinary storage sourcing, full-route estimates,
  loaded-cargo priority and next-tick reconciliation. Preserve full-fit unloading.
- Centralize all birth and construction intents, coordinate multiple spawns,
  deadlines/funding/role recovery, remaining construction work and critical repair.
- Missions emit requests, hand over to local colonies and require observed local
  birth and stable operation; scouting does not invoke full layout generation.
- Run the real energy ledger independently, isolate faults and defer optional
  planning until after necessary actions. Preserve ledger windows, reviewed
  layouts, disabled Rampart construction and paused external inspection schedule.
- Bound unchanged busy-spawn workforce planning and per-tick logistics indexes so
  repeated body, route, destination and unloading-geometry scans are reused while
  critical births and accepted resource reservations still reconcile every tick.
- Reuse the room-level Hauler assignment during its execution tick, while keeping
  immediate reassignment for temporary non-Hauler transport workers.
- Restrict fixture-only cache invalidation to the test adapter marker so live
  Room objects are never scanned through non-public properties.
- Skip the no-op execution pass for empty idle Haulers after the room has already
  published its tick assignment; direct unprepared helper calls remain supported.
- Reset the prepared flag whenever a fixture snapshot changes, so newly appeared
  sinks and sources invalidate the cached assignment before the fast path.

## 0.5.3 — 2026-09-28

- Game build `2026-09-27.5` stops creating Rampart construction sites. Existing
  Rampart structures and their planned coordinates remain intact.
- Add an explicit operational command that removes every active Rampart
  construction site during the emergency cancellation.

## 0.5.2 — 2026-09-28

- Add five newly observed cold-room layouts to the lossless static archive so
  the runtime can replace their full Memory payloads with restorable summaries.
- Add a one-room-at-a-time operational compactor for verified archives when the
  normal low-bucket guard intentionally pauses automatic migration.

## 0.5.1 — 2026-09-28

- Game build `2026-09-27.4` keeps completed room planning on its 10-tick
  construction cadence and pauses decorative room text while the CPU bucket is
  below 500.

- Game build `2026-09-27.3` shares per-tick room object snapshots across role,
  workforce, infrastructure and monitoring code instead of repeating the same
  `room.find` and global-creep scans for every creep.
- Cache Controller station geometry, upgrader groups, construction priority and
  Link classification for one tick while retaining target-destruction and
  construction-change validation.
- Remove the second unchanged delivery-plan calculation from each Hauler action.
  Energy thresholds, staffing policy and action priority remain unchanged.

## 0.5.0 — 2026-09-28

- Game build `2026-09-27.2` turns `main.js` into a 39-line composition root.
  Existing behavior is separated into runtime helpers, development/worker actions,
  logistics, workforce planning, infrastructure and CPU-metrics modules.
- Preserve the existing tick order and gameplay policy. The full economy, hauling,
  planner, expansion, monitor, ledger and API regressions pass against the modular
  loader; no energy or spawning threshold changes are included in this release.
- Extend the API deploy/check manifest so every new module is uploaded, hashed,
  backed up and verified with the existing remote modules.
- Add a README task-to-file routing table and dependency map so future work starts
  from the relevant module and direct interfaces instead of rereading all logic.

## 0.4.3 — 2026-09-27

- Game build `2026-09-27.1` sizes new upgrader/builder bodies for the remaining
  effective capacity, including candidate upkeep, travel/refill duty and replaced seats.
  Existing fueled workers continue acting; no action quotas or forced recycling.
- During measured CPU overload with less than 50 limit-ticks of bucket reserve,
  pause discretionary births while preserving missing essential roles and miner renewal.
  This prevents additional load; it does not instantly remove existing CPU cost.
- Recover an obsolete bootstrap timeout only after the target is owned and its first
  Spawn exists. Other expansion blocks and self-sufficiency checks remain intact.
- Count pioneers in their assigned, concurrently observed owned target within the
  physical ledger; preserve border imports/exports and exclusion of unobserved transit.
- Distinguish supported, unattended and post-Spawn bootstrap alerts. Preserve home
  rosters and add bounded physical-support summaries.
- Add bounded temporary transport observation tools and refresh the RCL5 map snapshot.

## 0.4.2 — 2026-09-25

- Game build `2026-09-25.16` fills the controller container according to its
  physical free capacity, removing the artificial low/high target watermark.
- A courier at any delivery target unloads all carried energy that physically fits,
  rather than clipping the transfer to its earlier task reservation. Preserve
  emergency sink priority and account for actual same-tick transfer promises.
- Remove action-budget duty cycling for upgrading and construction. Fueled
  workers perform valid work each tick; economic rates plan staffing and supply.
- Reuse completed builders for upgrading, including rooms with storage. Replace
  arbitrary body/room carrying caps with energy, demand and physical body limits.
- Remove minimum pickup/delivery batches and the fixed link-transfer threshold;
  retain actual resource, capacity, cooldown and net-delivery constraints.
- Add independent regressions for full unload, genuinely full-container partial
  unload, same-tick capacity, and controller demand above the former watermark.

## 0.4.1 — 2026-09-25

- Game build `2026-09-25.15` lets ready cargo reclaim only unfunded pickup
  promises; preserve carried cargo and accepted same-tick pickup/transfer intents.
- Limit exclusive unloading-tile reservations to nearby couriers. Distinguish
  brief port contention from an unreachable destination, with bounded recovery.
- Add independent counterfactual regressions for empty-carrier quantity blocking
  and distant-carrier tile blocking; retain both as L003/L004 checks (#1, #5).
- Quantize fractional buffer watermarks to whole energy before lease reclamation;
  discard inherited sub-unit tasks found during the first live verification.
- Live deployment and sustainable throughput acceptance are recorded separately.

## 0.4.0 — 2026-09-25

- Require an independent fault reviewer after inspection findings: reuse known
  checks, compare competing explanations, reproduce mechanisms in a sandbox,
  and retain confirmed checks plus unresolved hypotheses for later runs.
- Add a fault catalog and an independent real-terrain hauling regression oracle
  to the default offline checks. Keep full diagnostic reasoning outside game Memory.
- Game build `2026-09-25.13` uses reachable alternative unloading tiles when the
  preferred tile is blocked, with room-scoped active tile reservations and bounded
  recovery. Adjacent transfers, work seats and delivery quantity promises remain.
- Update the existing inspection automation without changing its 20-minute
  standalone schedule. Long-window energy and real hauling-cycle acceptance
  remain open in #1, #4 and #5.

## 0.3.2 — 2026-09-25

- Keep overflow controller workers off delivery ports and planned approach roads,
  and reserve fixed seats for viable workers with useful WORK capacity (#1, #4).
- Separate sustainable development spending from worker capacity estimates;
  account for initial travel, mobile refill duty and prospective replacement cost.
- Use station-aware upgrader and fuel-aware builder bodies. Admit a stronger
  fixed-seat worker only for an uncovered, worthwhile capacity gain; preserve
  incumbent lives, emergency spawning and the shared spending limit.
- Game build `2026-09-25.12`; live acceptance evidence is recorded separately in
  the inspection journal and Issues. Sustainable 90% utilization remains open.

## 0.3.1 — 2026-09-25

- Align journal-writer validation with the deployed reader for malformed URL
  encodings, shard-name length and World room names, so locally accepted records
  cannot fail these same field checks on the website. Journal regressions pass.
- No game behavior or deployed website assets changed in this validation patch.

## 0.3.0 — 2026-09-25

- Add one GitHub-backed journal per inspection, including unchanged, blocked,
  skipped and failed runs. Preserve same-run progress as Git revisions and keep
  bounded latest-run summaries alongside complete date archives (#12).
- Add the `/logs` page with date/status selection, shareable run details, linked
  Issues, findings, progress, actions, checks and next steps. The read-only API
  fetches public GitHub data without game credentials; new logs need no redeploy.
- Verify strict log schemas, safe text/link rendering, concurrency and stale/error
  behavior. Log-only pushes use a small archive check instead of game regression CI.
- Separately, game build `2026-09-25.11` shares unused construction and upgrading
  budgets while preserving the combined development pool (#4, commit `2c1c04a`).
  Five game regression suites passed; long-term energy and logistics acceptance
  remains open and must be judged from fresh game windows.

- Move the 20-minute inspection to independent scheduled conversations (#11), restoring
  work from a bounded CURRENT_STATE handoff, Issue checkpoints and fresh API data.
- Load historical logs and research only when needed; check previous coordinator
  and worker ownership before a fresh run takes over files or deployment.
- The conversation migration itself changes no game behavior; the `.11` budget
  fix and journal website are tracked independently in this release.

## 0.2.0 — 2026-09-25

- Replace moving-worker delivery targets with fixed structure endpoints, reserved
  delivery quantities, controller workstations and batch construction refueling.
- Support planned source/controller/hub Link roles without hauling energy back
  into the receiving hub; actual activation remains gated by RCL and demand.
- Add RCL milestones, idempotent Issue initialization, structured work checkpoints,
  and recovery instructions for the existing 20-minute colony heartbeat.
- Pin portable offline test dependencies and add read-only GitHub Actions checks.
- Activate the reviewed International/Overmind-derived main-room plan: 205
  placements, 71 roads, 41 ramparts and 3 purposeful Links. Preserve all 36 built
  facilities and all earlier archive versions; keep research outside runtime Memory.
- Publish the matching RCL map with Link roles and conditional reservations to
  the existing Vercel dashboard. Cold-room plans remain on their earlier revision.
- Correct the native coordinate-overload mismatch found after the first rollout;
  strict engine-backed tests now cover plain planned coordinates and both layouts.
- Game build `2026-09-25.10` is live, with actual four-seat occupation confirmed
  at tick73930387 and stable operation at73930400. Dashboard production
  `dpl_2QHBtL9eZefWFx8L9oyVX1y4ytet` returns build `.10` at tick73930409.
- Long-window sustainable 90% utilization and comparable CPU/travel-cost checks
  remain open verification work (#4 and #1). GitHub authentication and publication
  were completed on 2026-09-25: both release tags, ten Issues and four milestones
  are available remotely, and the initial offline CI passed both jobs.

## 0.1.0 — 2026-09-25

Baseline imported into the existing Automated-Screeps history before the fixed
handoff change. Earlier root-level Screeps files remain available as legacy code.

- Game build: `2026-09-25.8`, deployed six-module World colony in `new-colony/`.
- Existing mining, hauling, construction, upgrading and expansion controller.
- Static cold-room layout archive and bounded CPU/energy telemetry.
- Vercel energy dashboard and RCL 1–8 map in `dashboard/`.
- API-only game access; credentials, deployment backups and diagnostic snapshots
  remain local and are excluded from Git.
- Fixed-point logistics is documented as a proposal at this baseline and is not
  yet implemented.

Historical dated game builds are documented in `new-colony/LIVE_STATUS.md`;
this baseline does not manufacture Git commits for changes made before Git tracking.
