---
type: Architecture Boundary
title: ReDevPlugin host integration boundary
description: Redeven consumes ReDevPlugin as a published plugin-platform dependency and keeps host-specific policy in Redeven adapters.
tags: [architecture, dependencies, plugins, release]
timestamp: 2026-06-29T00:00:00Z
---

Redeven treats ReDevPlugin as a published upstream plugin-platform dependency,
not as code to fork or reimplement inside the Redeven tree. ReDevPlugin is an
independently released library/runtime repository, not a Redeven source
directory, submodule, or implementation detail.

# Mechanism

ReDevPlugin owns reusable plugin-platform concerns: package and manifest
validation, lifecycle APIs, permission and confirmation machinery, sandboxed
iframe bridge contracts, Rust runtime supervision, WASM execution, storage and
network brokers, CLI validators, templates, schemas, fixtures, and contract
hashes. Redeven consumes those artifacts through released Go module versions,
npm packages, signed `redevplugin-runtime` binaries, and machine-readable
contract hashes.

Redeven integration code is thin host glue over those artifacts: configuration,
route mounting, adapter registration, product UI placement, release-artifact
selection, and business capability implementations. Public plugin-platform
mechanics belong upstream in ReDevPlugin, including lifecycle endpoints, package
schemas, bridge protocol, storage/network/runtime brokers, operation/stream
envelopes, runtime supervision, generated SDKs, and validators.

ReDevPlugin is the source of both front-end and back-end plugin-platform
implementation. Redeven consumes released npm packages for sandbox surface
hosting, bridge lifecycle, settings/intent SDKs, generated clients, and
sandbox-safe UI helpers. Redeven consumes released Go packages for Host
construction, lifecycle handlers, registry state, permission and confirmation
enforcement, broker contracts, operation/stream envelopes, token/ticket issuance,
and stable platform errors. Redeven bundles the released signed Rust
`redevplugin-runtime` through the released runtime manager/supervisor instead of
implementing a second runtime process, WASM executor, IPC protocol, or
storage/network hot path.

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

Redeven business code starts at adapter registration. Concrete capabilities such
as containers, files, shells, cloud services, database access, vault access,
session mapping, and product audit presentation belong in Redeven only after
ReDevPlugin has constructed the identity, lifecycle, permission, confirmation,
token, lease/quota, revocation, and audit context for the request.

Redeven may choose the state root, backup/export destination, audit sink,
diagnostics sink, and secret-vault adapter, but the ReDevPlugin registry,
package staging state, token/ticket records, storage namespaces, runtime leases,
and revoke epochs remain opaque platform state. Redeven may configure and launch
the released `redevplugin-runtime` through the released ReDevPlugin runtime
manager and present diagnostics, but it must not fork the Rust IPC protocol,
inject custom hostcalls, run plugin WASM modules in a Redeven-owned execution
path, implement a parallel supervisor, or bypass runtime lease, quota, and
revocation checks.

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
manager, runtime supervisor, or plugin lifecycle state machine. Redeven may
expose product routes or CLI commands for plugin management, but
platform-management handlers must be released ReDevPlugin handlers or thin
wrappers around them. Redeven may register business
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
is not a valid integration target. Before Redeven bundles a ReDevPlugin runtime
artifact, the consumer-side release artifact verifier must validate the
downloaded release directory: outer checksums and signature evidence,
release-mode stress counters, each tarball's internal release manifest and
checksum list, compatibility metadata, and runtime binary presence. The verifier
must write a consumption marker that includes the verified tarball hashes and
runtime binary hashes before any checked payload is staged into a Redeven release
or Desktop bundle. Redeven's release and Desktop bundle gates scan for
ReDevPlugin payloads and fail when a runtime binary, release tarball, embedded
runtime inside a Redeven tarball, or release stress summary appears without a
matching marker hash. The released-artifact staging path keeps that boundary
explicit: it can download a ReDevPlugin GitHub Release or copy an already
downloaded artifact directory, runs the verifier with marker output, validates
the staged root with the consumption gate, and only then extracts an optional
target `redevplugin-runtime` binary with its marker for downstream bundle
staging. Redeven release tarballs and Desktop bundles use this path only when a
published ReDevPlugin version is explicitly selected; copied artifact
directories remain a local fixture and preflight input for the helper, not a
GitHub release workflow selector. The default release and Desktop packaging
paths remain no-op for ReDevPlugin payloads until such a version is configured,
so the repository does not silently consume unreleased local behavior.

