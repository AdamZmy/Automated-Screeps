# Issue 14 independent baseline review

- Reviewer: `/root/hauler_review`; parent task: `01a0f43a-9236-7b41-ba14-8022a98b399e`.
- Review time: 2026-09-30T21:38:33Z. Read-only diagnosis; root retains API, credentials, controller state, integration and deployment ownership.
- Inputs: `operations/evolution/state.json`, the sole experiment `hauler-20260930T195223821086Z.json`, sanitized `new-colony/state/evolution/review-evidence-01a0f43a.json`, relevant logistics/policy/evolution code, direct test support and L001–L008/W006 catalog entries. No API, UI, Git, controller commands or game-source modifications.

## Recommendation

**Defer weight proposal and recapture targeted decision evidence. No candidate weight is justified yet.** The baseline is complete and usable for its recorded metrics; it does not establish that suboptimal new, nonurgent route ranking is responsible for the observed small loads. Preserve the completed baseline as evidence. Repeating only the same aggregate counters would not resolve this uncertainty. If the room context changes before a later trial, capture a comparable new baseline then.

An addressable, falsifiable hypothesis would be: *on repeated new W21N26 priority > 2 pickup assignments, an available fuller route of the same priority loses to a smaller route under the existing score; a weight within [0, 2] reverses that ranking and reduces real hauling cost without reducing delivered energy or urgent supply*. No supplied snapshot shows that decision boundary or the counterfactual route. A hypothetical fixture can prove that the knob works, but cannot establish that the room encounters that condition.

## Evidence and interpretation

Baseline tick 74045006 → 74046506: 1500 observed ticks, coverage 1, frozen/complete, no invalid reasons, validator ready. Actual transfer events account for 25,320 delivered energy across 217 events and 3,040 hauler ticks: 8.32895 energy/hauler tick and 116.68 energy/transfer event. There were no runtime errors, no recorded idle hauler ticks, and no spawn-starved ticks (101 ticks had queued demand). Bucket minimum 9,480; 9,646 → 9,833. Mean room CPU 3.61080/tick.

`averageTravelPayload = 0.28774` describes 1,617 nonfatigued, loaded delivery move-attempt ticks. It is not pickup departure fill, total trip utilization, empty-return mileage, or a nonurgent-only measure. It can include failed movement attempts. `blocked = 93` is 3.059% of all hauler ticks, not a diagnosis of physical traffic blockage. `waitingPickup = 216` (7.105%) means pickup state without a move attempt or fatigue; successful adjacent pickup intents can satisfy that predicate. It must not be read as 216 avoidable waiting ticks.

Integrated mean capacities were 18.24 CARRY, 19.08 worker WORK and 10.067 miner WORK. The 2–3 hauler count and replacement overlap are compatible with ordinary renewal; the configured demand signature was stable. These metrics are a sound baseline, not evidence that renewal is faulty.

Supplied telemetry tick 74046440 shows two W21N26 haulers each carrying 50, both delivering and neither fatigued nor stalled. Its six history rows (74046340–74046440) have zero drops and zero stalled haulers. One source-side stock rose from 60 to 560 while the other remained 0; neither source reported backlog. This is insufficient to establish sustained overflow or a missed better pickup. Destination types, task priorities, actual decision-time gaps, reservations and competing routes are absent. The newer Game snapshot is tick 74046474; parent reports advancement from 74046274. It shows normal hauler spawning/renewal and workers carrying energy away from the controller. A single such observation cannot establish a persistent worker or transport defect.

The main room's supplied 1500-tick north-star window is stock-drawdown-ineligible (inventory delta −1,225, reported utilization 1.0039). Its consumption rate cannot be presented as sustainable efficiency or a batch-policy benefit. Both rooms are peaceful and have zero dropped energy in supplied telemetry. W23N26 is outside the experiment scope.

Root subsequently supplied status tick 74046500: W21N26 upgrade 16/tick, zero drops, zero sites and 20 worker WORK; W23N26 upgrade 7.8/tick, zero drops and 10 sites. This supports continued operation and does not add decision-time route evidence. The separately reported scout CPU peak remains with Issue 7; root reports no gameplay error.

## What the knob can actually change

`assignTask` first subtracts source and destination reservations, then derives feasible useful amount from source availability, carrier capacity and destination gap. New routes compete within one priority class using `(approach estimate + delivery estimate + 2) / amount / (1 + source pressure / 1000)`. The existing policy therefore already favors useful loads and source backlog, subject to estimated distance. Actual reachability is checked separately.

The extra factor is `1 + weight * (1 − amount/capacity)`. It only reorders new nonurgent routes in W21N26. It does not change urgency order, manufacture source stock or destination capacity, cancel valid retained trips, alter drop pickup semantics, or fix unloading ports. Priorities 0–2 and other rooms retain the incumbent score. Small extension/spawn requests, low source availability, reservations, or urgent controller demand can legitimately produce small loads that this experiment does not change.

For a smaller incumbent route A and fuller alternative B, compare `sA(1 + w*uA)` and `sB(1 + w*uB)`, where `u = 1 − amount/capacity`. B can win only if `sA*uA > sB*uB` and `w > (sB − sA)/(sA*uA − sB*uB)` (allowing the existing tie-breakers at equality). If the threshold exceeds 2, this allowed experiment cannot change that decision. No supplied live candidate pair permits computing this threshold.

