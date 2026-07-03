---
type: Architecture Contract
title: Plugin platform integration
description: Redeven integrates released ReDevPlugin artifacts through Local UI, AppServer, product adapters, and Flower orchestration without owning plugin-platform core.
tags: [architecture, plugins, local-ui, redevplugin]
timestamp: 2026-07-02T00:00:00Z
---

Redeven plugin-platform integration is host-product glue over released
ReDevPlugin artifacts. ReDevPlugin owns reusable plugin platform mechanics;
Redeven owns session mapping, route placement, product policy, local UX, and
business capability adapters.

At the current source baseline, Redeven has not yet added a released
ReDevPlugin Go module requirement, ReDevPlugin npm packages, mounted plugin
routes, or bundled `redevplugin-runtime` artifacts. This OKF entry records the
required integration shape and boundary for the future implementation, not an
already-shipped local plugin platform.

The same baseline does include a Redeven-owned container resources business
capability contract under `spec/capabilities/container-resources-v1.schema.json`
and `internal/capabilities/containers`. That contract is adapter input/output
shape for Docker and Podman resources; it is not a plugin-platform schema copy
and it does not introduce a ReDevPlugin dependency before a published release is
selected.

# Mechanism

The intended dependency shape is library and artifact consumption. Redeven
imports released ReDevPlugin Go packages for Host construction, lifecycle DTOs,
mountable handlers, policy hooks, broker contracts, operation envelopes, and
stable platform errors. Redeven imports released ReDevPlugin npm packages for
surface hosting, bridge SDKs, generated clients, settings/intent helpers, and
sandbox-safe UI utilities. Redeven bundles the released signed
`redevplugin-runtime` through ReDevPlugin release metadata and the released
runtime manager.

The Redeven integration layer configures those artifacts. It chooses state
roots, backup/export locations, audit and diagnostics sinks, secret-vault
adapters, local permission caps, session mapping, route mounting, Desktop and
installer bundling, and product UI placement. Local UI already separates the
Env App appserver under `/_redeven_proxy/*` from direct sessions served by the
agent after an E2EE handshake; plugin lifecycle, surface bootstrap, asset, and
RPC routes should fit into that host structure as released ReDevPlugin handlers
or thin wrappers that preserve the host response envelope.

Redeven business code starts at adapter registration. Capabilities such as
containers, files, shell, cloud services, database access, vault access,
session mapping, and product audit presentation are Redeven implementations
only after ReDevPlugin has constructed the identity, lifecycle, permission,
confirmation, token or lease, quota, revocation, and audit context for the
request.

Product UI may place ReDevPlugin surfaces in Env App, Activity Bar, Workbench,
Settings, Desktop, or CLI flows, but the plugin document, iframe bootstrap,
asset tickets, bridge lifecycle, generated client semantics, settings/intent
SDK, and sandbox messaging stay released ReDevPlugin artifacts. Flower and
Floret may orchestrate plugin generation, validation, packaging, installation,
enablement, opening, diagnostics, update, export/import, and uninstall through
released ReDevPlugin APIs; they must not become a second registry, builder,
token issuer, runtime, or broker.

# Boundaries

Redeven must not point builds, tests, release validation, examples, or source
code at a local `../redevplugin` checkout. `go.work`, `go.work.sum`, Go
`replace`, local npm `file:`, `link:`, `workspace:`, or `portal:` wiring, Rust
path overrides, copied schemas, copied generated clients, copied runtime
binaries, or copied platform source trees are not valid integration paths.

Redeven must not implement an alternate manifest parser, package builder,
registry lifecycle, bridge token issuer, asset-ticket system, storage broker,
network broker, runtime IPC layer, WASM executor, stream envelope, operation
manager, runtime supervisor, or plugin lifecycle state machine. If a missing
contract blocks integration, the reusable fix belongs upstream in ReDevPlugin
first and Redeven consumes the released artifact that contains it.

Desktop runtime-control, RCPP provider APIs, standalone Gateway APIs, and
Flower target grants are adjacent host mechanisms, not plugin capability or
grant planes. Plugin surfaces and workers must not receive runtime-control
tokens, raw local direct-session artifacts, Gateway bridge credentials, RCPP
provider credentials, or Flower grants as ambient authority. Access to Redeven
business resources must arrive through released ReDevPlugin brokers and a
Redeven-registered adapter.

Containers are a Redeven business capability when exposed to plugins, not a
plugin runtime mechanism. Gateway environment profiles and RCPP provider
environment catalogs are external environment access/control constructs, not
plugin installation identities, plugin broker state, or a substitute for the
closed-world container resources capability contract.

# Citations

[1] redeven:AGENTS.md:256 - Redeven consumes ReDevPlugin through published artifacts only.
[2] redeven:AGENTS.md:266 - Redeven integration code should be thin host glue over released artifacts.
[3] redeven:AGENTS.md:273 - The intended dependency shape is library consumption, not source sharing.
[4] redeven:AGENTS.md:290 - Plugin UI platform code comes from released ReDevPlugin npm packages.
[5] redeven:AGENTS.md:295 - Host and back-end platform code comes from released ReDevPlugin Go packages.
[6] redeven:AGENTS.md:300 - Backend execution comes from the released Rust `redevplugin-runtime` and ReDevPlugin supervisor.
[7] redeven:AGENTS.md:311 - Redeven-side code should be a narrow integration layer.
[8] redeven:AGENTS.md:325 - Redeven integration code must not grow into a second plugin platform.
[9] redeven:AGENTS.md:331 - Local sibling checkout wiring and copied ReDevPlugin artifacts are forbidden.
[10] redeven:AGENTS.md:495 - ReDevPlugin upgrades in Redeven are published dependency changes, not source syncs.
[11] redeven:AGENTS.md:517 - Redeven-side plugin code layout must make the adapter boundary visible.
[12] redeven:go.mod:5 - Redeven's current Go dependency list does not yet include ReDevPlugin.
[13] redeven:internal/localui/localui.go:62 - Local UI mounts the Env App appserver under `/_redeven_proxy/*`.
[14] redeven:internal/localui/localui.go:65 - Direct sessions are served by the agent after E2EE handshake.
[15] redeven:internal/localui/localui.go:146 - Local UI exposes the direct websocket route under `/_redeven_direct/ws`.
[16] redeven:internal/localui/localui.go:148 - Local UI proxies Env App through `/_redeven_proxy/`.
[17] redeven:okf/security/plugin-platform-integration-security.md:58 - Plugin surfaces and workers must not receive runtime-control, direct-session, Gateway, or Flower artifacts as ambient authority.
[18] redeven:okf/ui/plugin-surfaces.md:17 - Front-end plugin platform implementation arrives as released ReDevPlugin npm packages.
[19] redeven:okf/ai/flower-plugin-generation.md:18 - Flower-generated plugin flow is approved product orchestration over released ReDevPlugin APIs.
[20] redeven:okf/architecture/container-resources-capability.md:9 - The container resources contract is Redeven-owned business capability surface, not plugin-platform core.
