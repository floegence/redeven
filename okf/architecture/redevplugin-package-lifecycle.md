---
type: Architecture Contract
title: Plugin package and runtime lifecycle
tags: [architecture, plugins, release, runtime]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

ReDevPlugin owns package trust, inspection, installation, runtime readiness, release cache, and durable lifecycle. Redeven supplies authenticated source policy, review presentation, and localized outcomes. Every source follows inspect, explicit confirmation, and released Host installation; unverified bytes, stale trust, missing runtime identity, or uncertain mutation outcomes fail closed.

# Contract

## Package sources and lifecycle
Production obtains catalog entries from the validated latest-only market snapshot. Publisher, plugin, version, hashes, signatures, revocation evidence, source policy, and Host requirements must match before ReDevPlugin changes the registry.

A GitHub source without an administrator-entered tag resolves the latest eligible Release on each new inspection; the previously resolved release tag is evidence, not a new durable user pin.

## Retained plugin data

ReDevPlugin 3.9 owns target-filtered discovery, exact inspection, one-shot recovery commit and read-only reconciliation. The source is an uninstalled instance with compatible retained data; the target must be explicitly disabled. The Host verifies owner, publisher, plugin identity, data shape, generation, management revision and active fingerprint. Its atomic transaction swaps data references while retaining both generations. It does not restore grants, secrets or enabled state.

Redeven passes published SDK DTOs unchanged. Discovery, inspection and status require environment read permission; commit requires write permission; disabling remains an admin action. An uncertain commit is never replayed. Reconciliation uses the exact inspected plan; a confirmed pending result permits a new explicit review, while unknown status remains read-only. Host restart recovery remains upstream-owned.

## Plugin data upgrades

ReDevPlugin 3.10 owns package-declared conversion, isolated input/output generations, quotas, cancellation, and the atomic package/data/history transaction. A converter matches an exact predecessor version and data shape. Failed or cancelled conversion keeps the old package and data; committed or unknown outcomes use the existing update reconciliation path and never trigger automatic replay. Downgrade restores the exact historical package's last data generation. The platform migrates its control store before opening it; Redeven never reads or writes that schema.

Redeven consumes the verified data-upgrade declaration from the released security summary. Review presents one concise saved-data notice before approval; method, predecessor identities and resource limits remain in expandable package details. Added, changed and removed declarations use the existing security-difference projection. Review omits empty release-note placeholders and generic instructions; inspection-binding facts stay inside expandable evidence, and unchanged permission grants appear only once. No second migration wizard, converter dispatcher, durable job or product-owned data copy is introduced.

# Boundaries

Redeven does not parse plugin bytes, persist inspection receipts, implement a second install state machine, or start workers outside the released Host. Product review and runtime presentation remain separate from platform trust and durable lifecycle.

# Evidence

- `redeven:internal/redevpluginintegration/integration.go:240` - Constructs released Host modules and product adapters.

- `redeven:internal/redevpluginintegration/runtime_module.go:1` - Published runtime admission and fixed manager.

- redeven:internal/redevpluginintegration/adapters_test.go:1 - Verifies independent read, write and admin recovery permissions.
