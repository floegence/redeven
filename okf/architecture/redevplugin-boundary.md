---
type: Architecture Boundary
title: ReDevPlugin host integration boundary
description: Redeven consumes ReDevPlugin as a published platform and keeps only host policy, placement, source admission, and business adapters.
tags: [architecture, dependencies, plugins, release]
timestamp: 2026-07-24T00:00:00Z
---
# Summary

ReDevPlugin is an independently released plugin platform. Redeven consumes its
coordinated `v0.6.10` Go, npm, Rust source-crate, and machine-contract artifacts;
it does not fork platform mechanics. Redeven owns authenticated session mapping,
product source policy and review UX, UI placement, product runtime builds, and
concrete business adapters. Missing or unverifiable upstream identity, lifecycle,
interaction, package, or runtime contracts fail closed; there is no Redeven
compatibility path or sibling-source fallback.

# Contract

## Platform ownership

ReDevPlugin owns package and manifest validation, canonical hashes, signature and
trust assessment, staged external-package admission, registry and lifecycle
state, permissions and confirmations, tokens and asset sessions, sandbox and
bridge lifecycle, settings and intents, operations and streams, storage/network/
secret brokers, runtime supervision, Rust IPC, WASM execution, quotas,
revocation, generated clients, stable errors, schemas, contract hashes, and
release metadata.

Redeven maps an authenticated channel into ReDevPlugin session context, applies
local permission and source-policy caps, mounts the canonical handler, selects
state roots, routes audit and diagnostics, builds the product runtime from
released source crates, places SDK-owned surface elements, and registers product
capabilities. Docker/Podman, files, shells, cloud APIs, databases, and vaults are
Redeven business adapters only after ReDevPlugin has authorized the request.

The dependency direction is one way. Redeven must not implement a second
manifest or package parser, registry, lifecycle state machine, bridge, token
issuer, asset session, broker, operation/stream protocol, runtime supervisor,
IPC implementation, WASM executor, package fetcher, signature state machine, or
external-package receipt store.

## Published dependency set

The current integration consumes the coordinated ReDevPlugin `v0.6.10` set:

- `github.com/floegence/redevplugin v0.6.10`;
- `@floegence/redevplugin-contracts@0.6.10` and
  `@floegence/redevplugin-ui@0.6.10`;
- the exact six `0.6.10` Rust source crates ending in `redevplugin-runtime`;
- the released contract registry, package-set contract, contract hashes, and
  attested `platform-package-publication-v1.json` registry readback.

Redeven release tooling verifies the exact-one publication manifest against its
tag, source commit, workflow, GitHub attestation, Go proxy and SumDB sums, npm
integrity and provenance, crates.io checksums and Cargo VCS identity, and closed
package coordinates. Forbidden wiring includes `go.work`, `go.work.sum`, Go
`replace`, package-manager links, sibling paths, Rust path overrides, copied
contracts, and copied runtime binaries. Dependency checks use `GOWORK=off`.

## Host modules and external packages

Redeven constructs the released Host with explicit core, official-release,
runtime, connectivity, secrets, capability, and external-package modules.
ReDevPlugin-owned stores remain opaque below the selected owner-scoped
generation. Redeven supplies session, authorization, web-security, trust,
official release-source, observability, secret, external source, and business
adapters; it never edits registry, staged inspection, receipt, token, lease,
revoke-epoch, or plugin-data state directly.

The external-package module may retrieve a package from a validated public HTTPS
package URL or GitHub Release, or accept a bounded local `.redevplugin` upload.
ReDevPlugin owns `inspect -> commit -> query`, immutable staged bytes, source
provenance, signature assessment, execution approval, update eligibility,
security-summary hashing, confirmation binding, owner-scoped receipts, and
generated routes. Redeven owns whether these supported sources appear in the
product, the authenticated admin gate, keyring/revocation inputs, and the review
presentation.

