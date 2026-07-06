---
type: Architecture Contract
title: Plugin platform integration
description: Redeven integrates released ReDevPlugin artifacts through Local UI, AppServer, product adapters, official package bundling, and Env App placement.
tags: [architecture, plugins, local-ui, redevplugin]
timestamp: 2026-07-06T00:00:00Z
---

Redeven plugin-platform integration is host-product glue over released
ReDevPlugin artifacts. ReDevPlugin owns reusable platform mechanics; Redeven
owns session mapping, route placement, local policy, product UX, official
catalog projection, and concrete business capability adapters.

At the current source baseline, Redeven consumes
`github.com/floegence/redevplugin v0.1.1` and mounts the released HTTP adapter
through `internal/redevpluginintegration`. That integration configures durable
Host stores, policy/session/security adapters, runtime artifact resolution,
observability fanout, official package trust policy, and Redeven-owned
business capabilities. Env App adds the product entrypoints: an Activity Bar
Plugins panel, a dedicated Plugin Center Activity, and an internal plugin
surface Activity.

# Mechanism

The dependency shape is library and artifact consumption. Redeven imports
released ReDevPlugin Go packages for Host construction, lifecycle DTOs,
mountable handlers, policy hooks, capability adapter contracts, operation
envelopes, and stable platform errors. Env App imports the published
`@floegence/redevplugin-ui@0.1.5` npm package for the reusable
`PluginSurfaceHost` bridge host. Runtime execution uses the released signed
`redevplugin-runtime` selected by release metadata, and the runtime artifact
resolver fails closed when the matching artifact is absent.

`PluginSurfaceFrame` is the Redeven product wrapper around that published UI
package. It owns Env App Activity placement, close/back behavior, local
loopback versus regional `plg-*` sandbox origin selection, asset-session iframe
URL construction, and a narrow fetch adapter that rewrites SDK
`/_redevplugin/api/plugins*` calls to Redeven's
`/_redeven_proxy/api/plugins*` route while preserving Local UI access headers.
The published `PluginSurfaceHost` owns exact-origin bridge filtering, bridge
handshake validation, bridge-token requests, RPC forwarding, confirmation
request handling, and lifecycle disposal. Redeven must not turn the frame into
a copied manifest parser, registry, generated SDK, storage broker, stream
broker, or runtime implementation.

Local UI separates Env App under `/_redeven_proxy/*` from direct sessions
served by the agent after E2EE handshake. Plugin management requests under
`/_redeven_proxy/api/plugins*` are accepted only from Env App origins, rewritten
to `/_redevplugin/api/plugins*`, tagged with the internal Env-trusted plugin
route role, and delegated to the mounted ReDevPlugin handler. Env-trusted
delegation binds the current Redeven channel id or the fixed Local UI session
to a host-derived ReDevPlugin session and overwrites the owner-session hash and
CSRF headers before the released guard validates the request. Code App wires a
plugin-platform session resolver that keeps remote control-plane channels
authoritative and, only when Local UI is enabled, resolves `local-ui` to the
synthetic Env App session used by Local UI routes.

Plugin sandbox requests under `/_redeven_plugin*` are accepted only for the
plugin sandbox host role whose first label is `plg-*`. AppServer rewrites those
requests to `/_redevplugin*`, tags them with the internal plugin-sandbox route
role, and delegates to ReDevPlugin. Env App, codespace, port-forward, unknown,
and missing-origin callers receive fail-closed responses and cannot reach
plugin assets, stream endpoints, CSP reports, or bootstrap routes through Env
App management or codespace helper paths. AppServer also rewrites plugin asset
cookie paths and `Service-Worker-Allowed` headers from ReDevPlugin's internal
namespace to the public `/_redeven_plugin` namespace.

Official catalog projection is Redeven product metadata, not registry state.
Env App embeds the official catalog seed for
`com.redeven.official.containers` and merges it with installed ReDevPlugin
records by `plugin_id`. Installed records outside the official catalog are
excluded from this first-party management surface. Runnable official records
must still have a runnable ReDevPlugin trust state; `needs_review`,
`untrusted`, `blocked_security`, and other non-runnable trust states stay in
needs-attention state.

Official install and update use a bundled package allowlist. The
`redeven-official-plugins` repository builds the Containers `.redevplugin`
package and records the canonical package hash, manifest hash, entries hash,
and package-file checksum. Redeven embeds that package in
`officialPluginPackages.ts` and the ReDevPlugin integration trust verifier only
accepts the exact known official Containers hashes as bundled trust. Plugin
Center sends the bundled package to the released install/update lifecycle API
with `trust_state: "bundled"`. The browser does not fetch package URLs, verify
signatures, parse manifests, or write ReDevPlugin registry rows.

