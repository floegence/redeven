---
type: Frontend Transport Contract
title: Env App connection and recovery
tags: [architecture, env-app, transport, recovery]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Env App binds published Floe artifact/connection contracts to exact origin/environment across HTTPS, explicit HTTP, Cloud and Desktop-private loopback. Require matching Service Worker control; Flowersec diagnostics form one immutable recovery view without replay or invented retry policy.

# Contract

Runtime reconnect configuration uses Flowersec's discriminated artifact-source contract directly.

Portal's uppercase API codes are mapped to Floe's lowercase HTTP classifier; Floe then emits only Flowersec's canonical source failure codes while retaining terminal, retryable, and Retry-After authority.

Generation and revision checks discard stale Desktop updates, and no layer replays the request that observed the disconnect.

# Boundaries

Floe and Flowersec own acquisition, retry timing, source consumption, protocol framing, and connection replacement. Redeven may select a published profile and map product authorization, but it must not parse error prose, add a fallback URL, start a second controller loop, bypass TLS or private bridge provenance, or let background metadata renew a session. Desktop bridge snapshots are observed by generation and revision; they never become a second transport.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/services/controlplaneApi.ts:501` - Source.
- `redeven:internal/envapp/ui_src/src/ui/reconnect/createRuntimeReconnectController.ts:429` - Source.
