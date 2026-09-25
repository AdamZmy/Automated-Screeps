# Changelog

Version numbers apply to the combined World colony and observatory project.
Each release records its game build identifier separately. Major versions mark
incompatible architecture/configuration changes, minor versions add behavior,
and patch versions correct existing behavior. Development commits remain
individually reviewable; tested releases receive immutable version tags.

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
