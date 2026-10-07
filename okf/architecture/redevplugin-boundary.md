---
type: Architecture Boundary
title: ReDevPlugin host integration boundary
description: Redeven consumes ReDevPlugin as a published platform and keeps only host policy, placement, source admission, localized presentation projection, and business adapters.
tags: [architecture, dependencies, plugins, release]
timestamp: 2026-10-08T00:00:00Z
quality_exception: Cross-repository platform boundary spanning published artifacts, session teardown, package admission, surface lifecycle, runtime admission, and business adapters.
---
# Summary

ReDevPlugin is an independently released plugin platform. Redeven consumes its
coordinated `v3.0.33` Go, npm, Rust source-crate, and machine-contract artifacts;
it does not fork platform mechanics. Redeven owns authenticated session mapping,
product source policy and review UX, UI placement, product runtime builds, and
concrete business adapters. Missing or unverifiable upstream identity, lifecycle,
interaction, package, or runtime contracts fail closed; there is no Redeven
compatibility path or sibling-source fallback.

# Contract


## Platform ownership

ReDevPlugin owns package and manifest validation, canonical hashes, signature and
trust assessment, process-local external-package inspection, registry and lifecycle
state, permissions and confirmations, tokens and asset sessions, sandbox and
bridge lifecycle, settings and intents, Executions and Events, storage/network/
secret brokers, runtime supervision, Rust IPC, WASM execution, quotas,
revocation, the control database, generated clients, stable errors, schemas, contract hashes, and
release metadata.

Redeven maps an authenticated channel into ReDevPlugin session context, applies
local permission and source-policy caps, mounts the canonical handler, selects
state roots, routes audit and diagnostics, builds the product runtime from
released source crates, places SDK-owned surface elements, and registers product
capabilities. Docker/Podman, files, shells, cloud APIs, databases, and vaults are
Redeven business adapters only after ReDevPlugin has authorized the request.

The dependency direction is one way. Redeven must not implement a second
manifest or package parser, registry, lifecycle state machine, bridge, token
issuer, asset session, broker, Execution/Event protocol, runtime supervisor,
IPC implementation, WASM executor, package fetcher, signature state machine, or
external-package inspection or receipt store.

Env App's canonical `/_redevplugin/api/plugins` host request adapter uses the
[session event transport](env-event-transport.md), including SDK-managed event
observations. The signed Env App scope admits the CSRF proof, expected management
revision, and published package upload limit. Other application proxies gain no
plugin authority. The mounted platform checks the trusted origin, CSRF proof,
current session, and action permission. Local bootstrap readiness retains its
short credential admission request before the session is ready.

## Published dependency set

The current integration consumes the coordinated ReDevPlugin `v3.0.33` set:

This adoption includes upstream filesystem and content-path validation fixes and
patched Rust dependencies. Redeven verifies the public release manifest and
registry artifact digests before product staging; Runtime Service protocol and
compatibility epoch stay governed by the product compatibility contract.

- `github.com/floegence/redevplugin/v3 v3.0.33`;
- `@floegence/redevplugin-contracts@3.0.33` and
  `@floegence/redevplugin-ui@3.0.33`;
- `redevplugin-runtime@3.0.33` and `redevplugin-worker-sdk@3.0.33` as the exact
  public Rust source-crate boundary;
- the released contract registry, release-manifest contract, contract hashes, and
  attested `platform-release-manifest.json` registry readback, whose
  SHA-256 is
  `2c9b96d7a8219ea8241ec87a651bbe4f86a90e9e22fb22175ef4a43a0be5f069`.

Redeven release tooling verifies the exact-one publication manifest against its
tag, source commit, workflow, GitHub attestation, Go proxy and SumDB sums, npm
integrity and provenance, crates.io checksums and Cargo VCS identity, and closed
package coordinates. Forbidden wiring includes `go.work`, `go.work.sum`, Go
`replace`, package-manager links, sibling paths, Rust path overrides, copied
contracts, and copied runtime binaries. Dependency checks use `GOWORK=off`.
Redeven's dependency contract test reads the release manifest embedded in the
released Go module and requires the Go module, Env App manifest, npm and pnpm
lockfiles, and third-party notices to carry its exact npm coordinates. A
front-end package cannot be independently downgraded while the Host and runtime
remain on a newer platform release.

## Package and runtime lifecycle

Detailed source inspection, installation, runtime readiness, and cache ownership are maintained in [Plugin package and runtime lifecycle](redevplugin-package-lifecycle.md).

## Redeven adapter delta

Host-module construction, external-package adapters, and product surface mapping are maintained in [ReDevPlugin Redeven adapters](redevplugin-redeven-adapters.md).

# Boundaries

Plugin UI loads only through the released sandbox bootstrap and bridge. Plugin
backend code executes only through the released Rust runtime. Product routes,
navigation, Activity/Workbench layout, inventory keys, session semantics, and
concrete business access do not become manifest or platform schema fields.

Flower may orchestrate released scaffold, validate, package, inspect, confirm, install,
enable, and open APIs. It must not write opaque state, mint tokens, manufacture
trust, or grant storage/network/runtime authority.

ReDevPlugin owns the current-only `redevplugin_control_v3` control root. Redeven
provides the explicit root but never reads or migrates its database, imports
legacy plugin state, or implements copied-root recovery. Wrong, legacy, drifted,
tampered, and future roots remain fail-closed without mutation.

# Evidence

- `redeven:go.mod:14` - Pins the released ReDevPlugin Go module.
- `redeven:internal/envapp/ui_src/package.json:45` - Pins the released ReDevPlugin UI package.
- `redeven:internal/session/dependency_contract_test.go:1` - Matches downstream coordinates to the release manifest.
- `redeven:scripts/check_redevplugin_dependency_boundary.sh:1` - Rejects local wiring and copied platform mechanics.
- `redeven:scripts/check_redevplugin_release_artifacts.sh:1` - Verifies the coordinated public publication.
