# Changelog

Version numbers apply to the combined World colony and observatory project.
Each release records its game build identifier separately. Major versions mark
incompatible architecture/configuration changes, minor versions add behavior,
and patch versions correct existing behavior. Development commits remain
individually reviewable; tested releases receive immutable version tags.

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
  remain open verification work. GitHub publication requires the user's CLI login;
  local history is preserved independently of remote synchronization.

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
