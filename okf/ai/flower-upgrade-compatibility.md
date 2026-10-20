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
shape and the frozen migration package's dependency boundary. Immutable
`compaction-v7.64.0` and `compaction-v7.68.2` databases and producer source come
from published Floret v7.68.3. They cover repeated automatic compaction,
observations between tools, historical hashes, Fork and nested Fork. Product
setup writes only product-owned settings. Normal push/PR CI and the
[final main gate](../release/ci-and-release-gates.md) check source contracts;
dedicated qualification runs real acceptance against published dependencies: every writer upgrades,
history and read state remain, selected model settings survive, forks retain
attachments, canonical child identity persists, and new turns complete with a
controlled provider. A second startup must not repeat the upgrade.

Additional tests cover readonly rejection, WAL snapshots, Floret-committed and
product-rolled-back imports, cancellation before activation, protected backups,
tampered files, interrupted replacement at every rename, invalidated old
approvals, non-replayed queues and explicit new submissions after restoration.
Floret release adoption also passes its public v7 compatibility and independent
published-module consumer checks before Redeven consumes the version.
Published v7.68.3 atomically migrates proven compaction identities through
schema 26 to 27 and upgrades provider-context lineage to v11 without modifying
old requests. Published v7.72.0 retains that lineage and schema 27-to-28 request-bound measurement migration. The immutable tool-correction-v7.69.1 fixture retains exact ordinary/control failures, confirmed results, Fork and nested Fork. Product qualification verifies safe list/detail/live classification, restart, explicit Retry, new input and Fork through published APIs. Redeven never interprets or repairs those opaque records.

Historical compatibility is a hard release requirement. Dispatch
`flower-history-qualification.yml` for the exact final main commit before
tagging. Release-ref requires its successful Actions evidence before packaging
can start. Failed, cancelled, missing or different-commit evidence blocks the
release. Qualification uses fake providers and copied synthetic data; production
startup never resumes a user's task automatically.

# Boundaries

Historical producers are immutable evidence, never helpers linked into current
production code. Acceptance covers the declared supported writer baseline and
owner migration lineages; it cannot establish compatibility with unrecorded
experimental formats. Source-only CI validates provenance; the dedicated exact
commit qualification owns execution and product continuation evidence.

# Evidence

- `redeven:internal/ai/tool_correction_history_compatibility_test.go` - Exact v7.69.1 failures through product classification, explicit Retry, Send, Fork and restart.

- `redeven:internal/ai/testdata/upgrade/10ce4c152/manifest.json` - Locked compatibility baseline.
- `redeven:internal/ai/testdata/upgrade/10ce4c152-lifecycle/manifest.json` - Real lifecycle and committed-WAL writer provenance.
- `redeven:scripts/check_flower_storage_compatibility.py` - Source-only immutable fixture and decoder checks.
- `redeven:internal/ai/storage_compatibility_test.go` - All-writer product upgrade, continuation and restore acceptance.
- `redeven:internal/ai/compaction_history_compatibility_test.go` - Released compaction history through product startup, continuation and restart.
- `redeven:.github/workflows/flower-history-qualification.yml` - Dedicated exact-commit historical compatibility qualification.
- `redeven:internal/ai/pending_input_migration_startup_test.go` - Cross-owner commit and retry boundary.
- `redeven:.github/workflows/release.yml` - Require exact-commit historical qualification before packaging.
- `redeven:scripts/check_quick_ci.sh` - Bounded hosted source checks.
