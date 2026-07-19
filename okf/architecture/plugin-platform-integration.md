---
type: Architecture Contract
title: Plugin platform integration
description: Redeven mounts ReDevPlugin v0.5.1 as a host library and adds only session, release, runtime, placement, and business adapters.
tags: [architecture, plugins, local-ui, redevplugin]
timestamp: 2026-07-19T00:00:00Z
---
# Summary

Redeven integrates ReDevPlugin `v0.5.1` through one Go
Host, one canonical HTTP namespace, one Env App `PluginPlatformClient`, one
shared surface scope, and the released Rust ProcessManager. Redeven retains
product policy and business adapters; ReDevPlugin retains platform state and
protocol ownership. Unproven session, release, capability, runtime, or surface
identity denies the operation. The integration is staged but not
releasable: v0.5.1's browser catalog GET cannot satisfy its required Origin
contract, session-scope revoke does not terminate every execution and handle,
Workbench lacks an iframe interaction ownership contract, and its ad-hoc-signed
Darwin runtime cannot retain the pinned artifact hash through the required
Redeven Developer ID signing and notarization chain.

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
ReDevPlugin `0.5.1`, Rust IPC v4, the current WASM ABI, the exact target hash,
persistent lease replay storage, and the released default limits. Missing,
non-canonical, wrong-target, or wrong-hash runtimes fail startup.

Runtime storage, connectivity, asset, handle-grant, quota, heartbeat, and
diagnostic paths remain ReDevPlugin services. Redeven does not launch an
alternate process, add hostcalls, or inspect IPC frames.

## Env App integration

Env App owns one authenticated same-origin fetch adapter, one
`PluginPlatformClient`, one shared `PluginSurfaceScope`, and one serial
placement coordinator. Catalog and lifecycle calls use generated v0.5.1 DTOs.
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

Four upstream gaps block release. Activity catalog uses GET, which carries no
Origin in a same-origin browser, while v0.5.1 validates Origin on every route.
Workbench lacks a host-neutral cross-iframe interaction callback. Session-scope
revoke removes surfaces but does not fence operations, streams, confirmations,
or surface-less handles. The Darwin runtime is linker/ad-hoc signed; Electron's
Developer ID signing must change those bytes, but the runtime manager and
formal marker correctly require the original release hash. Formal upstream
contracts and signed artifacts must fix all four;
Redeven may not add an alternate route/bridge, forge Origin, relax the guard,
or compensate with a local task registry. Session deletion must await complete
four-hash teardown.

# Boundaries

The canonical ownership rules are in [ReDevPlugin host integration boundary](redevplugin-boundary.md).
This concept owns only the concrete Redeven v0.5.1 integration shape.

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
