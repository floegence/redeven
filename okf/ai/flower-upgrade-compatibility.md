---
type: Compatibility Contract
title: Flower historical writer acceptance
tags: [ai, compatibility, fixtures, release]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Immutable fixtures come from locked released Redeven writers; current tests copy and verify them. Supported history must remain readable and continue after upgrade. Preserve source/module digests and public write paths. Fixture drift or upgrade failure blocks integration; database open alone is insufficient.

# Contract

The compatibility baseline is Redeven `10ce4c15212c7f4b6d2a449507b9e47d6bc31d1a` with published Floret `v7.5.0`.

The manifest binds the archive, every stored file and producer by SHA-256 and records source commit, Floret version, Go toolchain, scenario names and canonical IDs needed by assertions.

Qualification uses fake providers and copied synthetic data; production startup never resumes a user's task automatically.

# Boundaries

Historical producers are immutable evidence, never helpers linked into current production code. Source-only CI validates provenance; the dedicated exact commit qualification owns execution and product continuation evidence.

# Evidence

- `redeven:internal/ai/tool_correction_history_compatibility_test.go` - Exact v7.69.1 failures through Retry/Send/Fork/restart.

- `redeven:internal/ai/testdata/upgrade/10ce4c152/manifest.json` - Tests.