Redeven-side plugin code layout must make the adapter boundary visible. It may
contain host integration, route mounting, capability adapters, and product UI,
but not a second platform core under names such as plugin runtime, registry,
bridge, storage, or network. Generated DTOs, schemas, SDK clients, and manifest
fixtures must come from released ReDevPlugin artifacts. Redeven tests should
prove host adapter behavior, permission mapping, route mounting, lifecycle
wiring, and product UX, while reusable manifest, package, bridge, runtime,
storage, network, and lifecycle semantics remain covered by ReDevPlugin
fixtures and tests. The local dependency boundary guard enforces the current
no-local-wiring baseline by rejecting Go workspaces, local ReDevPlugin module or
package-manager wiring, copied platform contracts, and `internal/plugins*`
platform-core directories. The release artifact verifier and consumption gate
self-tests keep the future runtime-consumption path executable in CI before a
published ReDevPlugin artifact is selected by Redeven.

# Citations

[1] redeven:AGENTS.md:223 - Published dependency policy lists `redevplugin` as an upstream dependency consumed by Redeven.
[2] redeven:AGENTS.md:256 - Redeven must consume ReDevPlugin through published artifacts.
[3] redeven:AGENTS.md:331 - Local sibling checkout wiring for ReDevPlugin is forbidden.
[4] redeven:AGENTS.md:338 - ReDevPlugin owns platform-general plugin concerns.
[5] redeven:AGENTS.md:354 - Redeven owns only product integration and business adapters.
[6] redeven:AGENTS.md:408 - Redeven treats ReDevPlugin as a published upstream dependency, not a source folder.
[7] redeven:AGENTS.md:441 - Redeven integration must keep ReDevPlugin platform state opaque.
[8] redeven:AGENTS.md:460 - Platform contract bugs found during Redeven integration must be fixed upstream in ReDevPlugin first.
[9] redeven:AGENTS.md:465 - Redeven must not fork or reimplement the plugin platform core.
[10] redeven:AGENTS.md:474 - Redeven integration code must not bypass ReDevPlugin tokens, brokers, sandboxing, or lifecycle policy.
[11] redeven:AGENTS.md:480 - Containers are Redeven business capabilities, not a plugin runtime mechanism.
[12] redeven:AGENTS.md:487 - Flower-generated plugin flows are Redeven product orchestration over ReDevPlugin primitives.
[13] redeven:AGENTS.md:495 - ReDevPlugin upgrades in Redeven must consume released artifacts together.
[14] redeven:AGENTS.md:535 - Redeven plugin integration review must reject alternate platform cores and enforce adapter-only business capabilities.
[15] redeven:go.mod:5 - Redeven's current required module list is the active Go dependency surface for released upstream modules.
[16] redeven:scripts/check_redevplugin_dependency_boundary.sh:1 - The dependency boundary guard blocks local ReDevPlugin wiring and copied platform-core paths.
[17] redeven:scripts/check_redevplugin_release_artifacts.sh:10 - The consumer-side release artifact verifier validates checksums, signature evidence, stress counters, internal manifests, compatibility metadata, and runtime binary presence.
[18] redeven:scripts/check_redevplugin_consumption_gate.sh:10 - The consumption gate fails release staging or Desktop bundling when ReDevPlugin payloads appear without verifier markers.
[19] redeven:.github/workflows/ci-check.yml:108 - CI runs the ReDevPlugin release artifact verifier self-test and consumption gate self-test before a real artifact is wired into release packaging.
[20] redeven:scripts/stage_redevplugin_release_artifacts.sh:14 - The release artifact staging helper verifies downloaded or copied ReDevPlugin artifacts before extracting a runtime payload.
[21] redeven:.github/workflows/release.yml:93 - Release packaging stages ReDevPlugin runtime payloads only when explicit release inputs are configured.
[22] redeven:scripts/build_desktop_bundled_runtime.sh:113 - Desktop bundled-runtime preparation stages ReDevPlugin runtime payloads only when explicit desktop inputs are configured.