## Competing causes and minimal distinguishing observations

| Candidate explanation | Minimal distinguishing observation / falsifier | Relation to batchWeight |
| --- | --- | --- |
| Legitimate urgent or small destination request | At new assignment, record destination type/priority, physical free capacity, request high/gap and incoming/funded/soft reservations. Repeated priority ≤ 2 assignments, or useful gap ≤ 50, explain small loads without a ranking defect. | Urgent score unaffected; no larger useful load exists when the gap is small. |
| Source shortage, link timing or competing pickups | Pair decision-time source inventory with accepted outgoing intents, peer pickup reservations and next-tick actual cargo. If all feasible sources have small available stock, or a reservation explains the remainder, fuller-route preference cannot help. | Changes preference only when an alternate available route exists. |
| Existing score chooses a needlessly fragmented route | Capture new priority > 2 task plus every feasible same-priority source/destination candidate's amount, capacity, estimate, pressure and base score. Replay actual modules offline at 0 and the calculated boundary within [0, 2]; then seek repeated real occurrences and actual transfer/movement evidence. | This is the controlled hypothesis. A ranking reversal alone is not live throughput benefit. |
| Valid committed task or L008-style old amount retention | Follow one carrier over actual delivery event → next-tick empty cargo → new assignment, retaining old/new task identifiers, priority, amount and available source/gap. | Valid retained trips deliberately bypass ranking; current L008 regression passes. |
| Physical access, port reservations or movement contention | For any repeated blocked carrier, compare at least two advancing ticks with precise move target, fatigue, port claims, occupiers and real transfer events. | A route score cannot repair a blocked unloading endpoint. |
| Renewal or worker consumption timing | Track actual capacity, spawning, worker cargo/position and upgrade/transfer events through a complete replenishment cycle; compare with the baseline's integrated capacities and demand signature. | Not established by a single snapshot; do not attribute consumer downtime to batching. |

Root's smallest useful next capture is a bounded set of actual **new** assignments (including their candidate data), plus next-tick cargo and delivery events for those same carriers. Cover at least two independent nonurgent trips if available; stop and report no controlled opportunity if only urgent/single-feasible-route tasks occur. Do not wait for fullness, force tasks, or relax urgent priority to create an experiment. Distinguish observer snapshots from per-tick action evidence. Evaluate any later live trial on actual delivered energy/hauler tick, CPU, blockage and urgent-supply guardrails; payload alone cannot justify adoption.

## Known-catalog check, limited to supplied conditions

| Entry | Finding |
| --- | --- |
| L001 / L002 | No repeated stalled/blocked-port symptom is demonstrated in supplied six telemetry rows. Exact port occupancy/move-target evidence is missing, so broader exclusion is unwarranted. Existing logistics port and idle-clearing regressions pass. |
| L003 | Baseline idle count is 0; both observed main haulers have loaded delivery tasks. This does not show the catalog's loaded-nearby/no-task exclusion by empty reservations. No complete live reservation snapshot was supplied. Loaded-first reclamation regression passes. |
| L004 | No live far-holder/near-blocked-carrier pair is supplied. Cannot diagnose from the aggregate blocked count. Port ownership remains an independent question if repeated movement evidence appears. |
| L005 | Current code permits positive tiny pickups and unloads according to actual available cargo/space; tiny-batch/full-unload regressions pass. A 50-energy observation is not evidence of a minimum-50 rule. |
| L006 | Current port ownership predicate checks hauler/current executor ownership; relevant logistics lease/release regressions pass. No stale-worker lease is demonstrated by supplied observations. |
| L007 | Baseline errors are 0 and supplied moduleErrors is empty. No evidence of the catalog's ReferenceError path; do not promote it as this run's cause. |
| L008 | `reconcileTask` releases a delivered task only after next-tick actual empty cargo. The actual-module regression passes: a completed 9-energy trip is followed by a fresh 450-energy assignment. This excludes the old mechanism in that fixture, not all possible live causes of small loads. |
| W006 | Current reported worker composition is W21N26 10+10 and W23N26 8+8+4, with transitionalCount 0. No current fragmentation symptom in supplied composition. The catalog also uses W006 for the older same-priority financing bug; 0 spawn-starved baseline ticks and ordinary renewal do not demonstrate that bug either. |

Scout Issue 7 / X003 is a separate control surface and was not re-investigated.

## Verification and handoff

Executed existing offline checks with no source edits: `node new-colony/verify-logistics.cjs`, `node new-colony/verify-evolution-policy.cjs`, and `node new-colony/verify-evolution.cjs`; all passed. These establish fixture behavior and telemetry semantics, not a live performance gain. No extra sandbox scenario was needed to invent an unsupported live diagnosis.

Only this report was written; no new fault-catalog entry is warranted. Review complete; reviewer releases report ownership and ends. Root should retain control weight 0 pending targeted recapture and a justified, falsifiable proposal. The recapture specification is for future diagnosis; no extra instrumentation is required this run. Root's proposed defer/start at weight 0 is consistent with this recommendation.
