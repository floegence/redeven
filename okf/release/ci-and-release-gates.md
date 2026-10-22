---
type: Release Contract
title: CI and release gates
description: Redeven binds published dependencies, generated assets, UI behavior, release payloads, tests, and OKF to the exact main tip being pushed.
tags: [release, ci, quality, okf]
timestamp: 2026-10-07T00:00:00Z
quality_exception: Exact-main validation order spanning repository checks, generated assets, published dependency contracts, Desktop updates, and compatibility evidence.
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven uses focused checks during implementation, a fast staged pre-commit
gate, and one complete integration gate for the exact main tip being pushed.
Published dependency evidence, generated assets, localized public docs, UI
behavior, Desktop/runtime bundles, Go tests, lint, and OKF must all agree. A
missing, stale, unsigned, optional, or target-mismatched ReDevPlugin artifact
fails release packaging.
Windows is an internal certification target only; the formal release inventory
fails closed if any Windows asset appears.

# Contract

The [self-contained installer distribution](self-contained-installer.md) contract owns prebuilt installer pins, complete suite activation, and the separate guarded default-version promotion after immutable asset publication.

## Validation levels
`AGENTS.md` owns concise global working rules and Git discipline, with an OKF index entrypoint for consultation when additional context is needed.

Redeven native sources and other build output remain scanned; upstream fixture literals must not require disabling a rule for product code.

Workflow cleanup may unregister only its temporary test distributions; product code never performs that system operation.

## Documentation and generated assets
`README.md` is canonical.

Env App builds continue to verify committed assets with `--check`.

## Focused release contracts
The published ReDevPlugin artifact and plugin surface contracts are maintained as focused concepts so this gate remains the owner of exact-main validation order and evidence handoff:

- [ReDevPlugin release artifact gate](redevplugin-release-gates.md) owns upstream publication, runtime evidence, native packaging, and collector inventory. - [Plugin integration gate](plugin-integration-gates.md) owns Host/market/plugin UI integration and its isolated renderer and Desktop smokes.

## Desktop update publication
The protected `redeven-release` environment supplies Developer ID signing, notarization, Sparkle Ed25519, and expected Team ID secrets without committing their values. The hosted Desktop job submits that exact disk image to Apple, requires an `Accepted` result within its bounded wait, and staples and validates its ticket before installer receipts or Sparkle metadata are generated.

Appcasts, signed notes, Linux metadata, and installers are included in the aggregate checksum and remote readback comparison before publication.

## Flower storage compatibility
The [historical writer contract](../ai/flower-upgrade-compatibility.md) is part of every final main integration, including Floret dependency upgrades. Failure and restore tests cover WAL, cross-owner retry, zero execution during preparation, backup protection, full-set replacement interruption and stale outbox rejection.

## Other published boundaries
Floret follows the same published-dependency discipline. Gateway protocol drift fails before packaging.

Workbench PDF drag tests remove only the Vitest runner's outer preview scaling while preserving the product canvas projection, then restore the runner styles after the interaction.

# Boundaries

CI confirms a locally validated pushed tip; it is not the first validator. Generated contracts, markers, lockfiles, assets, and OKF are regenerated from authoritative sources instead of manually stitched.

Integration experiments may exist only on an unmerged feature branch and may not become a fallback, shim, or local artifact path.

# Evidence

- `redeven:scripts/quick_ci_policy.test.mjs` - Enforces bounded source gates and the repository guide line budget and contract links.

- `redeven:internal/envapp/ui_src/scripts/build.py` - Owns the complete Env App asset build under a checkout-local kernel lock.

- `redeven:internal/envapp/ui_src/scripts/buildEnvApp.node-test.mjs` - Exercises overlapping builds, compression ownership, failure/signal release, and independent worktrees.
