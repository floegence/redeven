---
type: Frontend Transport Contract
title: Env App connection and recovery
description: Compose published Floe and Flowersec artifact sources, Service Worker control, and reconnect recovery without a product retry loop.
tags: [architecture, env-app, transport, recovery]
timestamp: 2026-10-07T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Env App uses Floe's published artifact-source and connection-controller contracts for public HTTPS, explicit HTTP, remote controlplane, and Desktop-private loopback paths. It binds each source to the current origin and environment, requires exact Service Worker control, and projects Flowersec diagnostics into one immutable recovery snapshot without replaying requests or inventing retry policy.

# Contract

Runtime reconnect configuration uses Flowersec's discriminated artifact-source contract directly.

Portal's uppercase API codes are mapped to Floe's lowercase HTTP classifier; Floe then emits only Flowersec's canonical source failure codes while retaining terminal, retryable, and Retry-After authority.

Generation and revision checks discard stale Desktop updates, and no layer replays the request that observed the disconnect.

# Boundaries

Floe and Flowersec own acquisition, retry timing, source consumption, protocol framing, and connection replacement. Redeven may select a published profile and map product authorization, but it must not parse error prose, add a fallback URL, start a second controller loop, bypass TLS or private bridge provenance, or let background metadata renew a session. Desktop bridge snapshots are observed by generation and revision; they never become a second transport.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/services/controlplaneApi.ts:501` - Maps local and remote acquisition into the published source.

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:542` - Enforces Service Worker script, scope, control, and runtime generation.

- `redeven:internal/envapp/ui_src/src/ui/reconnect/createRuntimeReconnectController.ts:429` - Projects structured reconnect events without product retry heuristics.
