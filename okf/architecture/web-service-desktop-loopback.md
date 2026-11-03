---
type: Runtime Contract
title: Desktop loopback Web Service access
tags: [architecture, desktop, port-forward, proxy, security]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Desktop loopback allocates random HTTP127.0.0.1 origin per Environment/forward; all traffic still uses protected Runtime route. Never dial directly, change interfaces/apps or fall back to unified proxy. Closing owner window/Environment removes gateway and authority.

# Contract

- Persisted `port_forwards.access_mode` alone selects mode. System browsers cannot receive Electron credentials, private `pf-*` substitutions or newly minted unified sessions.
- Bind only `127.0.0.1:0`. Native/placement bridges use canonical numeric-loopback plus exact `/pf/<forward_id>/`; remote routes retain their authorized `pf-*` authority. Keep streaming/oversized replies streaming, not buffered for optional rewriting.
- Each gateway has an independent random credential. [Managed opening](managed-web-service-opening.md) owns explicit reprepare; failed authentication cannot change mode or dial directly.

# Boundaries

Compatibility origin is not direct access, RBI, public listening, Local UI login or application authentication. Random credentials block ambient browser use but do not make loopback a cross-user security boundary.

# Evidence

- `redeven:internal/portforward/registry/schema.go` - Source.
- `redeven:desktop/src/main/navigation.ts:256` - Source.
