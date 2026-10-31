---
type: Architecture Boundary
title: ReDevPlugin host integration boundary
tags: [architecture, dependencies, plugins, release]
quality_exception: Cross-repository platform boundary spanning published artifacts, session teardown, package admission, surface lifecycle, runtime admission, and business adapters.
lifecycle: contract
reviewed_at: "2026-10-31"
---
# Summary

Redeven consumes the coordinated published ReDevPlugin Go, npm, Rust and machine-contract artifacts without forking platform mechanics. It owns session mapping, source policy/review, placement, product runtime builds and business adapters. Missing/unverifiable identity, lifecycle, interaction, package or runtime contracts fail closed without local compatibility or sibling-source fallback.

# Contract

- Upstream owns validation/hashes/trust, inspection and registry state, permission/confirmation, tokens/assets, sandbox/bridge, settings/intents, Executions/Events, storage/network/secret brokers, supervision/IPC/WASM, quotas/revocation, control storage, generated clients/errors/schemas and release metadata.
- Go/npm/runtime/machine artifacts form one coordinated release; frontend cannot downgrade independently. Current pins live in manifests and are checked by the dependency-contract test.
- Local bootstrap keeps its bounded credential admission before session readiness. [Package lifecycle](redevplugin-package-lifecycle.md) owns inspection/install/cache/readiness; [Redeven adapters](redevplugin-redeven-adapters.md) owns host modules and presentation.

## Product availability

Plugin subsystem readiness is never a prerequisite for Runtime readiness or
ordinary host sessions. A plugin market, package, runtime, storage or initialization
failure is diagnosed locally and leaves files, terminals, Notes, Workbench and
other non-plugin services available. An unavailable subsystem exposes the released
`PLUGIN_RUNTIME_UNAVAILABLE` failure without dispatching plugin effects; rejected
mutation requests report `not_committed`. Plugin Center localizes the failure
inside its own view rather than replacing the product shell. The launcher never
claims an unreadable inventory is empty, and automatic subsystem failure does not
interrupt unrelated work with a global toast. Initialization has a ten-second
budget; cancellation rejects late results and closes any acquired integration.
Caller-owned construction resources unwind on errors and recovered initialization
panics. This boundary does not mask cancellation of the host's own startup.

Host channel authentication and plugin execution admission are separate facts.
A failed or panicked plugin generation binding grants no plugin authority and cannot close
the host channel. Plugin request panics release their admission while the HTTP
server contains the request failure. Platform storage remains opaque: isolation
must not delete, rewrite or silently reauthorize incompatible plugin state.

## Ordinary Web surfaces

The released platform owns Web application admission, package-local ES module assets, sandbox bootstrap and the authenticated surface bridge. Redeven supplies an origin-allocation adapter and mounts the released Web surface handler. It does not translate DOM events or render a platform-specific VNode tree. Each surface receives an independent origin; parent credentials never become ambient authority inside that origin.

# Boundaries

Plugin UI uses only released sandbox bootstrap/bridge. Product adapters cannot write opaque state, mint tokens, fabricate trust or grant broker authority. Wrong, legacy, drifted, tampered or future roots fail unchanged.

Plugin data conversion and exact historical data binding remain released Host responsibilities. Redeven displays verified review evidence and calls the existing update APIs; it does not interpret converter code, copy generations, migrate the platform database, or retry uncertain writes.

# Evidence

- `redeven:go.mod:14` - Pins the released ReDevPlugin Go module.

- `redeven:internal/session/dependency_contract_test.go:1` - Matches downstream coordinates to the release manifest.
