---
type: Architecture Contract
title: Plugin platform integration
description: Redeven integrates released ReDevPlugin artifacts through Local UI, AppServer, product adapters, and Flower orchestration without owning plugin-platform core.
tags: [architecture, plugins, local-ui, redevplugin]
timestamp: 2026-07-05T00:00:00Z
---

Redeven plugin-platform integration is host-product glue over released
ReDevPlugin artifacts. ReDevPlugin owns reusable plugin platform mechanics;
Redeven owns session mapping, route placement, product policy, local UX, and
business capability adapters.

At the current source baseline, Redeven consumes the released
`github.com/floegence/redevplugin v0.1.1` Go module and mounts the released
HTTP adapter through a narrow `internal/redevpluginintegration` package. That
package configures ReDevPlugin Host stores, policy/session/security adapters,
runtime artifact resolution, observability fanout, and Redeven-owned business
capabilities without copying platform source. Env App now adds product
entrypoints for official plugin discovery and management: an Activity Bar
Plugins panel and a dedicated Plugin Center view. Those entrypoints project
official catalog metadata and only the installed ReDevPlugin records whose
`plugin_id` appears in that official catalog; they do not implement a second
registry, package downloader, manifest parser, trust verifier, bridge, or
runtime.

The same baseline does include a Redeven-owned container resources business
capability contract under `spec/capabilities/container-resources-v1.schema.json`
and `internal/capabilities/containers`. That contract is adapter input/output
shape for Docker and Podman resources; it is not a plugin-platform schema copy
and it does not introduce a ReDevPlugin dependency before a published release is
selected.

# Mechanism

The dependency shape is library and artifact consumption. Redeven imports
released ReDevPlugin Go packages for Host construction, lifecycle DTOs,
mountable handlers, policy hooks, broker contracts, operation envelopes, and
stable platform errors. Future Redeven UI surfaces must import released
ReDevPlugin npm packages for surface hosting, bridge SDKs, generated clients,
settings/intent helpers, and sandbox-safe UI utilities. Runtime execution uses
the released signed `redevplugin-runtime` selected by release metadata; the
current runtime artifact resolver searches only published bundle/executable
locations and fails closed when the matching artifact is absent.

The Redeven integration layer configures those artifacts. It chooses the
plugin state root under `StateDir/apps/redevplugin`, creates durable
ReDevPlugin SQLite stores, registers audit and diagnostics fanout, maps local
permission caps, resolves Redeven sessions, mounts routes, and registers
business adapters. Local UI still separates the Env App appserver under
`/_redeven_proxy/*` from direct sessions served by the agent after an E2EE
handshake; plugin lifecycle, surface bootstrap, asset, stream, CSP report, and
RPC routes fit into that host structure as released ReDevPlugin handlers
behind Redeven route gates.

The current AppServer route gate treats Env App, codespace, port-forward, and
plugin sandbox origins as separate roles. Env App origins may reach
`/_redeven_proxy/api/*` and `/_redeven_proxy/env/*`; codespace origins may reach
`/_redeven_proxy/inject.js`; plugin sandbox origins with a `plg-*` first host
label are recognized explicitly and remain denied for Env App management APIs,
Env App dist, and codespace injection helpers. When the plugin platform handler
is present, `/_redeven_proxy/api/plugins` and
`/_redeven_proxy/api/plugins/*` are accepted only from the Env App origin role,
rewritten to `/_redevplugin/api/plugins*`, marked with the internal
`env_trusted` route role, and delegated to the released ReDevPlugin handler. If
the handler is absent, Env App callers still receive the AppServer's flat JSON
404 response without a plugin-owned `error_code`, and non-Env callers receive
404. Local UI preserves that pre-access flat 404 only when the platform handler
is absent; once the handler is enabled, plugin management requests use the
normal local access gate before forwarding to AppServer.

Env-trusted plugin management delegation binds the current Redeven session
before the request reaches the released handler. AppServer attaches the
authoritative channel id from the Env App origin label, or `local-ui` in Local
UI mode, and the ReDevPlugin integration wrapper resolves that channel into a
host-derived session context. It then overwrites the ReDevPlugin owner-session
hash and CSRF headers from that context, so lifecycle POSTs are validated by
the released ReDevPlugin web-security guard without requiring Env App UI code
to know or reproduce the CSRF hash derivation.

