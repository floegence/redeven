---
type: Security Contract
title: Plugin platform integration security
description: Redeven maps sessions, route ownership, bundled official package trust, and business capabilities onto released ReDevPlugin security contracts.
tags: [security, plugins, permissions, local-ui]
timestamp: 2026-07-06T00:00:00Z
---

Redeven plugin security is host integration over released ReDevPlugin
contracts. ReDevPlugin owns plugin identity, lifecycle, permission evaluation,
dangerous confirmations, token and asset-ticket issuance, runtime leases,
broker enforcement, quota/revocation checks, registry mutation, and stable
platform errors. Redeven contributes local session facts, product policy, route
mounting, official bundled-package trust policy, vault/audit/diagnostics sinks,
and concrete business capability adapters.

# Mechanism

Redeven session metadata is authoritative only when it comes from the control
channel or the local direct-session path. Browser-provided permission or app
claims are not trusted input to plugin adapters. The current session metadata
surface contains `can_read`, `can_write`, `can_execute`, and `can_admin`;
`can_admin` gates management actions but is not part of the RWX capability
clamp. The ReDevPlugin integration derives owner/session hashes from
`session.Meta`, applies Redeven's local permission cap, caches the resolved
session by hash, and evaluates method effects against the cached host-derived
permission set.

Route ownership is role-gated. Env App origins may reach local management APIs
and Env App dist under `/_redeven_proxy/*`; codespace origins may reach only
`/_redeven_proxy/inject.js`; plugin sandbox origins are recognized by the
`plg-*` first host label and remain denied for Env App management APIs, Env App
dist, and codespace helpers. `/_redeven_proxy/api/plugins*` is delegated to
`/_redevplugin/api/plugins*` only for Env App origins. `/_redeven_plugin*` is
delegated to `/_redevplugin*` only for plugin sandbox origins. The AppServer
route role is passed to the ReDevPlugin web security adapter so the released
handler can allow only the matching route family.

Unsafe plugin management requests must reach the released ReDevPlugin handler
with a CSRF header that matches the host-derived ReDevPlugin session context.
Redeven's Env-trusted proxy derives the authoritative channel id from the Env
App origin label, or from the fixed Local UI session in Local UI mode. The
ReDevPlugin integration wrapper resolves that channel and overwrites both
`X-ReDevPlugin-Owner-Session-Hash` and `X-ReDevPlugin-CSRF` before delegation.
Env App UI code does not compute or own the token.

Plugin sandbox assets use the plugin namespace, not Env App management routes.
When the handler is mounted, AppServer rewrites plugin asset cookie paths and
`Service-Worker-Allowed` headers from ReDevPlugin's internal `/_redevplugin`
namespace to Redeven's public `/_redeven_plugin` namespace. Plugin sandbox
origins cannot inherit Env App management authority, codespace injection,
port-forward proxying, local access-gate behavior, or nested Local UI API
errors.

Official catalog discovery is not a trust bypass. Redeven's UI may show the
bundled official catalog seed, but package validation, registry writes,
lifecycle transitions, retained data behavior, and audit remain ReDevPlugin
Host responsibilities. For the current official Containers slice, Redeven
embeds one bundled `.redevplugin` package and sends it to ReDevPlugin lifecycle
install/update with `trust_state: "bundled"`. The integration trust verifier
allows bundled trust only for the exact official Containers package hash,
manifest hash, and entries hash. The browser does not fetch package URLs,
verify signatures, parse manifests, or mark an arbitrary package as trusted.

Business capability adapters such as containers begin after ReDevPlugin has
constructed the request context. The adapter receives a request that has
already passed plugin identity, lifecycle, permission, confirmation, token or
lease, quota, revoke-epoch, and audit construction. Redeven product policy may
narrow or deny a capability; it must not mint plugin tokens, grant
storage/network access, or call the business adapter outside ReDevPlugin
brokers.