Absent, unknown-signer, and temporarily unavailable signatures may cross commit
only after explicit user confirmation. They never imply trust, permission, or
automatic-update authority: the committed plugin is disabled, has zero grants,
and is manual-update-only. Invalid or revoked signatures block commit and
execution. Signature evidence determines trust and automatic-update eligibility,
not basic installation eligibility. The existing official signed-release module
remains a stricter release-ref path; this feature does not add or weaken an
official signing, ledger, or authorization process.

## Surfaces and interaction ownership

The product Shell owns one released `PluginPlatformClient`, authenticated
transport, and shared surface scope. Activity places each fresh SDK slot in a
Shell-root floating window. Workbench persists the target in a standard projected
`redeven.plugin` widget and wraps the SDK element with Redeven wheel, selection,
action, activation, focus, and floating-layer policy.

Interaction observations arrive only through ReDevPlugin's source/port-bound
surface channel and remain tied to the current frame generation and opaque
surface. Redeven uses them for host placement behavior, never as identity,
authorization, or permission evidence. A placement move is globally serialized:
the old slot must close before a fresh lease, iframe, or new persisted placement
is opened. Lost close responses reconcile through the released idempotent
exact-surface contract and must not widen into session-scope revocation or affect
sibling surfaces. Management mutations are different: the released Host revokes
affected authority, then the SDK tears down the shared scope for committed or
unknown outcomes. Redeven must not issue a second close against those disposed
slots or treat local disposal as the server-side revoke.

## Runtime and official capability

On Linux, the runtime is exactly the `redevplugin-runtime` sibling of the
canonical Redeven executable. Redeven builds it with Rust 1.88.0 from the
attested package set as a static PIE, then emits SBOM, provenance, notices, and
signature evidence. The released ProcessManager owns launch, health, heartbeat,
shutdown, leases, hostcalls, and restart. Darwin packages omit the runtime and
worker execution. No target searches `PATH` or alternate runtime names.

Official Containers remains a signed release-ref package over the
`redeven.capability.container_resources` adapter. Its release and capability
artifacts remain verified as one closed source. The official signing flow is
retained, not generalized into a requirement for externally supplied packages.

# Boundaries

Plugin UI loads only through the released sandbox bootstrap and bridge. Plugin
backend code executes only through the released Rust runtime. Product routes,
navigation, Activity/Workbench layout, inventory keys, session semantics, and
concrete business access do not become manifest or platform schema fields.

Flower may orchestrate released scaffold, validate, package, inspect, commit,
enable, and open APIs. It must not write opaque state, mint tokens, manufacture
trust, or grant storage/network/runtime authority.

Before opening ReDevPlugin state, Redeven uses only the committed owner-scope
generation returned by the released migration. Recognized legacy state with
unprovable ownership is retained in quarantine while a fresh generation is
committed. Unknown, corrupt, ambiguous, tampered, or future state blocks startup
without mutation. Floret-owned state is outside this lifecycle.

# Evidence

- `redeven:go.mod:11` - Pins the released ReDevPlugin Go module.
- `redeven:internal/envapp/ui_src/package.json:29` - Pins the released UI package.
- `redeven:internal/redevpluginintegration/integration.go:240` - Constructs released Host modules, including external package admission.
- `redeven:internal/redevpluginintegration/trust_adapter.go:1` - Delegates package signature and freshness assessment to the released verifier.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginPlatform.ts:1` - Owns the released client, transport, shared scope, and slot placement adapter.
- `redeven:internal/envapp/ui_src/src/ui/workbench/redevenWorkbenchWidgets.tsx:300` - Registers the standard projected plugin widget.
- `redeven:internal/workbenchlayout/types.go:21` - Declares the persisted `redeven.plugin` widget type.
- `redeven:scripts/check_redevplugin_dependency_boundary.sh:1` - Rejects local wiring and platform duplication.
- `redeven:scripts/check_redevplugin_release_artifacts.sh:1` - Verifies the coordinated public package publication.