`/_redeven_plugin` and `/_redeven_plugin/*` are accepted only from plugin
sandbox origins when the handler is present. AppServer rewrites those requests
to `/_redevplugin*`, marks them with the internal `plugin_sandbox` route role,
and delegates to ReDevPlugin. Env App, codespace, port-forward, unknown, and
missing-origin callers continue to receive 404, and the namespace does not fall
through to Env App shell assets, codespace injection, port-forward proxying, or
Local UI nested API envelopes. The route matrix tests cover both the
fail-closed no-handler reservation and the enabled-handler delegation paths.

Redeven business code starts at adapter registration. Capabilities such as
containers, files, shell, cloud services, database access, vault access,
session mapping, and product audit presentation are Redeven implementations
only after ReDevPlugin has constructed the identity, lifecycle, permission,
confirmation, token or lease, quota, revocation, and audit context for the
request.

Runtime worker execution follows the same division. Redeven resolves the
released `redevplugin-runtime` artifact from approved bundle/executable
locations, while runtime lease minting, runtime-generation binding, IPC channel
binding, connection nonce binding, worker method/effect/execution binding,
descriptor hash binding, quota-limit binding, signature verification, replay
rejection, and Host audit construction remain ReDevPlugin contracts. Redeven's
observability adapter may persist ReDevPlugin audit and diagnostic events, but
it must not mint alternate runtime leases, rewrite lease audiences, or log
bearer lease tokens.

Product UI may place ReDevPlugin surfaces in Env App, Activity Bar, Workbench,
Settings, Desktop, or CLI flows, but the plugin document, iframe bootstrap,
asset tickets, bridge lifecycle, generated client semantics, settings/intent
SDK, and sandbox messaging stay released ReDevPlugin artifacts. Flower and
Floret may orchestrate plugin generation, validation, packaging, installation,
enablement, opening, diagnostics, update, export/import, and uninstall through
released ReDevPlugin APIs; they must not become a second registry, builder,
token issuer, runtime, or broker.

Redeven's first official catalog seed is embedded in Env App UI as product
metadata for `com.redeven.official.containers`. The source of the official plugin
itself lives in the separate `redeven-official-plugins` repository, whose first
feature initializes `plugins/containers`, catalog seed/schema, and package
scripts. Redeven may display that official seed and merge it with matching
installed ReDevPlugin records by `plugin_id`; user-local install and enable
state remains the ReDevPlugin Host registry under `StateDir/apps/redevplugin`.
Installed records outside the official catalog are not shown in this official
Plugin Center. Matching installed records are still constrained by their
ReDevPlugin `trust_state`: only `bundled`, `verified`, and `unsigned_local`
records are projected as runnable. Official records with `needs_review`,
`untrusted`, `blocked_security`, or any other non-runnable trust state are shown
as attention-needed and do not receive open or enable launch targets.

The current ReDevPlugin v0.1.1 management API exposes `catalog`, install by
`package_base64`, enable, disable, uninstall, update, and surface open. It does
not expose a host-owned official distribution install API that accepts an
official catalog item, downloads the package, verifies checksum/signature, and
commits through lifecycle. Redeven's Plugin Center therefore treats official
distribution install as unavailable when the catalog item marks
`requiresHostDistributionInstallAPI=true`. This keeps browser UI from becoming
the package downloader or trust verifier and preserves the upstream boundary for
future official install support.

The reusable surface host is also an upstream ReDevPlugin artifact. Redeven does
not currently consume a released `@floegence/redevplugin-ui` npm package, so the
official plugin entry slice does not render sandbox iframes locally. It keeps
surface opening disabled in product UI rather than copying iframe bootstrap or
bridge-host behavior into Redeven.

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

