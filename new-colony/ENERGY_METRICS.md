# Energy north star and operating loop

Initial ledger implemented in release `2026-09-25.3`; total-use metric and supply fixes added in `.5`. Sources: `ledger.js`, `monitor.js`, `main.js`.

## Definitions and scope

- Primary window: 1500 ticks; fast diagnostic window: 300; long view: 6000.
- **Primary total energy utilization U** = (actual controller upgrades + plan-matched construction + actual spawning + repairs + tower operations) / theoretical source energy in the same fully classified samples. The user's target is **U ≥ 90%**. `utilizationRate` is its energy/tick numerator and `utilization` is the ratio. `usefulOperatingCostRate` contains spawning, repairs and tower operations; `utilizationProductiveRate` contains growth, both from that exact same sample set.
- U counts policy-directed operating expenditure as well as development, but spending is not proof that every expense was optimal. Verify births against role demand/replacement deadlines and maintenance against damage/defense thresholds; never spawn redundant bodies or perform unnecessary repairs just to raise U. Keep growth output, drops and stock visible beside U.
- `G = (actual controller-upgrade energy + plan-matched construction energy) / observed ticks`.
- `eta = G / theoreticalRate`. Owned source potential is capacity / regeneration interval, independent of mining WORK. Current two ordinary sources provide a theoretical 20 energy/tick, not a measured harvest rate.
- Upkeep is not added to G. `operatingCostRate` includes observed spawning, repairs, tower operations, link losses and construction outside the saved room plan. `expenseRate` includes G plus those costs; do not label it operating cost or subtract it again from G.
- Link losses and unplanned construction remain separate and are excluded from U. Inventory accumulation, including reserves, is an allocation of energy rather than energy already used; it is also excluded from U. Show reserve demand separately. Imports and stock drawdown can temporarily lift U above 100%; never clamp away this evidence or describe it as sustainable achievement.
- Inventory includes owned structures and resident owned creeps, neutral containers, energy drops, tombstones and ruins. Unharvested source energy is excluded. Transfers within this scope do not count as income or output.
- Signed residual = harvest + observed imports − exports − known spending − inventory change. It is **not measured waste**. Positive values can include decay; negative values can include passive spawn regeneration and refunds. Do not present theoretical capacity minus harvest as exact physical loss within short windows.
- Current scope is physical owned rooms. Own-creep border cargo is recorded, but remote mining and advanced terminal/lab/factory/power flows are explicitly marked incomplete and excluded from automatic efficiency judgments. Extend attribution before relying on the metric after establishing those systems.

## Sampling and accuracy

`monitor.tick` invokes `ledger.observe` every game tick before its usual 20-tick reporting gate. `Room.getEventLog()` reports the previous tick. Real server-created spawning creeps prove spawn costs; ID-less same-tick spawn placeholders do not. Previous actor/site snapshots preserve death and completed-building attribution. Boosted building uses official engine semantics; ambiguous completions are marked missing, not estimated as zero.

`Memory.frontier.energy.rooms[room]` contains inventory, latest sample, windows, 20-tick history, scope and indicator. Internal fields prefixed `_` are not public dashboard data. History holds at most 300 completed buckets (6000 ticks), not an unlimited archive. Every 20 ticks, `capturedAt` supplies a wall-clock freshness timestamp. A fresh HTTP response alone does not mean the game advanced.

Window rates use explicitly reported coverage. `inventoryDelta` and `residual` are window energy totals; their `*Rate` counterparts are energy/tick. `totals` contains actual accumulated costs. Productive, balance and inventory coverage may differ, and the UI must not force them into a falsely exact diagram.

U has its own `utilizationObservedTicks`, `utilizationCoverage`, `utilizationWarmingUp`, `utilizationEligible` and `utilizationBlocked`. Legacy samples lacking its joint coverage fields are not reconstructed by adding mismatched rates. Following `.5`, U initially warms up while old G history remains. Missing accounting is separate from missing growth or physical scope. Bounded `recentReasons` records help diagnose exclusions.

## Alert and intervention policy

The primary target is U ≥ 0.90. `utilizationIndicator` becomes pending after a fully observed eligible 300-tick window below target and active after an eligible 1500-tick window. Eligibility requires complete scope/accounting, no import subsidy or stock drawdown, and bounded unexplained balance. The original `eta < 0.35` development alarm remains an independent severe-growth guard; 35% is not a performance target. Initial warmup is not confirmed low efficiency, nor is it evidence of health.

An ineligible window is not evidence of a healthy room. Persistent missing accounting, residuals, source overflow, absent miners and stopped upgrading require their own diagnosis. Do not wait 1500 ticks to correct a independently confirmed production or logistics failure.

