---
type: Architecture Contract
title: Plugin package and runtime lifecycle
tags: [architecture, plugins, release, runtime]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

ReDevPlugin owns trust, inspection, install, readiness, caches and durable lifecycle. Redeven supplies authenticated sources/review/localized outcomes. Every source requires inspection, explicit consent and released Host admission; stale/unverified/uncertain facts fail closed.

# Contract

## Sources
Validated latest-only market supplies entries;platform verifies publisher/plugin/version/hash/signature/revocation/source policy/Host requirements before registry mutation. GitHub without admin tag resolves latest eligible Release each inspection;resolved evidence is not durable user pin.

## Retained data
Released3.9 owns target-filtered discovery/exact inspection/one-shot recovery/read-only reconciliation. Source is uninstalled compatible retained data,target explicitly disabled. Host checks owner,publisher/plugin,data shape,generation,management revision,active fingerprint;atomic reference swap retains both generations,never grants/secrets/enabled state. Pass SDK DTOs unchanged:Read discovery/inspection/status,Write commit,Admin disable. Unknown commit cannot replay;exact-plan reconciliation allows new explicit review only on confirmed pending,unknown stays read-only. Restart recovery upstream.

## Upgrade/downgrade
3.10 owns declared conversion,isolated generations,quotas/cancel and atomic package/data/history. Converter matches exact predecessor/version/shape. Failure/cancel preserves old bytes;committed/unknown uses update reconciliation,no replay. Downgrade restores exact historical package's last generation;control-store migration is opaque upstream.

Review consumes verified security declaration:one concise saved-data notice,expandable method/predecessor/limits and ordinary added/changed/removed differences. Omit empty release notes/generic instructions;inspection binding stays evidence and unchanged grants appear once. No extra wizard,dispatcher,job or data copy.

# Boundaries

Redeven does not parse plugin bytes, persist inspection receipts, implement a second install state machine, or start workers outside the released Host. Product review and runtime presentation remain separate from platform trust and durable lifecycle.

# Evidence

- `redeven:internal/redevpluginintegration/integration.go:240` - Source.
- `redeven:internal/redevpluginintegration/runtime_module.go:1` - Source.
- redeven:internal/redevpluginintegration/adapters_test.go:1
