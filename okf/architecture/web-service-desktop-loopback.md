---
type: Runtime Contract
title: Desktop loopback Web Service access
description: Give one HTTP Web Service an isolated numeric-loopback browser Origin without bypassing its protected Runtime route.
tags: [architecture, desktop, port-forward, proxy, security]
timestamp: 2026-09-22T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Desktop-only `desktop_loopback` gives one Environment session/forward a random `http://127.0.0.1:<port>` origin while every request follows its protected Runtime route. It never connects directly, changes interfaces, modifies applications or falls back to unified proxy. Closing the owning window/Environment removes the gateway and authority.

# Contract

- Persisted `port_forwards.access_mode` alone selects mode. System browsers cannot receive Electron credentials, private `pf-*` substitutions or newly minted unified sessions.
- Bind only `127.0.0.1:0`. Native/placement bridges use canonical numeric-loopback plus exact `/pf/<forward_id>/`; remote routes retain their authorized `pf-*` authority. Keep streaming/oversized replies streaming, not buffered for optional rewriting.
- Each gateway has an independent random credential. [Managed opening](managed-web-service-opening.md) owns explicit reprepare; failed authentication cannot change mode or dial directly.

# Boundaries

Compatibility origin is not direct access, RBI, public listening, Local UI login or application authentication. Random credentials block ambient browser use but do not make loopback a cross-user security boundary.

# Evidence

- `redeven:internal/portforward/registry/schema.go` - The fresh Registry baseline persists one constrained access mode and route-safe forward identity.

- `redeven:desktop/src/main/navigation.ts:256` - Navigation maps only the exact HTTP target scope and supported loopback aliases into the assigned gateway Origin.
