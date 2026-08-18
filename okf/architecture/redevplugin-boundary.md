---
type: Architecture Boundary
title: ReDevPlugin host integration boundary
description: Redeven consumes ReDevPlugin as a published platform and keeps only host policy, placement, source admission, localized presentation projection, and business adapters.
tags: [architecture, dependencies, plugins, release]
timestamp: 2026-07-25T00:00:00Z
quality_exception: Cross-repository platform boundary spanning published artifacts, session teardown, package admission, surface lifecycle, runtime admission, and business adapters.
---
# Summary

ReDevPlugin is an independently released plugin platform. Redeven consumes its
coordinated `v3.0.2` Go, npm, Rust source-crate, and machine-contract artifacts;
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

## Published dependency set

The current integration consumes the coordinated ReDevPlugin `v3.0.2` set:

- `github.com/floegence/redevplugin/v3 v3.0.2`;
- `@floegence/redevplugin-contracts@3.0.2` and
  `@floegence/redevplugin-ui@3.0.2`;
- `redevplugin-runtime@3.0.2` and `redevplugin-worker-sdk@3.0.2` as the exact
  public Rust source-crate boundary;
- the released contract registry, release-manifest contract, contract hashes, and
  attested `platform-release-manifest.json` registry readback, whose
  SHA-256 is
  `a1d8e28c2262f480b74b8ad8fee8e623b84c40f8ca7417994a1eab7f381d8ad7`.

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

ReDevPlugin owns durable installation through its single control database.
Official release installation is one public Execution with ordered Events,
one cancellation identity, and one cursor. The platform
activates a verified official release when its permissions are already
approved, or returns an installed `needs_attention` record without silently
granting missing permissions. The Execution survives browser, Shell, transport,
and Host observation loss; its fetch, download, hash, signature, commit,
enable, retry, cache, failure, mutation, and byte-progress evidence remains
platform state. Redeven may reconnect and refresh inventory, but must not create
a local execution store, copy the state machine, invent progress, or cancel work
when a panel closes.

The `v3.0.2` release-package inspection is also the presentation authority for
pre-install access review. Each permission carries its exact permission id,
verified method set, explicit required status, and the stable
`read|write|delete|execute|admin` effects derived from Host-verified capability
contracts. Redeven may localize and arrange those facts, but it must not recover
permission meaning from the market catalog, infer required status, or replace
different permissions with one generic fallback.

Enabled-plugin startup recovery remains ReDevPlugin work. The `v3.0.2` Host
revalidates the installed package identity, SHA-256 hashes, Ed25519 status,
revocation, grants, policy fences, runtime admission, and session scope before it
publishes a runnable result. Invalid or revoked evidence, schema drift, tampering,
and stale fences fail closed. Redeven consumes the Host `RecoverySnapshot` and
`recoverEnabled` result and must not inspect opaque control state, duplicate trust
decisions, or treat local presentation state as fallback authorization.

Environment-scoped runtime invocations retain `owner_user_hash` in the signed
short-lived lease audience while deriving the narrower resource scope without a
user hash. The Host validates those two bindings independently before IPC, so a
valid authenticated session can use environment resources without weakening the
environment-only ownership of filesystem and network handles.

The platform bounds each enabled-plugin recovery attempt to 15 seconds and
reports deadline exhaustion as `recovery_timeout`, distinct from lifecycle
`recovery_canceled`. Recovery remains source/channel single-flight. When an old
session owns the flight and its context ends, a healthy new-session follower may
take ownership and perform one new authoritative recovery; it does not inherit
the ended leader context. Shared trust, revocation, fence, tamper, epoch, and
transport failures remain authoritative and fail closed. A canceled leader
cannot publish a lease.

For the current-only v3 baseline, Host admission accepts only manifest v9 with
`plugin_api=1`, `internal_wire=1`, the current plugin UI contract, and the
current bridge contract. Manifest presentation is signed author content:
the Host validates and returns the normalized catalog, and resolves a requested
BCP 47 locale through the released resolver with RFC 4647 lookup and the
declared default locale. Older manifest or release metadata state is rejected
read-only without a compatibility parser, synthetic copy, or English fallback.

## Host modules and external packages

Redeven constructs the released Host with explicit core, official-release,
runtime, connectivity, secrets, capability, and external-package modules.
ReDevPlugin-owned stores remain opaque below the selected control root. Redeven
supplies session, authorization, web-security, trust,
official release-source, observability, secret, external source, and business
adapters; it never edits registry, inspection, token, lease,
revoke-epoch, or plugin-data state directly.

