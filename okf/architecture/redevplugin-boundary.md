---
type: Architecture Boundary
title: ReDevPlugin host integration boundary
description: Redeven consumes ReDevPlugin as a published platform and keeps only host policy, placement, source admission, localized presentation projection, and business adapters.
tags: [architecture, dependencies, plugins, release]
timestamp: 2026-10-08T00:00:00Z
quality_exception: Cross-repository platform boundary spanning published artifacts, session teardown, package admission, surface lifecycle, runtime admission, and business adapters.
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

ReDevPlugin is an independently released plugin platform. Redeven consumes its
coordinated `v3.0.36` Go, npm, Rust source-crate, and machine-contract artifacts;
it does not fork platform mechanics. Redeven owns authenticated session mapping,
product source policy and review UX, UI placement, product runtime builds, and
concrete business adapters. Missing or unverifiable upstream identity, lifecycle,
interaction, package, or runtime contracts fail closed; there is no Redeven
compatibility path or sibling-source fallback.

# Contract

## Platform ownership
ReDevPlugin owns package and manifest validation, canonical hashes, signature and trust assessment, process-local external-package inspection, registry and lifecycle state, permissions and confirmations, tokens and asset sessions, sandbox and bridge lifecycle, settings and intents, Executions and Events, storage/network/ secret brokers, runtime supervision, Rust IPC, WASM execution, quotas, revocation, the control database, generated clients, stable errors, schemas, contract hashes, and release metadata.

Local bootstrap readiness retains its short credential admission request before the session is ready.

## Published dependency set
The current integration consumes the coordinated ReDevPlugin `v3.0.36` set:

A front-end package cannot be independently downgraded while the Host and runtime remain on a newer platform release.

## Package and runtime lifecycle
Detailed source inspection, installation, runtime readiness, and cache ownership are maintained in [Plugin package and runtime lifecycle](redevplugin-package-lifecycle.md).

## Redeven adapter delta
Host-module construction, external-package adapters, and product surface mapping are maintained in [ReDevPlugin Redeven adapters](redevplugin-redeven-adapters.md).

# Boundaries

Plugin UI loads only through the released sandbox bootstrap and bridge.

It must not write opaque state, mint tokens, manufacture trust, or grant storage/network/runtime authority.

Wrong, legacy, drifted, tampered, and future roots remain fail-closed without mutation.

# Evidence

- `redeven:go.mod:14` - Pins the released ReDevPlugin Go module.

- `redeven:internal/envapp/ui_src/package.json:45` - Pins the released ReDevPlugin UI package.

- `redeven:internal/session/dependency_contract_test.go:1` - Matches downstream coordinates to the release manifest.