Redeven business code starts at adapter registration. Containers, files,
shell, cloud services, database access, vault access, session mapping, and
product audit presentation are Redeven implementations only after ReDevPlugin
has constructed identity, lifecycle, permission, confirmation, token or lease,
quota, revocation, and audit context for the request.

The first official plugin experience is Containers. Its source, UI, manifest,
tests, README, catalog seed, and package scripts live in
`../redeven-official-plugins`. Its package declares the
`redeven.capability.container_resources.v1` capability and calls Redeven's
registered Docker/Podman adapter through ReDevPlugin RPC. The plugin treats
Docker and Podman as separate engines; container identity is `(engine,
container_id)` across request schemas, response schemas, UI row keys, and
dangerous confirmation hash fields.

# Boundaries

Redeven must not point builds, tests, release validation, examples, or source
code at a local `../redevplugin` checkout. `go.work`, `go.work.sum`, Go
`replace`, local npm `file:`, `link:`, `workspace:`, or `portal:` wiring, Rust
path overrides, copied schemas, copied generated clients, copied runtime
binaries, or copied platform source trees are not valid integration paths.

Redeven must not implement an alternate manifest parser, package builder,
registry lifecycle, bridge token issuer, asset-ticket system, storage broker,
network broker, runtime IPC layer, WASM executor, operation manager, runtime
supervisor, stream envelope, or plugin lifecycle state machine. If a missing
contract blocks reusable integration, the durable fix belongs upstream in
ReDevPlugin and Redeven consumes the released artifact that contains it.

Desktop runtime-control, RCPP provider APIs, standalone Gateway APIs, and
Flower target grants are adjacent host mechanisms, not plugin capability or
grant planes. Plugin surfaces and workers must not receive runtime-control
tokens, raw local direct-session artifacts, Gateway bridge credentials, RCPP
provider credentials, or Flower grants as ambient authority.

Containers are a Redeven business capability when exposed to plugins, not a
plugin runtime mechanism. Gateway environment profiles and RCPP provider
environment catalogs are external environment access/control constructs, not
plugin installation identities, plugin broker state, or a substitute for the
closed-world container resources capability contract.

# Citations

[1] redeven:AGENTS.md:256 - Redeven consumes ReDevPlugin through published artifacts only.
[2] redeven:AGENTS.md:266 - Redeven integration code should be thin host glue over released artifacts.
[3] redeven:AGENTS.md:290 - Plugin UI platform code should come from released ReDevPlugin npm packages.
[4] redeven:AGENTS.md:354 - Redeven owns product integration, session mapping, policy, sinks, and business adapters.
[5] redeven:AGENTS.md:480 - Containers are Redeven business capabilities, not plugin runtime mechanics.
[6] redeven:go.mod:11 - Redeven consumes the published ReDevPlugin Go module.
[7] redeven:internal/codeapp/appserver/server.go:529 - AppServer delegates plugin sandbox routes only for plugin sandbox origins.
[8] redeven:internal/codeapp/appserver/server.go:537 - AppServer delegates plugin management routes only for Env App origins.
[9] redeven:internal/codeapp/appserver/server.go:626 - AppServer rewrites Redeven plugin routes to ReDevPlugin handler paths.
[10] redeven:internal/codeapp/appserver/server_test.go:733 - Tests bind Env App management delegation to the mounted plugin platform handler.
[11] redeven:internal/codeapp/appserver/server_test.go:833 - Tests bind plugin-origin sandbox namespace delegation to the mounted plugin platform handler.
[12] redeven:internal/codeapp/codeapp.go:1 - Code App wires the plugin-platform session resolver used by the ReDevPlugin integration.
[13] redeven:internal/codeapp/plugin_local_session_test.go:1 - Tests bind the Local UI `local-ui` resolver fallback for plugin management.
[14] redeven:internal/redevpluginintegration/integration.go:52 - The integration package configures the released ReDevPlugin Host.
[15] redeven:internal/redevpluginintegration/adapters.go:381 - The Containers capability adapter dispatches ReDevPlugin calls into Redeven business logic.
[16] redeven:internal/redevpluginintegration/adapters.go:1 - The adapter package owns session, policy, trust, runtime, capability, and operation-cancel integration glue.
[17] redeven:internal/envapp/ui_src/src/ui/plugins/pluginApi.ts:1 - Env App plugin management calls use the Redeven proxy plugin namespace.
[18] redeven:internal/envapp/ui_src/src/ui/plugins/officialPluginPackages.ts:1 - Redeven embeds the bundled official Containers package.
[19] redeven:internal/envapp/ui_src/package.json:25 - Env App consumes the published ReDevPlugin UI package for PluginSurfaceHost.
[20] redeven:internal/envapp/ui_src/src/ui/plugins/PluginSurfaceFrame.tsx:1 - Env App wraps PluginSurfaceHost with product placement and Redeven route adaptation.
[21] redeven:okf/architecture/container-resources-capability.md:9 - The container resources contract is a Redeven-owned business capability surface.
