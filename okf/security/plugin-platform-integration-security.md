---
type: Security Contract
title: Plugin platform integration security
description: Redeven maps sessions, route ownership, permission caps, and business capabilities onto released ReDevPlugin security contracts.
tags: [security, plugins, permissions, local-ui]
timestamp: 2026-07-02T00:00:00Z
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
clamp. A plugin integration must map those host facts into released ReDevPlugin
policy hooks instead of inventing Redeven-only plugin permission bits.

Route ownership is split by entrypoint. Local UI mounts the Env App appserver
under `/_redeven_proxy/*`, while direct sessions use the agent after the E2EE
handshake. Future plugin management, surface bootstrap, asset, and RPC routes
must be mounted through released ReDevPlugin handlers or thin Redeven wrappers
that preserve the appserver response shape. Redeven may preserve flat
`error_code` values from plugin-platform failures for product UI, but the error
catalog and platform semantics must remain released ReDevPlugin contracts.

The current AppServer route gate fail-closes sandbox origins by role. Env App
origins may reach local management APIs and Env App dist under
`/_redeven_proxy/*`; codespace origins may reach only `/_redeven_proxy/inject.js`
for code-server bridge helpers; plugin sandbox origins with a `plg-*` first host
label are recognized explicitly and receive 404 for management APIs, Env App
dist, and injection helpers. Tests cover Env App, codespace, port-forward,
plugin, unknown, and missing-origin callers across management API, Env App dist,
and injection helper paths.

Business capability adapters such as containers, files, shell, cloud services,
databases, vault access, or local product APIs begin after ReDevPlugin has
constructed the request context. The adapter receives a request that already
passed plugin identity, lifecycle, permission, confirmation, token or lease,
quota, revoke-epoch, and audit construction. Redeven product policy may narrow
or deny a capability; it must not mint plugin tokens, grant storage/network
access, or call the business adapter outside ReDevPlugin brokers.

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
`/_redeven_proxy/env/*`, or `/_redeven_proxy/inject.js`; future plugin routes
must use released ReDevPlugin handlers or thin wrappers instead of reusing Env
App or codespace helper paths. Until that integration exists,
`/_redeven_plugin/*` is reserved and must return 404 for Env App, codespace,
port-forward, plugin, unknown, missing-origin, and Local UI callers. Local UI
must forward that namespace with plugin route context instead of Env App route
context, so reserved plugin requests cannot inherit Env App management authority.

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
[13] redeven:internal/localui/localui.go:710 - Local UI forwards reserved plugin namespace requests with plugin route context.
[14] redeven:internal/codeapp/appserver/server.go:279 - AppServer has a distinct Local UI plugin route context.
[15] redeven:internal/codeapp/appserver/server.go:512 - AppServer reserves `/_redeven_plugin/*` for released ReDevPlugin handlers and fails closed until integration is wired.
[16] redeven:internal/codeapp/appserver/server.go:520 - AppServer management APIs are gated to the Env App origin role.
[17] redeven:internal/codeapp/appserver/server.go:541 - AppServer serves `inject.js` only to codespace origins.
[18] redeven:internal/codeapp/appserver/server.go:6252 - `plg-*` first labels are classified as plugin sandbox origins.
[19] redeven:internal/codeapp/appserver/server_test.go:548 - Tests bind the route matrix across Env App, codespace, port-forward, plugin, unknown, and missing-origin callers.
[20] redeven:internal/localui/localui_test.go:285 - Tests bind Local UI reserved plugin namespace forwarding to 404 without access-gate or Env App shell interception.
[21] redeven:internal/envapp/ui_src/src/ui/services/localApi.localAccess.e2e.test.ts:193 - Local UI preserves flat appserver `error_code` values on HTTP failures.
[22] redeven:okf/architecture/container-resources-capability.md:33 - Container start preflight records risk flags and admin hints without owning ReDevPlugin confirmation enforcement.
[23] redeven:internal/capabilities/containers/preflight_test.go:14 - Tests verify container preflight redacts secret values and sensitive paths.
