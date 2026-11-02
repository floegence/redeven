---
type: Architecture Boundary
title: ReDevPlugin host integration boundary
tags: [architecture, dependencies, plugins, release]
quality_exception: Cross-repository platform boundary spanning published artifacts, session teardown, package admission, surface lifecycle, runtime admission, and business adapters.
lifecycle: contract
reviewed_at: "2026-11-02"
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

## Host network policy

ReDevPlugin 3.12.0 separates host-selected routing from package verification and
plugin network authority. Redeven supplies single-hop transports for market,
package and release-document downloads. They follow explicit environment proxy
settings, current macOS system proxy/PAC configuration, and OS DNS/VPN routing.
VPN synthetic addresses, enterprise DNS and private package sources are not
rejected merely for belonging to a non-public address range. The platform still
validates each URL and redirect, exact allowed release origins, byte limits,
cancellation, hashes and signatures. Downloads do not grant plugin execution.

For granted HTTPS hostname connectors without explicit private-prefix binding,
Redeven registers the released transport factory. The platform checks target,
method, grant and revision before dispatch, and owns pool identity, quota and
revocation. Explicit private-prefix connections, literal addresses and other
protocols retain their released address-bound contract. Network configuration
resolution happens only during requests, never during Runtime construction.
Failures remain inside the plugin boundary.

## Retained package history

ReDevPlugin 3.11.2 owns the bounded read-only projection of signed pre-Web v9
installation records and version history. Normal migration retains their exact
canonical manifests, hashes, signature facts and data generations. Their current
Host action state is incompatible; they are manageable but cannot execute or be
enabled. A user may explicitly update the same installation to a current Web
package without deleting its history. No VNode renderer or fabricated Web
declaration exists. Redeven consumes released inventory and action state without
parsing or rewriting platform-owned records. Unknown or corrupt state remains
unchanged and unavailable only within the plugin boundary.

## Ordinary Web surfaces

The released platform owns Web application admission, package-local ES module assets, sandbox bootstrap and the authenticated surface bridge. Redeven supplies an origin-allocation adapter and mounts the released Web surface handler. It does not translate DOM events or render a platform-specific VNode tree. Each surface receives an independent origin; parent credentials never become ambient authority inside that origin.

## Platform execution boundaries

ReDevPlugin 3.13.0 owns manifest-derived action bindings and direct Surface
resources. Declared private KV, SQLite, files and settings need no forwarding
Worker. Binary transfers and controlled WebSockets use the released dedicated-origin
handler after the exact Surface handshake; Host checks session ceilings, resource
scope, grants, quotas and revocation. Redeven mounts that handler and presents
verified resource declarations without adding endpoints or interpreting manifests.
The SDK reports explicit conflicts and unknown writes; the product never retries
an uncertain mutation. Snapshot watches coalesce changes and are not a durable log.

The upstream private files namespace automatically upgrades its released schema
1 to chunked schema 2. This is distinct from the control database and author
schema versions. Redeven keeps the layout opaque, including retained snapshots
and crash recovery, and never copies migration SQL or rewrites plugin state.

ReDevPlugin 3.12.2 keeps ordinary Web packaging and application SDK calls unchanged.
The trusted parent SDK binds execution queries, event reads and cancellation to
its current surface gateway and plugin. Redeven forwards that scope unchanged
through its authenticated transport and mounts the released HTTP handler; malformed
or stale surface authority cannot fall back to broader host management access.
Direct requests from plugin origins remain denied by the product route boundary.

The released Host also enforces session read/write ceilings and read-only method
effects before process operations. Its SQLite broker authorizes compiled SQL,
blocks host database-path metadata and bounds values, statement complexity and
concurrent operations. Redeven retains session mapping and concrete process
adapters without duplicating these platform checks. Existing signed manifests
and durable plugin data remain unchanged; plugin authors need no new flags.

# Boundaries

Plugin UI uses only released sandbox bootstrap/bridge. Product adapters cannot write opaque state, mint tokens, fabricate trust or grant broker authority. Wrong, legacy, drifted, tampered or future roots fail unchanged.

Plugin data conversion and exact historical data binding remain released Host responsibilities. Redeven displays verified review evidence and calls the existing update APIs; it does not interpret converter code, copy generations, migrate the platform database, or retry uncertain writes.

Durable interval scheduling, claim fencing, restart recovery and unknown-outcome handling remain ReDevPlugin responsibilities. Redeven registers an environment/app permission-cap adapter and renders the released summary and inventory status. It does not retain a user session for background authority, implement timers, or access platform scheduling tables.

# Evidence

- `redeven:go.mod:14` - Pins the released ReDevPlugin Go module.

- `redeven:internal/session/dependency_contract_test.go:1` - Matches downstream coordinates to the release manifest.
