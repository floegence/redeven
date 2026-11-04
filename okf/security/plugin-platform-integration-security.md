---
type: Security Contract
title: Plugin platform integration security
tags: [security, plugins, permissions, local-ui]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

ReDevPlugin accepts authenticated host identity and source policy, never browser-claimed trust. HTTP checks auth/origin/CSRF/action; direct calls check owner/action/resource. Provenance, signatures, execution approval, update eligibility and permissions remain independent and fail closed on identity or scope mismatch.

# Contract

## Sessions and permissions
process.local is an explicit high-risk grant, rechecked by method on every Worker Process Broker call. Hosts inherit neither the complete Redeven environment nor session cookies/plugin tokens/credentials. [Process sessions](../architecture/plugin-process-sessions.md) owns lifecycle.

Resolve only stored channel metadata with exact nonempty channel/user/environment identities. Cache by owner-session hash; all four hashes must match. No guessed owner sweeps or local teardown registries.

Canonical HTTP route: /_redevplugin/api/plugins. Resolve method effects before local policy clamps; shared runtime management stays admin-only. Plugin Center reads grants and explicit policies via released APIs, never registry writes/default catalog grants. Catalog identity is not permission; only verified catalog trust receives Official, without changing actual trust badges.

## Package and network admission
Install/update requires exact source policy, revocation evidence, publisher/plugin/version, signed release metadata, package hashes and Host requirement. Reject browser trust, arbitrary bytes, rollback, unknown publishers, invalid/revoked signatures and fabricated provenance. Retain existing official release-ref verification; add no authorization workflow.

VPN/proxy/enterprise DNS is routing, not evidence of malice. Package downloads retain source/redirect/integrity checks through normal host routing. Authorized HTTPS connectors use released transport after grants; routing grants no extra destinations/methods, private-prefix bypass or ambient credentials. Proxy discovery/timeouts/TLS failures reject only their operation. Construction performs no discovery; plugin readiness cannot gate core Runtime. Keep TLS validation; proxy credentials stay on that hop. Never retry writes with unknown outcomes.

## Confirmation and runtime trust
Validate capability preflight against the Host-known response schema before confirmation. Reserved redevplugin.capability.risk_plan.* values must satisfy strict v1: reject unknown/malformed reserved versions without generic fallback. Replacement/replay needs new confirmation.

Descriptors bind version/target/IPC/WASM ABI/artifact hash. Darwin Developer ID signing precedes product digest/Sigstore evidence; Desktop signing preserves those nested bytes. Startup cannot trust a digest computed from its own field binary.

Business adapters run only after platform lifecycle/permission/confirmation/lease/quota/revocation/audit resolution. Never expose raw errors, tokens/secrets/cookies/query strings/absolute paths/full URLs in public or durable diagnostics.

## Web isolation
Plugin documents use distinct product origins and the published surface handler. Local UI/AppServer strip parent auth before delegation. Desktop binds private bridge credentials to actual frame origin. Frame-less workers instead require Electron's initiator origin in the owning Runtime partition, matching the exact private origin; missing/opaque origins fail. Present frames remain authoritative. Workers inherit no frame-only host-access/Tessiven claims. Center binds child routes to authenticated parents and cancels preparation on revocation; Gateway checks expected namespace/target.

Plugin DOM/rendering freedom grants no product-session/filesystem/process/credential/management authority. Released platform owns asset sessions/bridge/permissions/revocation.

Main-process session.fetch also enters Electron's hook. Contextless other requests retain authorization only with exactly one already-present matching private bridge token from the owning Runtime session and no frame/WebContents/initiator. Missing provenance grants nothing; destination must still be the exact private origin. Renderer/worker provenance remains authoritative; never inherit frame-only claims.

# Boundaries

Desktop control tokens, direct sessions, Gateway/RCPP credentials and Flower grants are not ambient plugin authority. Redeven adapters may narrow authority, never mint platform tokens, weaken routes, edit opaque state or replace released brokers.

# Evidence

- `redeven:internal/redevpluginintegration/session_adapter.go:1` - Source.
- `redeven:internal/redevpluginintegration/adapters_test.go:1` - Tests.
- `redeven:desktop/src/main/desktopSessionTransport.test.ts` - Tests.
- `redeven:desktop/scripts/check-tessiven-workers.mjs` - Tests.
- `redeven:desktop/scripts/fixtures/codespace-bridge-session.ts`: real Electron main fetch/native routes use production policy; native qualification checks allowed and denied requests.