The container resources v1 contract follows that boundary. Its start preflight
plan summarizes Docker and Podman runtime state without leaking raw environment
values, raw label values, raw inspect JSON, or sensitive host paths. Official
Containers must bind every container operation to `(engine, container_id)`;
dangerous confirmations and request hashes include both fields so a Docker
container cannot be confused with a Podman container that happens to share a
short id or name.

Runtime leases are capability-bearing execution context, not Redeven session
tokens. Redeven may route resulting audit events into its audit sink, but it
must not persist cleartext bearer lease tokens or bypass method/effect,
descriptor, quota, revocation, runtime-generation, or signature bindings owned
by ReDevPlugin.

# Boundaries

Redeven must not point builds, tests, release validation, examples, or
committed source at a local `../redevplugin` checkout through `go.work`,
`go.work.sum`, `replace`, local npm link/workspace/file/portal wiring, Rust
path overrides, copied source trees, or copied generated contracts.

Redeven must not implement an alternate plugin gateway token issuer, asset
ticket system, manifest parser, package validator, registry lifecycle, storage
broker, network broker, WASM executor, runtime supervisor, stream envelope, or
plugin lifecycle state machine. It must not directly edit ReDevPlugin registry
tables, package staging state, token rows, storage namespaces, runtime leases,
or revoke epochs.

Plugin surfaces and workers must not receive Desktop runtime-control tokens,
raw local direct-session artifacts, standalone Gateway bridge credentials, RCPP
provider credentials, or Flower target grants as ambient authority. Access to
Redeven business resources must always arrive through a released ReDevPlugin
request context and a Redeven-registered adapter.

# Citations

[1] redeven:AGENTS.md:256 - Redeven consumes ReDevPlugin through published artifacts only.
[2] redeven:AGENTS.md:331 - Local sibling checkout wiring and copied ReDevPlugin source are forbidden.
[3] redeven:AGENTS.md:441 - ReDevPlugin platform state remains opaque to Redeven integration code.
[4] redeven:AGENTS.md:474 - Redeven integration must not bypass plugin tokens, brokers, sandboxing, or lifecycle policy.
[5] redeven:internal/session/types.go:7 - Session metadata is delivered by the control plane and browser claims are not trusted.
[6] redeven:internal/session/types.go:22 - `can_admin` gates management actions and is not part of the RWX clamp.
[7] redeven:internal/codeapp/appserver/server.go:529 - Plugin sandbox routes are delegated only for plugin sandbox origins.
[8] redeven:internal/codeapp/appserver/server.go:537 - Plugin management routes are delegated only for Env App origins.
[9] redeven:internal/codeapp/appserver/server.go:626 - AppServer rewrites Redeven plugin routes to ReDevPlugin handler paths.
[10] redeven:internal/codeapp/appserver/server.go:6263 - `plg-*` first labels are classified as plugin sandbox origins.
[11] redeven:internal/codeapp/appserver/server_test.go:548 - Tests bind the proxy route matrix across caller roles.
[12] redeven:internal/codeapp/appserver/server_test.go:833 - Tests bind plugin-origin sandbox namespace delegation.
[13] redeven:internal/redevpluginintegration/adapters.go:85 - The session resolver projects Redeven session metadata into ReDevPlugin session context.
[14] redeven:internal/redevpluginintegration/adapters.go:272 - CSRF validation requires the resolved ReDevPlugin session context.
[15] redeven:internal/redevpluginintegration/adapters.go:1 - ReDevPlugin integration adapters own host policy and trust glue.
[16] redeven:internal/envapp/ui_src/src/ui/plugins/pluginApi.ts:1 - Plugin management API calls use `/_redeven_proxy/api/plugins*`.
[17] redeven:internal/envapp/ui_src/src/ui/plugins/officialPluginPackages.ts:1 - The bundled official Containers package is embedded with expected hashes.
[18] redeven:okf/architecture/container-resources-capability.md:1 - Container resources are a Redeven-owned Docker/Podman business capability.
