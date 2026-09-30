# Independent review: completed experiment history overwritten by successor preparation

- Reviewer: `/root/hauler_review`; parent task: `01a0f43a-9236-7b41-ba14-8022a98b399e`.
- Review run: 2026-09-30T21:43:53Z; implementation verification completed during the same run.
- Scope: `tools/evolution_workflow.py`, its FakeAPI regression harness, and sanitized predecessor/successor experiment records `hauler-20260930T195223821086Z` / `hauler-20260930T214108514416Z`.
- Root owns the controller/test implementation, archive repair, API and deployment. Reviewer writes only this report and runs isolated temporary FakeAPI scenarios. No credentials or live API are accessed; no game source, real controller state, or deployment is changed by reviewer.

## Confirmed mechanism and impact

`start(client, terminal_state)` invokes `prepare_policy` on the old experiment. That sets its phase to `preparing` and calls `save`, which writes both the active state and the old experiment archive. `start` then replaces its local state with a new experiment object and deploys that successor. It never restores the old archive's terminal phase. The active successor can be healthy while completed history remains incorrect.

The supplied predecessor archive has phase `preparing`, `localPreparation.previousPhase = inconclusive`, completed valid baseline and deferred diagnosis. The supplied successor is `baseline`, with a verified policy-only deployment. Predecessor target hashes equal successor deployed hashes, and predecessor deployed hashes equal successor incumbent hashes. These are positive provenance checks for this exact predecessor/successor pair. The actual deferred predecessor has no proposal, so this occurrence did not itself erase a failed-candidate count.

The broader failure-count impact is independently reproduced using the existing `WorkflowTests` / `FakeAPI` fixture: produce a real fixture trial with candidate weight 1, evaluate it as rollback, verify `rolled_back`, then call `start`. Repeat three times. All three predecessor archives change from `rolled_back` to `preparing`, retaining `previousPhase = rolled_back`. The fourth identical weight-1 proposal is accepted as `ready` because `propose` counts only `inconclusive` / `rolled_back` archives. The reproduction performed 10 simulated POSTs and zero live requests. It used temporary copies of the actual controller/game modules and made no permanent source edits.

This is a controller archival defect, not evidence that the running hauler policy changed its routing or that the new baseline is invalid. It is distinct from the catalog's prior concurrency publication issue: a single serialized normal transition reproduces it.

## Minimal safe implementation

1. Give `save` an explicit option to persist only the active state, and pass it through preparation for **successor startup**. `start` should persist the predecessor's active recoverable `preparing` state while leaving its terminal experiment archive unchanged. Trial and rollback preparation should retain their current archive behavior unless separately justified.
2. Preserve existing write order: save old policy snapshot and active preparation metadata before writing the successor policy. Until the successor's `pending` deployment record is persisted, recovery must use the predecessor's known deployed hashes and old policy snapshot. After successor `pending` is persisted, uncertain deployment must use successor hash readback and never automatically repeat POST.
3. Check failure or interrupted preparation may restore active state to the predecessor's exact terminal phase using the existing proven snapshot. All diagnosis, decisions, proposal, baseline/trial evidence and incumbent information must remain intact. Ordinary successor success should not mutate the predecessor archive at all.
4. If repairing already corrupted legacy archives, act only on a non-active record whose phase is `preparing`, whose saved `previousPhase` is one of `kept`, `rolled_back`, `inconclusive`, `invalid_baseline`, and which is linked to a distinct successor by both (a) old deployed hashes = successor incumbent hashes and (b) old preparation target hashes = an explicitly successful successor **baseline** deployment's hashes. Use a verified/unchanged/recovered-by-readback deployment record, not an unverified pending target or unrelated current hashes. Refuse ambiguous/unproven links. Restore only terminal phase/remove preparation metadata and add bounded repair provenance; preserve all substantive historical evidence. `previousPhase` alone does not prove that startup completed.

No live rollback or game-module redeployment is required for this controller fix or the proved archive correction. The current weight-0 baseline can continue.

## Required interruption and history boundaries

| Boundary | Required invariant |
| --- | --- |
| Successor checks run while old active state is `preparing` | Old archive stays terminal, with prior diagnosis/proposal/decision evidence intact. |
| Check throws before successor pending exists | Old policy/active terminal state can be restored; archive never records a false unfinished experiment. |
| Process stops after prepared policy write but before successor state creation/pending | Existing recovery validates local target/deployed hashes and old snapshot, restores old active terminal state, and does not POST. |
| Successor pending persisted, remote upload succeeds but response is uncertain | Old archive remains terminal; successor is recovered by hash readback, with no second POST. |
| Foreign local/remote edit during either recovery stage | Preserve existing refusal rather than restoring or reposting over unrecorded changes. |
| Three real failed paired experiments followed by a new baseline | All three terminal archives remain countable; a fourth identical candidate is rejected. Invalid/confounded decisions remain excluded as before. |
| Legacy old record lacks a successful successor proof, has a nonterminal previous phase, or is currently active | No archive repair. |
| Legacy pair has exact proven hashes and terminal previous phase | Restore just that completed predecessor; leave current active state, game files and successor untouched; repeated repair is idempotent. |

The current first-ever-start behavior without a predecessor is outside this specific successor-archive fix; no claim is made about additional crash boundaries in initial installation.

## Patch verification

Independently reread the root patch: `save(state, archive=True)` conditionally writes the experiment archive; `prepare_policy(..., archive=True)` passes the choice through; only successor `start` invokes `prepare_policy(..., archive=False)`. Existing active preparation persistence and recovery, trial preparation, rollback preparation and pending-deployment handling retain their previous behavior. This implements the recommended minimal fix without a game-policy behavior change.

Executed `python3 -B tools/verify-evolution-workflow.py`: **23 tests passed**, including preservation for all four terminal predecessor phases, interrupted checks, check failure with diagnosis preservation, interruption after checks/before successor snapshot, uncertain successor readback without repost, and three failed paired experiments remaining countable.

Re-ran the exact independent pre-fix oracle using three trial `cycle` rollback verdicts: all three archives now remain `rolled_back`; the fourth identical proposal raises the expected three-failure error. There were 10 FakeAPI POSTs and zero live API calls. An additional isolated interruption/foreign-edit scenario confirmed that recovery refuses a modified local `links.js`, keeps that foreign fixture edit, preserves the terminal archive byte-for-byte, and makes zero additional POSTs.

The proof-gated legacy repair plan is approved for the supplied pair: its exact hash equalities and explicitly verified successor baseline deployment were independently checked. The reviewer has not executed archive repair; root retains that action. A general automatic migration should additionally test all refusal/idempotence boundaries above before being introduced.

No actionable issue remains in the reviewed controller patch. Only this report was written by reviewer. Report ownership released; bounded review ends. Current baseline and gameplay deployment remain root-owned and unchanged by this review.
