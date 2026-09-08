---
type: Compatibility Contract
title: Flower historical writer acceptance
description: Verify every immutable distributed-writer fixture through actual product upgrade and continuation.
tags: [ai, compatibility, fixtures, release]
timestamp: 2026-09-08T00:00:00Z
---
# Summary

- Authority: locked Redeven writers with released Floret dependencies produce fixture bytes; current tests only copy them.
- Outcome: supported historical data upgrades, remains inspectable and can continue a new conversation.
- Invariants: immutable originals, exact source/module identities, digest verification, product write paths and complete final-main acceptance.
- Failure boundary: fixture drift or a failed upgrade blocks integration; a successful database open alone is insufficient evidence.

# Contract

The compatibility baseline is Redeven `10ce4c15212c7f4b6d2a449507b9e47d6bc31d1a`
with published Floret `v7.5.0`. Existing owner migration lineages remain
supported; this does not admit additional discarded experimental formats.

Each fixture directory contains an immutable `state.tar.gz`, `manifest.json`
and the exact historical `producer_test.go.txt`. The manifest binds the archive,
every stored file and producer by SHA-256 and records source commit, Floret
version, Go toolchain, scenario names and canonical IDs needed by assertions.
Current code never serializes a replacement original. Tests verify every digest,
copy into a temporary state directory and use real owner startup and product
operations. All fixture directories participate automatically.

The synthetic provider writes through the actual model HTTP adapter. Product
operations create conversation and tool history, attachments, model changes,
ordinary and nested forks, child threads, read state, waits, queues and
cancellation. A process-exit producer terminates after a harmless test tool
starts, preserving committed WAL and uncertain execution. The expected nonzero
exit is recorded as a fixture event; an unexpected test failure cannot produce
accepted evidence. No real account credentials or user conversations belong in
fixtures.

Before each distributed release, capture an additional writer directory from
its locked production source and exact published dependencies with `GOWORK=off`.
Use a test-only producer compiled against that source, verify the production
files still match the commit, record the writer outcome and archive all managed
data plus provenance. Keep prior originals byte-for-byte unchanged. Select
scenarios that exercise the changed public surface while retaining the common
upgrade matrix. The checked-in producer is provenance, not a current-code
regeneration command.

The source-only check validates closed fixture inventories, digests, provenance
shape and the frozen migration package's dependency boundary. Normal push/PR CI
does not run migration or model tests. The [final main gate](../release/ci-and-release-gates.md)
runs real acceptance against published dependencies: every writer upgrades,
history and read state remain, selected model settings survive, forks retain
attachments, canonical child identity persists, and new turns complete with a
controlled provider. A second startup must not repeat the upgrade.

Additional tests cover readonly rejection, WAL snapshots, Floret-committed and
product-rolled-back imports, cancellation before activation, protected backups,
tampered files, interrupted replacement at every rename, invalidated old
approvals, non-replayed queues and explicit new submissions after restoration.
Floret release adoption also passes its public v7 compatibility and independent
published-module consumer checks before Redeven consumes the version.

# Boundaries

Historical producers are immutable evidence, never helpers linked into current
production code. Acceptance covers the declared supported writer baseline and
owner migration lineages; it cannot establish compatibility with unrecorded
experimental formats. Source-only CI validates provenance, while the exact-main
gate owns execution and product continuation evidence.

# Evidence

- `redeven:internal/ai/testdata/upgrade/10ce4c152/manifest.json` - Locked compatibility baseline.
- `redeven:internal/ai/testdata/upgrade/10ce4c152-lifecycle/manifest.json` - Real lifecycle and committed-WAL writer provenance.
- `redeven:scripts/check_flower_storage_compatibility.py` - Source-only immutable fixture and decoder checks.
- `redeven:internal/ai/storage_compatibility_test.go` - All-writer product upgrade, continuation and restore acceptance.
- `redeven:internal/ai/pending_input_migration_startup_test.go` - Cross-owner commit and retry boundary.
- `redeven:scripts/check_final_integration.sh` - Exact-main acceptance owner.
- `redeven:scripts/check_quick_ci.sh` - Bounded hosted source checks.
