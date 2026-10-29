---
type: Compatibility Contract
title: Flower historical writer acceptance
tags: [ai, compatibility, fixtures, release]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

- Authority: locked Redeven writers with released Floret dependencies produce fixture bytes; current tests only copy them.
- Outcome: supported historical data upgrades, remains inspectable and can continue a new conversation.
- Invariants: immutable originals, exact source/module identities, digest verification, product write paths and complete final-main acceptance.
- Failure boundary: fixture drift or a failed upgrade blocks integration; a successful database open alone is insufficient evidence.

# Contract

The compatibility baseline is Redeven `10ce4c15212c7f4b6d2a449507b9e47d6bc31d1a` with published Floret `v7.5.0`.

The manifest binds the archive, every stored file and producer by SHA-256 and records source commit, Floret version, Go toolchain, scenario names and canonical IDs needed by assertions.

Qualification uses fake providers and copied synthetic data; production startup never resumes a user's task automatically.

# Boundaries

Historical producers are immutable evidence, never helpers linked into current production code. Source-only CI validates provenance; the dedicated exact commit qualification owns execution and product continuation evidence.

# Evidence

- `redeven:internal/ai/tool_correction_history_compatibility_test.go` - Exact v7.69.1 failures through product classification, explicit Retry, Send, Fork and restart.

- `redeven:internal/ai/testdata/upgrade/10ce4c152/manifest.json` - Locked compatibility baseline.
