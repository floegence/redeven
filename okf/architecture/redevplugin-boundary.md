---
type: Architecture Boundary
title: ReDevPlugin host integration boundary
description: Redeven consumes ReDevPlugin as a published plugin-platform dependency and keeps host-specific policy in Redeven adapters.
tags: [architecture, dependencies, plugins, release]
timestamp: 2026-06-29T00:00:00Z
---

Redeven treats ReDevPlugin as a published upstream plugin-platform dependency,
not as code to fork or reimplement inside the Redeven tree.

# Mechanism

ReDevPlugin owns reusable plugin-platform concerns: package and manifest
validation, lifecycle APIs, permission and confirmation machinery, sandboxed
iframe bridge contracts, Rust runtime supervision, WASM execution, storage and
network brokers, CLI validators, templates, schemas, fixtures, and contract
hashes. Redeven consumes those artifacts through released Go module versions,
npm packages, signed `redevplugin-runtime` binaries, and machine-readable
contract hashes.

Redeven's integration layer owns only host-product responsibilities: mapping
Redeven sessions, local permission caps, CSRF and origin checks, state
directories, audit and diagnostics sinks, secret adapters, Env App surfaces,
Workbench and Settings entrypoints, Desktop and installer bundling, Flower/Floret
tool wiring, product-level plugin generation UX, and Redeven business capability
adapters.

The dependency direction is one-way: Redeven imports released ReDevPlugin
artifacts, and ReDevPlugin never imports Redeven. Redeven-specific sessions,
Env App placement, Flower orchestration, Workbench chrome, Desktop packaging,
installer behavior, local policy, and concrete business resources belong in
Redeven adapters over released ReDevPlugin contracts. If a reusable contract is
missing, it must be implemented and released in ReDevPlugin before Redeven
depends on it.

Redeven may choose the state root, backup/export destination, audit sink,
diagnostics sink, and secret-vault adapter, but the ReDevPlugin registry,
package staging state, token/ticket records, storage namespaces, runtime leases,
and revoke epochs remain opaque platform state. Redeven may supervise the
released `redevplugin-runtime` binary and present diagnostics, but it must not
fork the Rust IPC protocol, inject custom hostcalls, run plugin WASM modules in a
Redeven-owned execution path, or bypass runtime lease, quota, and revocation
checks.

If Redeven integration uncovers a plugin-platform contract bug, the durable fix
belongs in ReDevPlugin first and Redeven must consume the released artifact that
contains it. Redeven integration code must not mint plugin gateway tokens,
bypass asset tickets, grant plugin storage or network access outside ReDevPlugin
brokers, load plugin UI outside sandboxed ReDevPlugin surfaces, execute native
plugin backends, or call Redeven business adapters outside the ReDevPlugin
permission, confirmation, token, lease, audit, and lifecycle chain.

# Boundaries

Redeven must not point builds, tests, release validation, or examples at a local
`../redevplugin` checkout through `go.work`, `go.work.sum`, `replace`, local npm
workspace/link/file/portal wiring, Rust path overrides, copied source trees, or
build aliases. Redeven must also not copy generated ReDevPlugin source, schemas,
SDK files, or runtime binaries into its tree as a substitute for a released
dependency. CLI commands such as `redeven plugin validate` may be thin wrappers
over released ReDevPlugin validators, but they must not carry a second manifest
parser, looser validator, alternate packaging flow, divergent fixture format, or
separate install lifecycle.

Redeven must not implement an alternate manifest parser, package builder,
registry lifecycle, bridge token issuer, asset-ticket system, storage broker,
network broker, runtime IPC layer, WASM executor, stream envelope, operation
manager, or plugin lifecycle state machine. Redeven may register business
capability adapters such as containers, files, shell, cloud, or database access,
but each adapter must receive request context that already passed ReDevPlugin
identity, permission, confirmation, lease/token, quota, and audit checks.

Container management, if exposed as an official plugin experience, is a Redeven
business capability registered through ReDevPlugin. It is not a plugin runtime
mechanism and must still pass through ReDevPlugin permission, confirmation,
token, lease, audit, and lifecycle contracts.

Flower-generated plugin flows are Redeven orchestration over ReDevPlugin
primitives. Flower may draft source, call released ReDevPlugin validators and
builders, ask the user for approval, install and enable through ReDevPlugin
lifecycle APIs, and open the resulting sandboxed surface. Flower must not write
plugin registry rows, mint bridge tokens, place UI assets directly under Env App
routes, bypass package signatures or trust policy, or grant storage, network, or
runtime access outside ReDevPlugin brokers.

ReDevPlugin upgrades are ordinary published dependency upgrades. A Redeven
change that depends on ReDevPlugin behavior must update the released Go module,
npm package, runtime artifact reference, compatibility manifest or contract
hashes, and verification scripts together; unreleased local ReDevPlugin behavior
is not a valid integration target.

# Citations

[1] redeven:AGENTS.md:217 - Published dependency policy lists `redevplugin` as an upstream dependency consumed by Redeven.
[2] redeven:AGENTS.md:232 - Redeven must consume ReDevPlugin through published artifacts.
[3] redeven:AGENTS.md:242 - Local sibling checkout wiring for ReDevPlugin is forbidden.
[4] redeven:AGENTS.md:249 - ReDevPlugin owns platform-general plugin concerns.
[5] redeven:AGENTS.md:265 - Redeven owns only product integration and business adapters.
[6] redeven:AGENTS.md:282 - Redeven imports released ReDevPlugin artifacts one-way and keeps Redeven-specific behavior in adapters.
[7] redeven:AGENTS.md:291 - Redeven integration must keep ReDevPlugin platform state opaque.
[8] redeven:AGENTS.md:309 - Platform contract bugs found during Redeven integration must be fixed upstream in ReDevPlugin first.
[9] redeven:AGENTS.md:314 - Redeven must not fork or reimplement the plugin platform core.
[10] redeven:AGENTS.md:323 - Redeven integration code must not bypass ReDevPlugin tokens, brokers, sandboxing, or lifecycle policy.
[11] redeven:AGENTS.md:329 - Containers are Redeven business capabilities, not a plugin runtime mechanism.
[12] redeven:AGENTS.md:336 - Flower-generated plugin flows are Redeven product orchestration over ReDevPlugin primitives.
[13] redeven:AGENTS.md:344 - ReDevPlugin upgrades in Redeven must consume released artifacts together.
[14] redeven:AGENTS.md:350 - Redeven plugin integration review must reject alternate platform cores and enforce adapter-only business capabilities.
[15] redeven:go.mod:5 - Redeven's current required module list is the active Go dependency surface for released upstream modules.