Plugin assets and RPC must not be smuggled through `/_redeven_proxy/api/*`,
`/_redeven_proxy/env/*`, or `/_redeven_proxy/inject.js`. Those paths remain Env
App management/dist and codespace helper surfaces; plugin sandbox origins are
not valid callers for them. The only plugin-shaped Env App management prefix is
`/_redeven_proxy/api/plugins`, and it is owned by the mounted released
ReDevPlugin handler only after AppServer has verified the Env App origin role.

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
[12] redeven:go.mod:11 - Redeven consumes `github.com/floegence/redevplugin v0.1.1`.
[13] redeven:internal/localui/localui.go:62 - Local UI mounts the Env App appserver under `/_redeven_proxy/*`.
[14] redeven:internal/localui/localui.go:65 - Direct sessions are served by the agent after E2EE handshake.
[15] redeven:internal/localui/localui.go:146 - Local UI exposes the direct websocket route under `/_redeven_direct/ws`.
[16] redeven:internal/localui/localui.go:150 - Local UI proxies Env App through `/_redeven_proxy/`.
[17] redeven:internal/localui/localui.go:147 - Local UI mounts the reserved plugin namespace separately from the Env App proxy.
[18] redeven:internal/localui/localui.go:693 - Local UI keeps plugin management fail-closed before local access gating only when the platform handler is disabled.
[19] redeven:internal/localui/localui.go:709 - Local UI recognizes the reserved plugin management API root and child paths.
[20] redeven:internal/localui/localui.go:717 - Local UI forwards reserved plugin namespace requests with plugin route context.
[21] redeven:internal/codeapp/appserver/server.go:279 - AppServer has a distinct Local UI plugin route context.
[22] redeven:internal/codeapp/appserver/server.go:529 - AppServer delegates `/_redeven_plugin/*` to ReDevPlugin only for plugin sandbox origins.
[23] redeven:internal/codeapp/appserver/server.go:537 - AppServer gates `/_redeven_proxy/api/plugins*` to the Env App origin role before delegating.
[24] redeven:internal/codeapp/appserver/server.go:626 - AppServer rewrites Redeven plugin routes to ReDevPlugin handler paths with internal route roles.
[25] redeven:internal/codeapp/appserver/server.go:5384 - The reserved plugin management API matcher covers the root and child paths.
[26] redeven:internal/codeapp/appserver/server.go:541 - AppServer serves `inject.js` only to codespace origins.
[27] redeven:internal/codeapp/appserver/server.go:6245 - AppServer derives explicit origin roles from the request origin.
[28] redeven:internal/codeapp/appserver/server.go:6263 - `plg-*` first labels are classified as plugin sandbox origins.
[29] redeven:internal/codeapp/appserver/server_test.go:548 - Tests bind the proxy route matrix across Env App, codespace, port-forward, plugin, unknown, and missing-origin callers.
[30] redeven:internal/codeapp/appserver/server_test.go:691 - Tests bind the no-handler plugin management namespace to AppServer flat JSON 404 responses.
[31] redeven:internal/codeapp/appserver/server_test.go:733 - Tests bind Env App management delegation to the mounted plugin platform handler.
[32] redeven:internal/codeapp/appserver/server_test.go:833 - Tests bind plugin-origin sandbox namespace delegation to the mounted plugin platform handler.
[33] redeven:internal/localui/localui_test.go:333 - Tests bind the Local UI reserved plugin namespace route matrix to 404 without access-gate or Env App shell interception.
[34] redeven:okf/security/plugin-platform-integration-security.md:75 - Plugin surfaces and workers must not receive runtime-control, direct-session, Gateway, or Flower artifacts as ambient authority.
[35] redeven:okf/ui/plugin-surfaces.md:17 - Front-end plugin platform implementation arrives as released ReDevPlugin npm packages.
[36] redeven:okf/ai/flower-plugin-generation.md:18 - Flower-generated plugin flow is approved product orchestration over released ReDevPlugin APIs.
[37] redeven:okf/architecture/container-resources-capability.md:9 - The container resources contract is Redeven-owned business capability surface, not plugin-platform core.
[38] redeven:AGENTS.md:446 - Redeven must not bypass runtime lease, quota, or revocation checks.
[39] redeven:AGENTS.md:458 - ReDevPlugin constructs confirmation, token, runtime lease, and audit context.
[40] redeven:internal/redevpluginintegration/integration.go:52 - The integration package configures the released ReDevPlugin Host and durable stores.
[41] redeven:internal/redevpluginintegration/adapters.go:85 - The session resolver projects Redeven session metadata into ReDevPlugin session context.
[42] redeven:internal/redevpluginintegration/adapters.go:218 - Runtime artifact resolution searches published bundle/executable locations and fails closed.
[43] redeven:internal/envapp/ui_src/src/ui/plugins/officialPluginCatalog.ts:3 - Env App embeds the first Redeven official catalog seed item.
[44] redeven:internal/envapp/ui_src/src/ui/plugins/pluginInventoryProjection.ts:12 - Plugin inventory projection merges official catalog and installed ReDevPlugin records by plugin id.
[45] redeven:internal/envapp/ui_src/src/ui/plugins/pluginApi.ts:9 - Env App plugin management wrappers call only the Redeven proxy plugin namespace.
[46] redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterView.tsx:363 - Official installs that require host distribution install API are disabled in Plugin Center.
