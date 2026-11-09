---
type: Storage Contract
title: Product storage placement and lifecycle
tags: [storage, desktop, plugins, skills, recovery]
lifecycle: contract
reviewed_at: "2026-11-08"
---
# Summary

Redeven allocates feature roots; published upstream owners retain opaque formats. Storage inspection reports bounded observations, never deletion authority or backup success. Environment data, Desktop profiles and external projects have separate ownership; relocation requires an explicit offline operation with verified recovery state.

# Contract

`StateRoot` resolves from explicit input, `REDEVEN_STATE_ROOT`, then `~/.redeven`; `StateDir` is its `local-environment` child. Desktop credentials/preferences remain in Electron userData, environment registrations in StateRoot/catalog, independent Gateway and Center in their explicitly selected roots. An Environment backup is not a Desktop profile or external-project backup.

ReDevPlugin receives only `StateDir/apps/plugins/platform`, including its control/data/assets, host adapters and author workspaces. Host migrations, SQL and recovery remain upstream. Retired root-level plugin files block plugin admission unchanged. Product draft records remain in apps/plugin-creation; market snapshots in apps/plugins. Flower Agent Plugins remain separately owned under ai/agent-plugins.

Managed skills use `apps/skills/{packages,state.json,sources.json}` in the selected Environment. Explicit `.agents/skills` remains shared user content. Managed ancestors and metadata reject symlinks/non-directory placement. Disabled/source decisions follow managed files; retired metadata blocks Flower admission. No silent HOME-based fallback imports another Environment's managed skills.

Desktop business caches all use `REDEVEN_DESKTOP_CACHE_ROOT`, or `StateRoot/cache/desktop`. userData is never a disposable cache. Existing cache acquisition, verification and eviction belong to their original owners. Old userData caches are retained; new roots reacquire verified packages without treating userData as disposable.

Config remains one atomic identity/recovery envelope: settings, binding/outbox and one-shot control artifacts cannot be split across independent writes. Provider credentials remain in secrets.json. Neither filename implies export safety. Sanitize settings exports; never export this envelope as portable preferences.

Template catalog entries have no instance ID and publish no invented data path. Existing service inspection exposes actual binding-derived resource identity. New Host allocations retain instances/<service-id>/{install,data,logs}; old resource locations remain their owner's concern.

The administrator-only no-store storage endpoint inspects named Environment locations with one 20,000-entry/two-second budget, without database reads or symlink traversal outside a pinned root. Missing, unavailable and partial observations remain distinct. No global total or completeness claim is made. Settings preserves last successful rows on refresh failure, fences replies on scope/access loss, supports narrow layouts and routes cleanup/recovery to owning features. No generic recursive deletion API exists.

# Pre-release relocation

`scripts/relocate_prerelease_storage.py --state-dir <absolute> [--skills-source <absolute>]` previews exact moves. `--apply` requires the stopped Runtime lease; conflicts, unsupported links, special files or changed fingerprints stop without replacing data. Only relative links inside the renamed author-workspaces tree may be retained: validate every target component and link chain inside that tree without reading through links, hash each link target as opaque evidence, and preserve the original entries by renaming the tree. Absolute, escaping, missing and cyclic targets remain rejected. Other plugin trees and shared skills still reject links. SQLite and sidecars move as opaque bytes; orphan sidecars fail before migration. Shared skills copy only from the explicit source and retain originals; only Redeven-owned path metadata is rewritten. A durable journal binds original product metadata bytes to source fingerprints and permits only the selected lexical/canonical prefix rewrite; external shared-scope decisions remain separate. Explicit source arguments must match the journal. It fences feature admission until verified completion and supports interrupted moves and metadata publication. Interrupted copy stages remain untouched: inspect the reported stage, move it outside the Environment without deletion, and rerun the same command; source fingerprints are checked again. This offline tool is never called by startup and is not a permanent compatibility reader. Do not remove its guard while pending local relocations exist.

## Development startup

`dev_desktop.sh` performs read-only plugin placement preflight before stopping an existing Desktop or building. A blocked profile receives the exact `REDEVEN_STATE_ROOT` recovery command. `--relocate-storage` explicitly previews the selected profile, stops its Runtime, invokes the existing offline transaction and verifies placement before launch. It rejects `--no-stop` and `--stop-only`; normal launch never applies relocation. Unsupported links, conflicting targets and opaque-state validation failures remain fail closed; confined relative author-workspace dependency links follow the explicit offline rule above. A recovery flag does not authorize bypassing those checks. Preview failure leaves the running profile untouched; apply revalidates under the owner locks.

# Boundaries

Flower recovery covers only its declared conversation/read-state/upload/media collection. Managed plugins, skills, task working files, user projects and Desktop state are not implicitly included. Existing owner-specific cleanup and recovery remain authoritative.

# Evidence

- internal/storagecontract: placement, rooted inventory and regression tests.
- scripts/check_storage_ownership.mjs: bounded source gate in quick CI.
- scripts/tests/test_storage_relocation.py: offline lease, conflicts, interruption, opaque bytes and skill metadata.
- StorageSettings.browser.test.tsx: narrow layout, stale-response fencing and retained refresh failures.
