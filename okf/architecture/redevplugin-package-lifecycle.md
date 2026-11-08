---
type: Architecture Contract
title: Plugin package and runtime lifecycle
tags: [architecture, plugins, release, runtime]
lifecycle: contract
reviewed_at: "2026-11-05"
---
# Summary

ReDevPlugin owns package inspection, installation, source identity, durable receipts, runtime readiness and retained data. The Host validates ordinary package structure, hashes, manifest, capability contracts and source policy. Plugin signatures, publisher trust, signed release references, and official-only admission do not participate.

# Contract

## Inspection and installation

GitHub repositories may expose several plugins through `.redevplugin/index.json`; the user selects a plugin before inspection. A package URL or upload uses the same inspection contract.

Review binds exact inspected bytes, intended instance/revision, owner and session. Submission uses one request ID and the released durable `StartInspectedInstall` API. A lost response queries that same request; it never invents a replacement operation. The Shell restores owner-scoped receipts, including first-install failures with no inventory row. Closing Plugin Center does not stop observation; changing the authenticated owner cancels and clears it.

Execution status and mutation outcome are distinct. A committed outcome requires inventory reconciliation even if final execution reports failure. Unknown outcomes stay read-only. A definite failure requires a fresh review; the UI never silently erases retained data, grants access, or retries uncertain effects. Installation enables the plugin while missing grants remain separate action-level authorization boundaries.

## Updates

Manual checks inspect the installed original source. GitHub provenance uses immutable repository identity, not a mutable owner/name or a market replacement. Source changes require explicit consent. Older versions use the separate downgrade lifecycle; same-version changed bytes are rejected. A market disappearance does not change installed authority.

Automatic updates are an explicit per-installation preference, off by default. While an authorized session is active, Redeven checks enabled installations after a bounded delay and at bounded intervals. It uses the same original-source inspection and durable installation path, only when the Host reports automatic eligibility: a higher version, same source and unchanged security declarations. New capabilities require manual review. Uploaded packages have no automatic remote source. No synthetic session, unattended host scheduler, or new product persistence entity is introduced.

Before automatic submission, owner-scoped durable receipts are reconciled. Pending or unknown operations prevent replay; a previous failed attempt at the same candidate requires review. Surface shutdown and inventory reconciliation use the existing placement coordinator. Neither automatic nor manual update grants permissions or overrides user-disabled state.

## Retained data and downgrade

The released Host owns target-filtered retained-data discovery, exact inspection, one-shot recovery and read-only reconciliation. Recovery binds owner, publisher/plugin, data shape, generation, management revision and active fingerprint. Atomic generation swaps preserve prior data and do not restore grants, secrets or enabled state. Discovery/inspection/status require Read; commit requires Write; disable requires Admin.

Declared data conversion runs in isolated bounded generations. Failure/cancellation preserves old bytes; committed/unknown outcomes reconcile without replay. Downgrade restores the exact historical package's retained generation. Redeven never copies opaque data, interprets converter code, or implements platform-store migrations.

Review shows concise saved-data impact and expandable verified differences. Permission grants remain independent explicit choices. No duplicate install wizard, dispatcher, package parser, or destructive retry path exists.

# Boundaries

ReDevPlugin owns durable lifecycle and execution; Redeven owns presentation and authenticated product scheduling. Platform publication signatures, product runtime signing, runtime lease signatures, sandboxing, WASM containment, permission checks and revocation remain in force.

# Evidence

- `redeven:internal/redevpluginintegration/integration.go` - Host construction.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginApi.ts` - Exact inspection and durable request recovery.
