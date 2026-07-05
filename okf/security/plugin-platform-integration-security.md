---
type: Security Contract
title: Plugin platform integration security
description: Redeven maps sessions, route ownership, permission caps, and business capabilities onto released ReDevPlugin security contracts.
tags: [security, plugins, permissions, local-ui]
timestamp: 2026-07-05T00:00:00Z
---

Redeven plugin security is host integration over released ReDevPlugin
contracts. ReDevPlugin owns plugin identity, lifecycle, permission evaluation,
dangerous confirmations, token and asset-ticket issuance, runtime leases,
broker enforcement, quota/revocation checks, and stable platform errors.
Redeven contributes the local session, product policy, route mounting, vault
adapter, audit/diagnostics sinks, and concrete business capability adapters.

# Mechanism

Redeven session metadata is authoritative only when it comes from the control
channel or the local direct-session path. Browser-provided permission or app
claims are not trusted input to plugin adapters. The current session metadata
surface contains `can_read`, `can_write`, `can_execute`, and a separate
`can_admin` management bit; `can_admin` is not part of the local RWX permission
clamp. The ReDevPlugin integration maps those host facts into released
ReDevPlugin session and policy hooks: it derives owner/session hashes from
`session.Meta`, applies Redeven's local permission cap, caches the resolved
session by hash, and evaluates method effects against the cached host-derived
permission set instead of trusting browser-supplied claims.

Route ownership is split by entrypoint. Local UI mounts the Env App appserver
under `/_redeven_proxy/*`, while direct sessions use the agent after the E2EE
handshake. Plugin management, surface bootstrap, asset, stream, CSP report, and
RPC routes are mounted through the released ReDevPlugin handler behind Redeven
origin-role gates. Redeven may preserve flat `error_code` values from
plugin-platform failures for product UI, but the error catalog and platform
semantics remain released ReDevPlugin contracts. When the platform handler is
disabled, `/_redeven_proxy/api/plugins` still returns AppServer flat JSON 404
without a plugin-owned `error_code`. When the handler is enabled, Local UI uses
the normal access gate before forwarding plugin management requests to
AppServer.

The current AppServer route gate fail-closes by role. Env App origins may reach
local management APIs and Env App dist under `/_redeven_proxy/*`; codespace
origins may reach only `/_redeven_proxy/inject.js` for code-server bridge
helpers; plugin sandbox origins with a `plg-*` first host label are recognized
explicitly and remain denied for management APIs, Env App dist, and injection
helpers. `/_redeven_proxy/api/plugins*` is delegated to
`/_redevplugin/api/plugins*` only for Env App origins, and `/_redeven_plugin*`
is delegated to `/_redevplugin*` only for plugin sandbox origins. AppServer
attaches internal route roles before calling the ReDevPlugin handler, and the
ReDevPlugin web security adapter allows only the matching route family for each
role.

Unsafe plugin management requests must reach the released ReDevPlugin handler
with a CSRF header that matches the host-derived ReDevPlugin session context.
Redeven's Env-trusted proxy derives the authoritative channel id from the Env
App origin label, or from the fixed Local UI session in Local UI mode, then the
ReDevPlugin integration wrapper resolves that channel and overwrites both
`X-ReDevPlugin-Owner-Session-Hash` and `X-ReDevPlugin-CSRF` from the resolved
session context before delegation. The released guard still validates
`X-ReDevPlugin-CSRF` and the legacy `X-CSRF-Token` spelling and fails closed for
unknown or mismatched sessions, but Env App UI code does not compute or own the
token. Browser-provided permission claims or plugin session-binding headers are
not trusted as authority.

Business capability adapters such as containers, files, shell, cloud services,
databases, vault access, or local product APIs begin after ReDevPlugin has
constructed the request context. The adapter receives a request that already
passed plugin identity, lifecycle, permission, confirmation, token or lease,
quota, revoke-epoch, and audit construction. Redeven product policy may narrow
or deny a capability; it must not mint plugin tokens, grant storage/network
access, or call the business adapter outside ReDevPlugin brokers.

Runtime leases are capability-bearing execution context, not Redeven session
tokens. A released ReDevPlugin Host must bind worker leases to the active plugin
package, surface and owner context, runtime instance, runtime generation, IPC
channel, handshake nonce, method, effect, execution mode, target descriptors,
quota limits, policy revision, management revision, and revoke epoch before a
worker is invoked. Redeven may route the resulting audit event into its audit
sink, but the event must carry traceable lease/token/runtime/revision metadata
without persisting the cleartext bearer lease token.

