---
type: Security Contract
title: Plugin platform integration security
description: Redeven derives ReDevPlugin identity from authenticated sessions and fail-closed signed release, route, runtime, and capability adapters.
tags: [security, plugins, permissions, local-ui]
timestamp: 2026-07-19T00:00:00Z
---
# Summary

Redeven supplies authenticated host facts to ReDevPlugin; it does not accept
plugin ownership, authority, or trust from browser payloads. Every HTTP route
passes explicit authentication, origin, CSRF, and closed-action authorization.
Direct Host calls pass the same owner/action/resource policy. Signed release,
runtime, secret, storage, network, and capability scope mismatches fail closed.

# Contract

## Authenticated session boundary

The session resolver accepts only a Redeven channel id whose stored metadata
has exact non-empty channel, user, and environment identities. It derives:

- `owner_session_hash` from the active channel;
- `owner_user_hash` from the authenticated user;
- `owner_env_hash` from the environment endpoint;
- `session_channel_id_hash` from the active channel.

The resolver also intersects session RWX facts with Redeven's local permission
cap and carries admin separately for management. The bounded session cache is
keyed by owner-session hash and accepts a hit only when all four hashes match.
JSON, query, plugin IPC, release metadata, and capability arguments cannot
override any owner field.

Persistent registry, policy, permission, settings, data, secret, connector, and
worker ownership follows ReDevPlugin `user` or `environment` resource scope.
Short-lived surfaces, handles, confirmations, operations, streams, and token
audiences bind all four active hashes. Unknown legacy ownership is not guessed.

Binding is not yet equivalent to complete teardown in v0.5.1. Its surface-scope
revoke does not atomically fence or cancel every exact-scope operation, stream,
confirmation, and surface-less handle grant. A disconnected session can
therefore retain short-lived authority or asynchronous work. This blocks
release until ReDevPlugin supplies indexed four-hash teardown and Redeven can
await it before removing the authenticated session. A Redeven-local task map,
timer, or guessed owner sweep is prohibited.

## HTTP and direct authorization

The canonical route is `/_redevplugin/api/plugins`. AppServer delegates it only
from an Env App or Local UI Env route after local access checks. It attaches the
authenticated channel id and a validated same-origin value in server-only
request context. Codespace, port-forward, plugin, unknown, null-origin, and
missing-origin callers are not delegated.

The released handler then invokes four explicit steps:

1. `Authenticate` resolves the host session.
2. `ValidateOrigin` requires one exact non-null Origin equal to the server-bound
   trusted origin.
3. `ValidateCSRF` requires the exact `X-ReDevPlugin-CSRF` proof on every route
   whose released policy marks it required, including unsafe reads.
4. `AuthorizeRoute` accepts only a valid closed `RouteAction` permitted by the
   cached session.

This closed policy exposes a v0.5.1 browser contract mismatch. The generated
catalog method is a same-origin GET, and Chromium does not send Origin for that
request. JavaScript cannot set the forbidden Origin header. Therefore Activity
inventory fails closed even with a valid CSRF proof. Redeven must not accept
Referer or Fetch Metadata as an undocumented substitute, inject Origin, or
exempt catalog locally. A new formal ReDevPlugin contract and release must
define a browser-executable request whose origin policy remains explicit and
conformance-tested.

The Host `AuthorizationAdapter` separately checks action, canonical resource,
owner context, and permissions for direct Go calls. An absent or typed-nil Host,
guard, authorization adapter, or container engine client fails construction
before persistent state is opened. Method, confirmation, intent, and owned
operation-cancel actions admit any authenticated data-plane permission at the
early action gate; the resolved method effect is then clamped by
`EvaluateLocalPolicy`. This avoids inventing an execute requirement for read or
write methods. Shared runtime start, stop, and refresh remain admin-only.

## Release and runtime trust

Official install/update is release-ref based. Redeven's release module accepts
only the exact official source, publisher, plugin, version, key, signed release
metadata, package hashes, signed revocation metadata, host requirement, and
capability contract pin. Unsigned input, browser-supplied trust state, arbitrary
package bytes, downgrade, unknown publisher, expired revocation evidence, and
invented fetch provenance are denied.

The runtime path and current target are closed. Runtime descriptors bind version,
target, Rust IPC version, WASM ABI, and exact artifact SHA-256. Handle grants
bind plugin instance, active fingerprint, runtime generation/shard, all owner
hashes, method, handle, resource scope, policy revision, management revision,
and revoke epoch. Storage/network scope from a plugin cannot replace the
lease-derived scope.

Darwin code signing cannot become a downstream exception to that identity.
The current upstream runtime is linker/ad-hoc signed, while Redeven Desktop must
Developer-ID sign nested executables before notarization. Re-signing changes the
pinned bytes; skipping signing leaves an unproven nested executable. Both paths
fail closed until an upstream release defines and ships the compatible signed
artifact contract.

## Business adapter and observability boundary

Containers is invoked only after ReDevPlugin resolves lifecycle, permission,
confirmation, token/lease, quota, revocation, and audit context. Container
identity is `(engine, container_id)` for lookup, confirmation, operation, and
stream behavior. Redeven product code cannot call the adapter as a substitute
for the platform authorization chain. CLI stdout is bounded before parsing;
overflow terminates the command process group and returns a stable failure.
CLI failures never parse localized stderr to guess resource identity. A typed
engine adapter may report an exact not-found target; the CLI adapter maps only
the deterministic logs operation class and otherwise returns a generic stable
failure. Stderr and argv are never copied into adapter errors. Operation and
stream terminal writes use an independent finite
deadline, so integration close cannot wait forever on a canceled request's
terminal sink. A truncated payload is never accepted as success.

Audit, diagnostics, and public errors record stable component, operation,
failure code, correlation/request identity, and mutation outcome. Raw adapter
errors, tokens, secrets, cookies, query strings, absolute paths, and complete
URLs are not copied into public or durable diagnostic detail.

# Boundaries

Desktop runtime-control tokens, direct-session artifacts, Gateway credentials,
RCPP credentials, and Flower grants are not plugin ambient authority. A plugin
gets business access only through a released ReDevPlugin request context.

The platform boundary is defined by [ReDevPlugin host integration boundary](../architecture/redevplugin-boundary.md).
Redeven security adapters may narrow authority; they may not mint platform
tokens, weaken route policy, edit opaque state, or replace released brokers.

# Evidence

- `redeven:internal/redevpluginintegration/session_adapter.go:1` - Derives exact owner hashes and bounded permission cache entries.
- `redeven:internal/redevpluginintegration/security_adapter.go:1` - Implements the four-step web security contract.
- `redeven:internal/redevpluginintegration/adapters_test.go:1` - Covers origin, CSRF, session, and action denial.
- `redeven:internal/redevpluginintegration/release_module.go:1` - Enforces official source, signature, revocation, and capability pins.
- `redeven:internal/redevpluginintegration/runtime_module.go:1` - Binds runtime target, hash, IPC, ABI, leases, and Host services.
- `redeven:internal/redevpluginintegration/containers_capability.go:1` - Adapts authorized capability invocations to domain behavior.
- `redeven:internal/codeapp/appserver/server_test.go:810` - Covers canonical route reservation and origin delegation.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginPlatform.ts:1` - Restricts UI transport to the canonical same-origin namespace and attaches CSRF proof.
