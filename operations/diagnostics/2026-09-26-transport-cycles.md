# RCL4 measured transport cycles

Issue #1/#5; coordinator 01a0dd13-1434-7c73-b6c1-69d67742d963.
Build2026-09-25.16, ticks73955174–73955353: 180 consecutive observations.
The result was retrieved after execution resumed the next day. This is historical
RCL4 evidence, not a measurement of the current RCL5 Link routes.

The temporary monitor observer issued no game intents. It restored the original
monitor at73955353. Local tests cover expiry, error restoration, duplicate guard,
fresh Memory attachment and explicit cleanup. Cleanup was read back at73981465.

There were27 actual hauler-to-controller-container transfers totaling3210 energy.
A complete cycle runs from one controller-container delivery, through actual
source-container withdrawals, to the next delivery by that same carrier.
It includes empty travel, collection, loaded travel and delivery waiting.
Boundary fragments and unfinished trips are excluded.

| Route | Complete cycles | Cycle ticks | Median | Delivered energy |
|---|---:|---|---:|---:|
| Near source | 12 | 30,20,27,21,20,34,28,20,24,26,32,28 | 26.5 | 1460 |
| Far source | 6 | 48,35,46,49,34,40 | 43 | 710 |
| Both sources | 3 | 47,48,51 | 48 | 300 |

The21 complete cycles include more than two far-source round trips. The existing
22/40-tick route values are estimates. Mixed-source pickups and multi-tick small
withdrawals occurred; they do not establish that fixed assignment or larger bodies
would improve the colony.

Controller progress increased3178 over179 intervals (17.7542/t). Independent
workforce_review checked all intervals: the six intervals below18 exactly match
the workers' initial carried energy. Each upgrader had two zero-energy samples.
This excludes artificial U001 duty cycling in this window, not every supply issue.

The trace lacks every-tick container free space, complete body capacities and
movement intents. It cannot independently exclude all access/reservation causes,
simulate engine traffic or compare direct, Storage and Link routes at the same
stage. #5 remains verifying pending a current-stage comparison when warranted.

Reusable check: `node new-colony/tools/verify-transport-probe.cjs`.
Root submits `tools/inspect-transport-run.js` only through screeps_api.py, reads
new tick/done evidence, saves local results, then submits
`tools/clear-transport-probe.js`. Accepted requests are not execution evidence.
