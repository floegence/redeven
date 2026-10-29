---
type: Architecture Contract
title: Plugin package and runtime lifecycle
tags: [architecture, plugins, release, runtime]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

ReDevPlugin owns package trust, inspection, installation, runtime readiness, release cache, and durable lifecycle. Redeven supplies authenticated source policy, review presentation, and localized outcomes. Every source follows inspect, explicit confirmation, and released Host installation; unverified bytes, stale trust, missing runtime identity, or uncertain mutation outcomes fail closed.

# Contract

## Package sources and lifecycle
Production obtains catalog entries from the validated latest-only market snapshot. Publisher, plugin, version, hashes, signatures, revocation evidence, source policy, and Host requirements must match before ReDevPlugin changes the registry.

A GitHub source without an administrator-entered tag resolves the latest eligible Release on each new inspection; the previously resolved release tag is evidence, not a new durable user pin.

# Boundaries

Redeven does not parse plugin bytes, persist inspection receipts, implement a second install state machine, or start workers outside the released Host. Product review and runtime presentation remain separate from platform trust and durable lifecycle.

# Evidence

- `redeven:internal/redevpluginintegration/integration.go:240` - Constructs released Host modules and product adapters.

- `redeven:internal/redevpluginintegration/runtime_module.go:1` - Admits the released runtime and its fixed process manager contract.