Runtime artifact lookup is also fail-closed. Redeven's adapter searches only
published bundle/executable locations for the matching `redevplugin-runtime`
target and returns an error when the artifact is absent; it does not fall back
to `../redevplugin`, local path overrides, or copied runtime binaries.

The container resources v1 contract follows that boundary. Its start preflight
plan is a Redeven business DTO that summarizes Docker and Podman runtime state
without leaking raw environment values, raw label values, raw inspect JSON, or
sensitive host paths. It records risk flags and admin-required hints for the
future trusted confirmation UI, but ReDevPlugin remains responsible for the
actual confirmation intent, plan hash binding, token, lease, audit, and revoke
enforcement when the adapter is registered.

# Boundaries

Redeven must not point builds, tests, release validation, examples, or committed
source at a local `../redevplugin` checkout through `go.work`, `go.work.sum`,
`replace`, local npm link/workspace/file/portal wiring, Rust path overrides,
copied source trees, or copied generated contracts. A ReDevPlugin integration
change is not ready until it consumes published Go, npm, runtime, schema, and
contract-hash artifacts.

Redeven must not implement an alternate plugin gateway token issuer, asset
ticket system, manifest parser, package validator, registry lifecycle, storage
broker, network broker, WASM executor, runtime supervisor, stream envelope, or
plugin lifecycle state machine. It must not directly edit ReDevPlugin registry
tables, package staging state, token rows, storage namespaces, runtime leases,
or revoke epochs.

Plugin surfaces and workers must not receive Desktop runtime-control tokens,
raw local direct-session artifacts, standalone Gateway bridge credentials, or
Flower target grants as ambient authority. Access to Redeven business resources
must always arrive through a released ReDevPlugin request context and a
Redeven-registered adapter.

Plugin sandbox origins must not be granted access to `/_redeven_proxy/api/*`,
`/_redeven_proxy/env/*`, or `/_redeven_proxy/inject.js`; plugin routes
must use released ReDevPlugin handlers or thin wrappers instead of reusing Env
App or codespace helper paths. `/_redeven_proxy/api/plugins` and
`/_redeven_proxy/api/plugins/*` are Env App management routes only after the
Env App origin role and Local UI access gate have been satisfied.
`/_redeven_plugin/*` is a plugin-sandbox route family only after the plugin
sandbox origin role has been satisfied. The AppServer plus Local UI route
matrices must cover root, bootstrap, asset, stream, and CSP report paths so
plugin requests cannot inherit Env App management authority, codespace helpers,
port-forward proxying, local access-gate behavior, or nested Local UI API
errors.

Official catalog discovery is not a trust bypass. Redeven's UI may show the
bundled official catalog seed, but package download, checksum verification,
signature verification, trust-state assignment, registry writes, and retained
data behavior must remain ReDevPlugin Host lifecycle responsibilities. Until a
released host distribution install API exists, Plugin Center disables install
for official catalog entries that require that API instead of fetching package
URLs in the browser. This prevents browser-readable package transport from
becoming an alternate trust path. Matching installed official records are also
bounded by ReDevPlugin trust state: only runnable trust states can be projected
as openable or enableable, while non-runnable trust states stay in a
needs-attention state even when the plugin id appears in the official catalog.

# Citations

