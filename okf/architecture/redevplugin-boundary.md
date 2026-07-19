---
type: Architecture Boundary
title: ReDevPlugin host integration boundary
description: Redeven consumes ReDevPlugin as a published platform and keeps only host policy, placement, and business adapters.
tags: [architecture, dependencies, plugins, release]
timestamp: 2026-07-19T00:00:00Z
---
# Summary

ReDevPlugin is an independently released plugin platform. Redeven consumes its
Go library, npm UI package, signed Rust runtime, and machine contracts; it does
not fork or rebuild platform mechanics. Redeven owns authenticated session
mapping, product policy, UI placement, release-artifact selection, and concrete
business adapters. A missing reusable contract blocks downstream integration
until it is released upstream; no Redeven compatibility path may fill the gap.

# Contract

## Platform ownership

ReDevPlugin owns package and manifest validation, signing and trust, registry
and lifecycle state, permissions and confirmations, tokens and asset sessions,
sandbox bootstrap and bridge lifecycle, settings and intents, operations and
streams, storage/network/secret brokers, runtime supervision, Rust IPC, WASM
execution, quotas, revocation, generated clients, stable errors, schemas,
fixtures, contract hashes, and release metadata.

Redeven owns the host integration around those contracts: mapping an
authenticated Redeven channel into ReDevPlugin session context, applying local
permission caps, mounting the canonical handler, choosing state roots, routing
audit and diagnostics, selecting a formally released runtime, placing SDK-owned
surface elements, and registering product capabilities. Docker/Podman, files,
shells, cloud APIs, databases, and vaults remain Redeven business adapters even
when plugins invoke them.

The dependency direction is one way. Redeven imports released ReDevPlugin
artifacts; ReDevPlugin never imports Redeven. Redeven must not implement a
second manifest parser, package builder, registry, lifecycle state machine,
bridge, token issuer, asset session, broker, operation/stream protocol, runtime
supervisor, IPC implementation, or WASM executor.

## Published dependency set

The current integration consumes the coordinated ReDevPlugin `v0.5.1` release:

- `github.com/floegence/redevplugin v0.5.1`;
- `@floegence/redevplugin-ui@0.5.1`;
- signed `redevplugin-runtime` artifacts for Darwin/Linux and amd64/arm64;
- release-manifest v4, compatibility-manifest v6, the closed 28-contract
  registry, Worker SDK, npm integrity, A2 evidence, stress evidence, checksums,
  signatures, bundles, and third-party notices.

Redeven release tooling accepts only the fixed formal GitHub release from
`floegence/redevplugin`. It verifies the exact 27-asset set and keyless signing
identity before staging any payload. It does not accept a local source
directory, repository override, version override, sibling checkout, or
unsigned payload.

Forbidden dependency wiring includes `go.work`, `go.work.sum`, Go `replace`,
`file:`, `link:`, `workspace:`, `portal:`, relative or absolute sibling paths,
Rust path overrides, copied generated contracts, and copied runtime binaries.
Go dependency checks run with `GOWORK=off`.

## Host modules

Redeven constructs the released Host with explicit core, release, runtime,
connectivity, secrets, and capability modules. ReDevPlugin-owned SQLite stores
remain opaque under the configured state root. Redeven supplies session,
authorization, web-security, trust, release-source, observability, secret, and
business adapters; it does not edit registry rows, token state, leases, revoke
epochs, or plugin data directly.

The official runtime path is exactly the `redevplugin-runtime` sibling of the
Redeven executable. The released ProcessManager owns launch, health,
heartbeats, shutdown, leases, hostcalls, and restart semantics. Redeven pins the
four formal runtime hashes and does not search `PATH`, candidate directories,
or alternate filenames.

Official Containers is a signed ReDevPlugin package over the
`redeven.capability.container_resources` adapter. The package, release metadata,
revocation metadata, capability contract, and keys are verified as a single
official source. `internal/capabilities/containers` contains domain behavior;
the ReDevPlugin integration contains only the registered capability projection
and operation/stream delegation.

## Missing-contract rule

Opaque iframe input does not cross into the parent Workbench document.
ReDevPlugin `v0.5.1` exposes no host-neutral interaction ownership callback for
activation or host-owned wheel routing. Redeven therefore must not claim
Workbench plugin placement, add an overlay, toggle iframe pointer events, or
copy a second bridge. Workbench placement remains rejected until ReDevPlugin
releases a source/port-bound interaction contract. Activity placement remains
valid because it does not require Workbench canvas ownership.

# Boundaries

Plugin UI must load through the released SDK's sandbox bootstrap and bridge.
Plugin backend code must run through the released Rust runtime. Product routes,
navigation, Activity/Workbench layout, session semantics, and concrete resource
access must not leak into manifests or platform schemas.

Flower may orchestrate scaffold, validate, package, install, enable, and open
operations through released APIs. It must not write platform state, mint
tokens, bypass signatures, or grant storage/network/runtime authority itself.

Uncertain artifact provenance, owner scope, release identity, contract version,
runtime target, or capability pin fails closed. Redeven does not guess an owner,
invent network provenance, downgrade a contract, or retry a mutation whose
outcome is unknown.

# Evidence

- `redeven:go.mod:11` - Pins the released ReDevPlugin Go module.
- `redeven:internal/envapp/ui_src/package.json:29` - Pins the released UI package.
- `redeven:internal/redevpluginintegration/integration.go:1` - Constructs the released Host modules and stores.
- `redeven:internal/redevpluginintegration/runtime_module.go:1` - Binds the released ProcessManager, exact runtime path, target, and hashes.
- `redeven:internal/redevpluginintegration/release_module.go:1` - Implements the official signed release-source adapters.
- `redeven:internal/redevpluginintegration/containers_capability.go:1` - Registers the Redeven-owned Containers business adapter.
- `redeven:scripts/check_redevplugin_dependency_boundary.sh:1` - Rejects local wiring and platform duplication.
- `redeven:scripts/check_redevplugin_release_artifacts.sh:1` - Verifies the exact formal release set and signing evidence.
- `redeven:scripts/stage_redevplugin_release_artifacts.sh:1` - Stages only fixed formal release payloads.
