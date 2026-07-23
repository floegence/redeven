---
type: Architecture Contract
title: Plugin platform integration
description: Redeven mounts ReDevPlugin v0.6.7 as a host library and adds only session, release, runtime-build, placement, and business adapters.
tags: [architecture, plugins, local-ui, redevplugin]
timestamp: 2026-07-19T00:00:00Z
---
# Summary

Redeven integrates ReDevPlugin `v0.6.7` through one Go
Host, one canonical HTTP namespace, one Env App `PluginPlatformClient`, one
shared surface scope, and the released Rust ProcessManager over a verified
Redeven-built Linux runtime. Redeven retains
product policy and business adapters; ReDevPlugin retains platform state and
protocol ownership. Unproven session, release, capability, runtime, or surface
identity denies the operation. Activity placement and Linux worker execution
are releasable. Darwin omits worker execution, and Workbench placement remains
disabled until a host-neutral iframe interaction-ownership contract exists.

# Contract

## Host construction

`internal/redevpluginintegration` opens ReDevPlugin-owned registry, install
stage, observability, operation, confirmation, stream, secret, runtime replay,
asset, and plugin-data stores under the configured Redeven state root. It then
constructs the released Host with:

- session policy, direct authorization, web security, trust, audit, diagnostics,
  surface token, data, asset, operation, stream, and confirmation adapters;
- a signed official-release module;
- the released runtime ProcessManager and Host-owned connectivity/storage
  services;
- the secret store and signed Containers capability registry.

AppServer mounts the released handler without changing its path. The only
public management namespace is `/_redevplugin/api/plugins`. AppServer proves an
Env-trusted route, binds the exact trusted origin in server-only request
context, and supplies the authenticated channel id. It does not translate to a
second plugin namespace, flatten the ReDevPlugin wire contract, or serve a
parallel bootstrap path.

## Session and ownership

The session adapter derives the four active hashes from authenticated Redeven
metadata: owner session, owner user, owner environment, and channel. Owner
fields in JSON, plugin IPC, or capability arguments are never authoritative.
The same adapter backs direct Host authorization and mounted HTTP route
authorization, so bypassing HTTP does not bypass policy.

Persistent owner behavior follows ReDevPlugin resource scopes. Environment
resources bind the owner environment; user resources bind environment plus
user. Short-lived surfaces, operations, streams, handles, confirmations, and
tokens bind the full active audience. Redeven does not use short-lived audience
hashes as registry or plugin-data keys.

Before Host construction opens durable platform state, Redeven calls the
released owner-scope migration on `apps/redevplugin` and uses only its committed
active generation for databases, trust, assets, storage, and runtime execution.
Recognized `v0.6.5` state with unprovable ownership is retained in atomic
quarantine while a fresh owner-scoped generation is committed. Restart reuses
the same generation and preserves new data; it never removes quarantine.
Unknown, corrupt, ambiguous, tampered, or future state fails closed without
mutation. Floret-owned schemas are outside this lifecycle.

Session close uses the released durable four-hash coordinator. Redeven persists
the opaque close identity and proof before teardown, commits authenticated
session removal only after the platform acknowledges the complete drain, and
reconciles retained fences on restart. It never guesses an owner or maintains a
parallel task registry.

## Official release and capability

The product catalog contains one exact official identity:

- publisher `com.redeven.official`;
- plugin `com.redeven.official.containers`;
- instance `plugini_redeven_official_containers`;
- version `2.0.0`;
- surface `containers.dashboard`.

The generated UI release ref and embedded Go release bundle come from the same
signed metadata. Install and update use `installReleaseRef` and
`updateReleaseRef`; browser package bytes and trust-state requests do not
exist. Publisher, plugin, instance, version, release metadata hash, package
hashes, Ed25519 key, source policy, revocation evidence, host requirement, and
capability pin must all match.

The Containers capability adapter receives only ReDevPlugin-authorized
invocations. Synchronous reads, long operations, cancellation, and log streams
use released capability, operation, and stream envelopes. Docker/Podman access
stays in `internal/capabilities/containers`; plugin-platform mechanics do not.
One-shot CLI output is capped before parsing; crossing the cap terminates the
process group and fails rather than truncating a successful result. Stderr and
command arguments are not copied into public error text.

## Runtime integration