[1] redeven:AGENTS.md:256 - Redeven consumes ReDevPlugin through published artifacts only.
[2] redeven:AGENTS.md:331 - Local sibling checkout wiring and copied ReDevPlugin source are forbidden.
[3] redeven:AGENTS.md:354 - Redeven owns product integration, session mapping, policy, sinks, and business adapters.
[4] redeven:AGENTS.md:441 - ReDevPlugin platform state remains opaque to Redeven integration code.
[5] redeven:AGENTS.md:474 - Redeven integration must not bypass plugin tokens, brokers, sandboxing, or lifecycle policy.
[6] redeven:AGENTS.md:495 - ReDevPlugin upgrades in Redeven are published dependency changes, not source syncs.
[7] redeven:internal/session/types.go:7 - Session metadata is delivered by the control plane and browser claims are not trusted.
[8] redeven:internal/session/types.go:22 - `can_admin` gates management actions and is not part of the RWX clamp.
[9] redeven:internal/localui/localui.go:62 - The Env App appserver is mounted under `/_redeven_proxy/*`.
[10] redeven:internal/localui/localui.go:65 - Direct sessions are served by the agent after E2EE handshake.
[11] redeven:internal/codeapp/appserver/server_test.go:1215 - Management API tests forbid admin actions when `can_admin=false`.
[12] redeven:internal/localui/localui.go:147 - Local UI mounts the reserved plugin namespace separately from the Env App proxy.
[13] redeven:internal/localui/localui.go:693 - Local UI keeps plugin management fail-closed before local access gating only when the platform handler is disabled.
[14] redeven:internal/localui/localui.go:709 - Local UI recognizes the reserved plugin management API root and child paths.
[15] redeven:internal/localui/localui.go:717 - Local UI forwards reserved plugin namespace requests with plugin route context.
[16] redeven:internal/codeapp/appserver/server.go:279 - AppServer has a distinct Local UI plugin route context.
[17] redeven:internal/codeapp/appserver/server.go:529 - AppServer delegates `/_redeven_plugin/*` to ReDevPlugin only for plugin sandbox origins.
[18] redeven:internal/codeapp/appserver/server.go:537 - AppServer gates `/_redeven_proxy/api/plugins*` to the Env App origin role before delegating.
[19] redeven:internal/codeapp/appserver/server.go:626 - AppServer rewrites Redeven plugin routes to ReDevPlugin handler paths with internal route roles.
[20] redeven:internal/codeapp/appserver/server.go:5384 - The reserved plugin management API matcher covers the root and child paths.
[21] redeven:internal/codeapp/appserver/server.go:541 - AppServer serves `inject.js` only to codespace origins.
[22] redeven:internal/codeapp/appserver/server.go:6263 - `plg-*` first labels are classified as plugin sandbox origins.
[23] redeven:internal/codeapp/appserver/server_test.go:548 - Tests bind the proxy route matrix across Env App, codespace, port-forward, plugin, unknown, and missing-origin callers.
[24] redeven:internal/codeapp/appserver/server_test.go:691 - Tests bind the no-handler plugin management namespace to AppServer flat JSON 404 responses.
[25] redeven:internal/codeapp/appserver/server_test.go:733 - Tests bind Env App management delegation to the mounted plugin platform handler.
[26] redeven:internal/codeapp/appserver/server_test.go:833 - Tests bind plugin-origin sandbox namespace delegation to the mounted plugin platform handler.
[27] redeven:internal/localui/localui_test.go:348 - Tests bind enabled plugin management requests to the normal Local UI access gate.
[28] redeven:internal/envapp/ui_src/src/ui/services/localApi.localAccess.e2e.test.ts:193 - Local UI preserves flat appserver `error_code` values on HTTP failures.
[29] redeven:okf/architecture/container-resources-capability.md:33 - Container start preflight records risk flags and admin hints without owning ReDevPlugin confirmation enforcement.
[30] redeven:internal/capabilities/containers/preflight_test.go:14 - Tests verify container preflight redacts secret values and sensitive paths.
[31] redeven:AGENTS.md:446 - Redeven must not bypass runtime lease, quota, or revocation checks.
[32] redeven:AGENTS.md:478 - Business adapters must pass through ReDevPlugin permission, confirmation, token, lease, audit, and lifecycle contracts.
[33] redeven:internal/redevpluginintegration/adapters.go:85 - The session resolver projects Redeven session metadata into ReDevPlugin session context.
[34] redeven:internal/redevpluginintegration/adapters.go:146 - Local policy decisions use the cached host-derived ReDevPlugin session permissions.
[35] redeven:internal/redevpluginintegration/adapters.go:272 - CSRF validation requires the token to match the resolved ReDevPlugin session context.
[36] redeven:internal/redevpluginintegration/adapters.go:218 - Runtime artifact resolution searches published bundle/executable locations and fails closed.
[37] redeven:internal/envapp/ui_src/src/ui/plugins/pluginApi.ts:9 - Plugin management API calls use `/_redeven_proxy/api/plugins*`.
[38] redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterView.tsx:363 - Official catalog install is disabled when host distribution install API is required.
[39] redeven:internal/envapp/ui_src/src/ui/plugins/pluginApi.ts:60 - The current install command rejects official catalog install without a host distribution install API.