Redeven supplies the exact already-held Local Environment runtime lock and its
runtime instance id to the released session-maintenance adapter. ReDevPlugin owns
the durable phase, teardown identity, continuation, terminal claim, migration,
and reconciliation contract. Redeven owns only authenticated channel generation,
Local UI access-session binding, transport admission leases, and shutdown
ordering around that adapter. Logout and expiry may select exact product
connections and generations, but they cannot invent a lifecycle phase, delete a
durable fence, or widen one access session into another owner scope.

The external-package module may retrieve a package from a validated public HTTPS
package URL or GitHub Release, or accept a bounded local `.redevplugin` upload.
ReDevPlugin owns `inspect -> explicit confirmation -> install`, a process-local
opaque inspection id with bounded TTL, source provenance, signature assessment,
execution approval, update eligibility, security-summary hashing, exact
owner/session binding, exact byte/hash revalidation, and the atomic Host install
transaction. Inspection is not durable PluginRecord or control-database state,
and the flow creates no durable receipt/query lifecycle. Redeven owns whether
these supported sources appear in the
product, the authenticated admin gate, keyring/revocation inputs, and the review
presentation.

Absent and unknown-signer signatures may cross installation
only after explicit user confirmation. They never imply trust, permission, or
automatic-update authority: the committed plugin is disabled, has zero grants,
and is manual-update-only. Invalid or revoked signatures block install and
execution. Signature evidence determines trust and automatic-update eligibility,
not basic installation eligibility. The existing official signed-release module
remains a stricter release-ref path; this feature does not add or weaken an
official signing or authorization process.

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

Plugin Center cards, details, launchers, and placement commands consume the
Host-projected `action_state` as their only lifecycle action authority. Redeven
does not recompute `can_open` from trust, grants, policy, or recovery flags. A
recovery presentation may explain or retry the Host snapshot, but it is not a
second open gate and owns no catch-up identity state machine.

## Runtime and official capability

On Linux, the runtime is exactly the `redevplugin-runtime` sibling of the
canonical Redeven executable. Redeven builds it with Rust 1.88.0 from the
attested release manifest as a static PIE, then emits SBOM, provenance, notices, and
signature evidence. The released ProcessManager owns launch, health, heartbeat,
shutdown, leases, hostcalls, and restart. Darwin packages omit the runtime and
worker execution. No target searches `PATH` or alternate runtime names.
The expected runtime digest comes from the product release marker; startup must
not hash the field binary and accept that value as its own trust anchor.

Official Containers `4.4.4` is a signed manifest-v9 release-ref package over the
`redeven.capability.container_resources@3.0.0` adapter. The latest-only market
selects its immutable GitHub Release and complete transport, while ReDevPlugin
verifies release and capability artifacts as one closed source. The market is
not a trust source and the official signing flow is not generalized into a
requirement for externally supplied packages.

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

- `redeven:go.mod:11` - Pins the released ReDevPlugin Go module.
- `redeven:internal/envapp/ui_src/package.json:29` - Pins the released UI package.
- `redeven:internal/redevpluginintegration/integration.go:240` - Constructs released Host modules, including external package admission.
- `redeven:internal/redevpluginintegration/session_lifecycle.go:1` - Carries transient connection generation while Host owns durable teardown state.
- `redeven:internal/agent/plugin_session_registry.go:1` - Owns process-local authenticated generation admission and exact access-session retirement.
- `redeven:internal/localui/localui.go:1` - Binds Local UI access sessions, pending artifacts, credentials, and direct transports without persisting raw credentials.
- `redeven:internal/redevpluginintegration/trust_adapter.go:1` - Delegates package signature and freshness assessment to the released verifier.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginPlatform.ts:1` - Owns the released client, transport, shared scope, and slot placement adapter.
- `redeven:internal/envapp/ui_src/src/ui/workbench/redevenWorkbenchWidgets.tsx:300` - Registers the standard projected plugin widget.
- `redeven:internal/workbenchlayout/types.go:21` - Declares the persisted `redeven.plugin` widget type.
- `redeven:scripts/check_redevplugin_dependency_boundary.sh:1` - Rejects local wiring and platform duplication.
- `redeven:scripts/check_redevplugin_release_artifacts.sh:1` - Verifies the coordinated public package publication.
- `redeven:internal/session/dependency_contract_test.go:1` - Matches downstream Go and npm coordinates to the release manifest embedded in the released Go module.
