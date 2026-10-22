---
type: Security Contract
title: Plugin platform integration security
description: Redeven derives ReDevPlugin identity from authenticated sessions and keeps package source, signature, execution, update, route, runtime, and capability authority distinct.
tags: [security, plugins, permissions, local-ui]
timestamp: 2026-07-25T00:00:00Z
quality_exception: Cross-domain plugin security contract spanning authenticated identity, package provenance, execution, updates, routes, runtime isolation, and capability authority.
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven supplies authenticated host facts and source policy to ReDevPlugin; it
does not accept plugin ownership, authority, provenance, or trust from browser
payloads. Every HTTP route passes explicit authentication, origin, CSRF, and
closed-action authorization, and direct Host calls pass the same owner/action/
resource policy. External package source, signature, execution approval, update
eligibility, and permission are independent facts. Integrity failures, invalid
runtime identity, and capability scope mismatches fail closed.

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

## Capability confirmation plans
ReDevPlugin validates a capability preflight result against the Host-known capability response schema before it becomes a confirmation plan. Values in the reserved `redevplugin.capability.risk_plan.*` namespace must match the strict v1 risk-plan contract; an unknown or malformed reserved version fails closed instead of falling back to a generic object.

Replacing or replaying any of those values requires a new confirmation.

## Runtime trust
Runtime descriptors bind version, target, IPC, WASM ABI, and artifact hash. Darwin release bytes receive their Developer ID signature before the product digest and Sigstore evidence, and later Desktop signing must preserve that exact nested executable. Startup must not hash the field binary and accept that value as its own trust anchor.

## Business adapter and observability boundary
Plugin business adapters are invoked only after ReDevPlugin resolves lifecycle, permission, confirmation, lease, quota, revocation, and audit context. Product code cannot bypass that chain.

Raw adapter errors, tokens, secrets, cookies, query strings, absolute paths, and complete URLs are not copied into public or durable diagnostic detail.

# Boundaries

Desktop runtime-control tokens, direct-session artifacts, Gateway credentials, RCPP credentials, and Flower grants are not plugin ambient authority.

Redeven security adapters may narrow authority; they may not mint platform tokens, weaken route policy, edit opaque state, or replace released brokers.

# Evidence

- `redeven:internal/redevpluginintegration/session_adapter.go:1` - Derives exact owner hashes and bounded permission cache entries.

- `redeven:internal/redevpluginintegration/security_adapter.go:1` - Implements the four-step web security contract.

- `redeven:internal/redevpluginintegration/adapters_test.go:1` - Covers origin, CSRF, session, and action denial.
