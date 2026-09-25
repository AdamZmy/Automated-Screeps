# Changelog

Version numbers apply to the combined World colony and observatory project.
Each release records its game build identifier separately. Major versions mark
incompatible architecture/configuration changes, minor versions add behavior,
and patch versions correct existing behavior. Development commits remain
individually reviewable; tested releases receive immutable version tags.

## Unreleased

- Replace moving-worker delivery targets with fixed structure endpoints, reserved
  delivery quantities, controller workstations and batch construction refueling.
- Support planned source/controller/hub Link roles without hauling energy back
  into the receiving hub; actual activation remains gated by RCL and demand.
- Add RCL milestones, idempotent Issue initialization, structured work checkpoints,
  and recovery instructions for the existing 20-minute colony heartbeat.
- Pin portable offline test dependencies and add read-only GitHub Actions checks.
- GitHub synchronization and the joint game/layout rollout are pending verification;
  these changes are not yet a published release.

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
