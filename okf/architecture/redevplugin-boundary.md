---
type: Architecture Boundary
title: ReDevPlugin host integration boundary
description: Redeven consumes ReDevPlugin as a published platform and keeps only host policy, placement, source admission, localized presentation projection, and business adapters.
tags: [architecture, dependencies, plugins, release]
timestamp: 2026-10-08T00:00:00Z
quality_exception: Cross-repository platform boundary spanning published artifacts, session teardown, package admission, surface lifecycle, runtime admission, and business adapters.
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Redeven consumes the coordinated published ReDevPlugin Go, npm, Rust and machine-contract artifacts without forking platform mechanics. It owns session mapping, source policy/review, placement, product runtime builds and business adapters. Missing/unverifiable identity, lifecycle, interaction, package or runtime contracts fail closed without local compatibility or sibling-source fallback.

# Contract

- Upstream owns validation/hashes/trust, inspection and registry state, permission/confirmation, tokens/assets, sandbox/bridge, settings/intents, Executions/Events, storage/network/secret brokers, supervision/IPC/WASM, quotas/revocation, control storage, generated clients/errors/schemas and release metadata.
- Go/npm/runtime/machine artifacts form one coordinated release; frontend cannot downgrade independently. Current pins live in manifests and are checked by the dependency-contract test.
- Local bootstrap keeps its bounded credential admission before session readiness. [Package lifecycle](redevplugin-package-lifecycle.md) owns inspection/install/cache/readiness; [Redeven adapters](redevplugin-redeven-adapters.md) owns host modules and presentation.

# Boundaries

Plugin UI uses only released sandbox bootstrap/bridge. Product adapters cannot write opaque state, mint tokens, fabricate trust or grant broker authority. Wrong, legacy, drifted, tampered or future roots fail unchanged.

# Evidence

- `redeven:go.mod:14` - Pins the released ReDevPlugin Go module.

- `redeven:internal/envapp/ui_src/package.json:45` - Pins the released ReDevPlugin UI package.

- `redeven:internal/session/dependency_contract_test.go:1` - Matches downstream coordinates to the release manifest.