Redeven uses one strict, error-returning executable identity resolver for CLI
lock metadata, Agent construction, self-restart, self-upgrade, and sibling
runtime selection. It makes the path absolute and resolves every symlink;
resolution failure stops startup instead of retaining an alias. The only runtime
path is `<canonical suite executable directory>/redevplugin-runtime`.

Self-upgrade keeps three identities separate: the canonical executable in its
content-addressed suite, the stable installation/activation root, and the
activation path `<root>/redeven`. A suite executable is accepted only when the
closed relative activation link resolves back to that exact suite; a regular
root executable is the explicit pre-suite migration shape. The installer writes
the new suite at the activation root and restart executes the newly committed
activation path, so upgrades neither nest suites nor restart the old generation.
This lets the installer switch an immutable Redeven/runtime pair atomically
without mixing generations. The runtime module binds the current closed target,
ReDevPlugin `0.6.7`, the released Rust IPC and WASM ABI, the exact product-build
descriptor, persistent lease replay storage, and the released default limits.
The Linux binary is built with Rust 1.88.0 from the attested package set and
travels with SBOM, provenance, notices, and signature evidence. Missing,
non-canonical, wrong-target, unsigned, or wrong-hash runtimes fail startup.
Darwin constructs no runtime module and must contain none of those files.

Runtime storage, connectivity, asset, handle-grant, quota, heartbeat, and
diagnostic paths remain ReDevPlugin services. Redeven does not launch an
alternate process, add hostcalls, or inspect IPC frames.

## Env App integration

Env App owns one authenticated same-origin fetch adapter, one
`PluginPlatformClient`, one shared `PluginSurfaceScope`, and one serial
placement coordinator. Catalog and lifecycle calls use generated v0.6.7 DTOs.
Every mutation carries the current management revision; outcome-unknown errors
tear down affected surfaces and refresh inventory without automatic retry. The
Plugin Center mutation lane remains occupied until that local invalidation has
settled, so another command cannot race the cleanup.

The SDK-owned iframe is opened only through `openSurfaceInSlot`. The returned
Promise is the authoritative handshake and first-commit boundary. Placement
changes close and dispose the old slot before a new slot can open, so an iframe
or surface instance is never moved or reused. A Shell-owned abort-aware FIFO
queue serializes confirmation intents and rejects queued work when its surface
or scope is retired.

Browser-facing reads use released POST query routes, so exact Origin, CSRF,
closed route action, and query-effect authorization remain enforceable in a
same-origin browser. Session deletion awaits the complete released four-hash
teardown. Redeven does not add an alternate route or bridge, forge Origin,
relax the guard, or compensate with a local task registry.

Workbench still lacks a host-neutral cross-iframe interaction callback. Redeven
must not claim that placement, add an overlay, or toggle iframe pointer events.
Activity remains the supported official placement until the upstream contract
is released and conformance-tested.

# Boundaries

The canonical ownership rules are in [ReDevPlugin host integration boundary](redevplugin-boundary.md).
This concept owns only the concrete Redeven v0.6.7 integration shape.

Manifest surfaces remain `view|command|background` with semantic intent. No
Activity, Workbench, widget, settings, navigation, or product-layout fields are
added to plugin manifests.

Official catalog projection is product metadata, not registry state. Installed
items match the exact publisher/plugin/instance identity; unrelated records are
not adopted by plugin id alone.

# Evidence

- `redeven:internal/redevpluginintegration/integration.go:1` - Opens Host modules and the canonical handler.
- `redeven:internal/redevpluginintegration/session_adapter.go:1` - Derives session ownership and policy from authenticated metadata.
- `redeven:internal/redevpluginintegration/security_adapter.go:1` - Implements authenticate, origin, CSRF, and route authorization.
- `redeven:internal/redevpluginintegration/release_module.go:1` - Verifies the official release source and capability requirements.
- `redeven:internal/redevpluginintegration/runtime_module.go:1` - Configures the released runtime manager.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginPlatform.ts:1` - Owns the single UI client, fetch boundary, scope, and slot coordinator.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginApi.ts:1` - Uses generated release-ref and lifecycle APIs.
- `redeven:internal/envapp/ui_src/src/ui/plugins/officialContainersRelease.generated.ts:1` - Contains the generated signed release ref.
- `redeven:internal/codeapp/appserver/server.go:590` - Mounts the canonical plugin platform route with server-only context.
