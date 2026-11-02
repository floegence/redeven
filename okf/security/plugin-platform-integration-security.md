---
type: Security Contract
title: Plugin platform integration security
tags: [security, plugins, permissions, local-ui]
quality_exception: Cross-domain plugin security contract spanning authenticated identity, package provenance, execution, updates, routes, runtime isolation, and capability authority.
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

ReDevPlugin receives authenticated host identity/source policy, never browser-claimed ownership/trust. HTTP checks auth, origin, CSRF and closed-action policy; direct calls check owner/action/resource. Package provenance, signature, execution approval, update eligibility and permission are independent. Integrity, runtime identity or scope mismatch fails closed.

# Contract

## Local process boundary
The `process.local` permission is an explicit high-risk grant and method-level Process Broker access is checked again for every Worker invocation. The Host does not inherit the complete Redeven environment and never injects session cookies, plugin tokens, or Host credentials.

See [Plugin process sessions](../architecture/plugin-process-sessions.md) for the lifecycle contract.

## Authenticated session boundary
The session resolver accepts only a Redeven channel id whose stored metadata has exact non-empty channel, user, and environment identities.

The bounded session cache is keyed by owner-session hash and accepts a hit only when all four hashes match.

Guessed owner sweeps and local teardown registries are prohibited.

## HTTP and direct authorization
The canonical route is `/_redevplugin/api/plugins`.

Method effect is resolved before local policy clamps it, while shared runtime management remains admin-only.

## Permission management projection
Plugin Center reads active grants and explicit plugin security policies through released ReDevPlugin APIs. It never writes registry tables, invents a default grant for a catalog plugin, or treats catalog identity as permission.

Its actual trust badge remains unchanged; only verified catalog trust may receive the `Official` trust badge.

## Package admission and trust
The retained release install/update path accepts only the exact source policy, revocation evidence, publisher, plugin, version, signed release metadata, package hashes, and Host requirement. Browser-supplied trust state, arbitrary package bytes, rollback, unknown publishers, invalid or revoked signatures, and invented fetch provenance are denied.

Redeven does not add a new authorization workflow; the existing official release-ref verification remains unchanged.

## Network routing and authorization

A VPN, configured proxy or enterprise DNS answer is routing policy, not evidence
that a user request is malicious. Host package downloads use normal host routing
while retaining upstream source, redirect and integrity validation. Authorized
HTTPS hostname connectors use the released host transport contract after grant
checks. This does not grant undeclared destinations or methods, bypass private
prefix bindings, or expose ambient host/session credentials.

Proxy discovery failures, timeouts and TLS failures reject only the affected
operation. Construction performs no network discovery, and plugin readiness does
not gate core Runtime readiness. Certificate validation stays enabled. Proxy
credentials apply only to the proxy hop; application writes with unknown outcomes
are not retried automatically.

## Capability confirmation plans
ReDevPlugin validates a capability preflight result against the Host-known capability response schema before it becomes a confirmation plan. Values in the reserved `redevplugin.capability.risk_plan.*` namespace must match the strict v1 risk-plan contract; an unknown or malformed reserved version fails closed instead of falling back to a generic object.

Replacing or replaying any of those values requires a new confirmation.

## Runtime trust
Runtime descriptors bind version, target, IPC, WASM ABI, and artifact hash. Darwin release bytes receive their Developer ID signature before the product digest and Sigstore evidence, and later Desktop signing must preserve that exact nested executable. Startup must not hash the field binary and accept that value as its own trust anchor.

## Business adapter and observability boundary
Plugin business adapters are invoked only after ReDevPlugin resolves lifecycle, permission, confirmation, lease, quota, revocation, and audit context. Product code cannot bypass that chain.

Raw adapter errors, tokens, secrets, cookies, query strings, absolute paths, and complete URLs are not copied into public or durable diagnostic detail.

## Plugin Web isolation

Plugin documents use a distinct product-allocated origin and the published Web surface handler. Local UI and AppServer strip parent authentication before delegating child traffic. Desktop verifies the actual requesting frame origin before attaching private bridge credentials. For frame-less worker requests, it verifies Electron's browser-reported initiator origin within the owning Runtime partition against the same exact private origin. Missing or opaque origins fail closed; a present frame remains authoritative, and worker requests never receive frame-only host-access or Tessiven source claims. Center binds child routes to an authenticated parent and cancels derived preparation on revocation; Gateway accepts only the expected child namespace and target.

The application owns its DOM and browser rendering. These freedoms do not grant product session, filesystem, process, credential or management authority. The released platform remains responsible for asset sessions, bridge binding, permissions and revocation.

Main-process `session.fetch` requests also pass through Electron's request hook. A contextless `other` request may retain authorization only when it already carries exactly one matching private bridge token from the owning Runtime session and has no frame, WebContents owner or initiator origin. Missing provenance alone grants nothing. Destination checks still bind the exact private origin; renderer and worker provenance remains authoritative, and frame-only claims are never inherited.

# Boundaries

Desktop runtime-control tokens, direct-session artifacts, Gateway credentials, RCPP credentials, and Flower grants are not plugin ambient authority.

Redeven security adapters may narrow authority; they may not mint platform tokens, weaken route policy, edit opaque state, or replace released brokers.

# Evidence

- `redeven:internal/redevpluginintegration/session_adapter.go:1` - Derives exact owner hashes and bounded permission cache entries.

- `redeven:internal/redevpluginintegration/adapters_test.go:1` - Covers origin, CSRF, session, and action denial.

- `redeven:desktop/src/main/desktopSessionTransport.test.ts` - Exact worker/frame origin authority and plugin/unknown denial.

- `redeven:desktop/scripts/check-tessiven-workers.mjs` - Electron nested ELK auth failure reproduced; protected cold render/zoom/reload verified.

- `redeven:desktop/scripts/fixtures/codespace-bridge-session.ts` - Real Electron main fetch and native route use the production request policy; native qualification checks authenticated and denied requests.
