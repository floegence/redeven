---
type: Frontend Transport Contract
title: Env App connection and recovery
description: Compose published Floe and Flowersec artifact sources, Service Worker control, and reconnect recovery without a product retry loop.
tags: [architecture, env-app, transport, recovery]
timestamp: 2026-10-07T00:00:00Z
---
# Summary

Env App uses Floe's published artifact-source and connection-controller contracts for public HTTPS, explicit HTTP, remote controlplane, and Desktop-private loopback paths. It binds each source to the current origin and environment, requires exact Service Worker control, and projects Flowersec diagnostics into one immutable recovery snapshot without replaying requests or inventing retry policy.

# Contract

Runtime reconnect configuration uses Flowersec's discriminated artifact-source contract directly. Public HTTPS and remote controlplane paths use Floe Webapp's `createControlplaneArtifactSource`; explicit public HTTP uses `createHTTPDirectControlplaneArtifactSource` and `createHTTPDirectConnectionConfig`. An explicitly marked Desktop document uses `createPrivateLoopbackControlplaneArtifactSource` and `createPrivateLoopbackDirectConnectionConfig`. All paths reuse the same Floe acquisition envelope, durable spend, snapshot, retry, replacement, and disposal lifecycle; no fixed artifact is reused or given an auto-reconnect escape path. Local UI binds acquisition and spend to the current origin and validates the exact `env_local` target. Remote entry-ticket exchange preserves abort, trace, and current environment binding. HTTPS requires actual client trust in the exported CA. Private numeric-loopback HTTP requires `desktop_private_bridge_v2`; main retains the bridge token and projects only that provenance. Neither a failed TLS connection nor missing private authorization selects public HTTP. The [Local UI network exposure](../security/local-ui-network-exposure.md) contract owns protocol choice and same-port composition.

Controlplane adapters preserve HTTP authorization and availability status across entry-ticket acquisition. Portal's uppercase API codes are mapped to Floe's lowercase HTTP classifier; Floe then emits only Flowersec's canonical source failure codes while retaining terminal, retryable, and Retry-After authority. Gateway outages, rate limiting, and network failures reuse the existing controller; rejected authorization and invalid acquisition envelopes remain terminal. No response body, ticket, or account credential is exposed as a controller diagnostic. Background version metadata cannot initiate workspace navigation or session renewal when its sandbox cookie expires; the secure connection acquisition remains the recovery owner.

Floe Core's published `secureRandomUUID` uses cryptographically secure random bytes in ordinary HTTP contexts. Redeven SHA-256 consumers use the standard `@noble/hashes` implementation without reducing integrity checks. ReDevPlugin v3.0.33 owns the same HTTP-compatible integrity and plugin-handshake support, and Floeterm v0.19.2 owns HTTP-compatible terminal history hashing. Clipboard commands use the shared copy helper and its browser copy-event fallback. System features that require secure contexts remain subject to browser policy.

Env App constructs one stable reconnect config for each transport mode so hard reconnects preserve Flowersec trace and source-consumption state. Before remote acquisition it establishes exact `/_redeven_sw.js` Service Worker control at scope `/`; failure stops bootstrap. One released Floe `ProxyBootstrapOwner` owns the runtime generation, and its Redeven adapter refuses any other script, scope, or uncontrolled page. Public Local Direct and remote Tunnel require TLS; Desktop-private Direct requires exact loopback provenance and the isolated private profile. All retain the published Flowersec liveness policy. Retry timing and latest connection state come from `retryDisposition` and `connectionDiagnostic`; Redeven does not parse error strings or run another Controller loop.

After an already opened Env App loses connectivity, Redeven projects published Flowersec `onDiagnosticEvent` reconnect events into one immutable product recovery snapshot. The `reconnect` stage, event code, result, and monotonic `attempt_seq` are the source for fast-reconnect attempts; Redeven does not recreate Flowersec's retry loop. Runtime availability probes return structured availability, access state, failure code, and HTTP status, and error classification uses only those fields and error types rather than message fragments. A Desktop-hosted session also subscribes to its sender-scoped transport-recovery snapshot. While that bridge is `waiting`, `connecting`, or terminally `failed`, Env App pauses its own Runtime probe loop; a recovered bridge advances directly to protocol reconnect. Generation and revision checks discard stale Desktop updates, and no layer replays the request that observed the disconnect.


# Boundaries

Floe and Flowersec own acquisition, retry timing, source consumption, protocol framing, and connection replacement. Redeven may select a published profile and map product authorization, but it must not parse error prose, add a fallback URL, start a second controller loop, bypass TLS or private bridge provenance, or let background metadata renew a session. Desktop bridge snapshots are observed by generation and revision; they never become a second transport.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/services/controlplaneApi.ts:501` - Maps local and remote acquisition into the published source.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:542` - Enforces Service Worker script, scope, control, and runtime generation.
- `redeven:internal/envapp/ui_src/src/ui/reconnect/createRuntimeReconnectController.ts:429` - Projects structured reconnect events without product retry heuristics.
- `redeven:internal/envapp/ui_src/src/ui/services/desktopSessionContext.ts:215` - Rejects stale Desktop recovery generations and revisions.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:2490` - Replaces the protocol connection atomically through the published controller.