When low performance is sustained, inspect in order: actual harvest and source coverage; source-side stock/drops; transport route duration, carrying capacity, fatigue and blocking; worker supply and actual productive events; spawn replacement/maintenance costs; spending policy, reserves and CPU. Save the baseline, make a bounded change, run relevant tests, deploy via API, verify a new version/tick and compare subsequent windows. Never react to one sample or burn reserves merely to increase G.

`main.js` now plans hauler CARRY from source capacity and route round-trip cost, with a confirmed backlog increment. Decisions run on a 100-tick cadence; reductions require 300 ticks. Miner renewal includes spawn/travel/queue lead time. Necessary construction gets a measured energy duty budget, then remaining income supports upgrading; storage modes have 12000/18000 hysteresis. Credible drawdown data may reduce spending; automatic increases based on low efficiency require the confirmed indicator.

Release `.4` fixes a confirmed budgeting defect: only fueled, work-ready builders in range of their own current construction target share the duty denominator. Traveling/refueling/temporarily yielding workers do not consume construction quota, and travel is not duty-throttled. A retired 4-WORK miner outside construction range had reduced the productive 3-WORK group's expected throughput to about 5.1 energy/tick. The regression restores approximately 11.85 within an 11.93 budget; actual post-deployment throughput still requires game observations.

Release `.5` corrects supply priority confirmed at tick73927519: the controller container held 760 energy for only 2/t upgrading while builders had 3.5–4 ticks of fuel. Urgent worker delivery now precedes ordinary controller restocking. The controller buffer uses actual primary upgrading WORK, with emergency threshold max(25,10×rate) and ordinary threshold min(1500,max(100,50×rate)); these trigger deliveries rather than cap a batch. Spawn and tower priorities remain. Builder readiness now agrees with the 90% delivery high-water mark; this fixes a reproducible code mismatch, not a proven cause of every low-throughput sample.

The `.5` ledger also recognizes tombstones/ruins as withdrawal event actors. Previously, those normal transfers could discard an entire tick's growth measurement. Unknown transfers now affect accounting completeness without falsely removing independently observed growth. No historical values are fabricated.

Release `.7` includes finished growth-stage builders in the shared upgrade workforce. After construction, repair and storage fallbacks are exhausted, such a builder changes to upgrader and starts budgeted work next tick. Previously a 2-WORK builder added about2/t beyond the14/t upgrade plan while regular upgraders alone shared that plan. The conversion prevents this hidden budget bypass and includes its body in replacement demand. Bootstrap, pioneer, infrastructure gaps and downgrade emergencies retain their prior behavior. This corrects spending attribution/control; it does not itself prove higher sustainable utilization.

## Dashboard and persistent review

- Project: `/Users/zmy/screepsworld/dashboard`.
- Stable address: https://screeps-energy-observatory.vercel.app
- Vercel team `team_es8bpWb8MWLmsGuuBTPTk6TR`, project `prj_cuwCiWWaf5RBdphW5cUTxReWNRhY`.
- Web page checks every 60 seconds while visible. Server/CDN cache is 120 seconds; this is near-live telemetry, not tick streaming. No local computer is needed once the production server token is configured. Game-side logging runs even when the page is closed.
- The website exposes only an allowlisted read-only telemetry response. Screeps credential belongs in Vercel's sensitive production environment variable `SCREEPS_TOKEN`; never in public files, browser requests, game Memory or deployment source. Runtime requests carry it only to fixed `https://screeps.com`, with redirects refused. The user's website request authorizes storing that credential as the server-side Vercel secret; this is distinct from sending it to arbitrary hosts.
- Existing `screeps-world` heartbeat remains every 20 minutes. It reads these metrics through the local API, diagnoses persistent problems and performs authorized fixes. Quiet for unchanged or nonactionable state; notify only meaningful changes, failures, intervention results or required user action. The heartbeat depends on Codex execution; deployed game control does not.
- Production data connected on 2026-09-25 at 03:54 UTC after the user completed Vercel CLI login. Sensitive production environment configuration and deployment `dpl_4AxSEJv7tEvHECspazQSf6ei7bz1` succeeded; unauthenticated public GET returned actual tick73927338 and fresh telemetry. Consult `LIVE_STATUS.md` for later state. Do not reopen the resolved login blocker.

## Checks

Game: `node verify-ledger.cjs`, `node verify-monitor.cjs`, `node verify-economy.cjs`; API: `python3 verify-api.py`. Dashboard: `npm test` and `node verify-ui.cjs`. Test evidence does not substitute for live throughput or CPU observations.
