---
type: Runtime Contract
title: Web service browser routing and authorization
tags: [architecture, desktop, port-forward, security, ui]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Registry access mode selects protected unified proxy or Desktop loopback; current Environment/forward authority governs every handoff. Backend normalization accepts `3000`, `:3000` and absolute/scheme-less HTTP(S) with exact `localhost`, numeric `127.0.0.0/8` or `::1`. Renderer checks are feedback only.

# Contract

## Browser sessions
- Browser Local UI unified access uses `/pf/<forward_id>/...`; remote sessions use authorized `pf-<forward_id>` origin and one-time entry. [Loopback access](#desktop-loopback) and [Desktop windows](../desktop/web-service-browser-window.md) own Desktop presentation.
- [Operation progress](managed-service-operation-progress.md) owns per-service feedback. Managed services open through their verified `open-session` result.

## System browser authorization
- Only private-bridge-header admission can mint entries. Memory-only entries cap at 128; remove expired then evict oldest. Loopback HTTP cookies intentionally omit Secure and contain independent random session authority.
- One session per bridge authority/forward expires after 12 hours or shutdown. Memory-only sessions cap at 256 with the same cleanup policy.
- Existing root-mounted forwarding preserves root-relative resources, app-owned `/pf/*`, same-protocol/port redirects, queries, fragments and WebSockets. No new routing rule is added.
- Desktop derives relative paths only from that exact private origin. Local compatibility disables browser handoff and cannot switch mode.

## Desktop loopback
- Persisted `port_forwards.access_mode` alone selects mode. System browsers cannot receive Electron credentials, private `pf-*` substitutions or newly minted unified sessions.
- Bind only `127.0.0.1:0`. Native/placement bridges use canonical numeric-loopback plus exact `/pf/<forward_id>/`; remote routes retain their authorized `pf-*` authority. Keep streaming/oversized replies streaming, not buffered for optional rewriting.
- Each gateway has an independent random credential. [Managed opening](managed-web-service-opening.md) owns explicit reprepare; failed authentication cannot change mode or dial directly.

# Boundaries

[Web Center](web-environment-center.md) opens services/editor on resource-specific sibling origins. Parent Runtime credentials stay in the server; child browsers cannot invoke Env APIs. Editor admission pins its running instance and authenticated Runtime frame policy permits its same-origin worker iframe.

Temporary forwards are memory-only until Save; expired/unknown identities cannot be recreated from request fields. Browser-only Env App retains its popup route; no direct-target fallback or device heuristic changes registry authority.

The cookie admits one proxy origin, never Local UI, Provider/Gateway, Flowersec artifacts or other Desktop credentials. No public fallback, `/pf/<id>` conversion, durable session or alternate proxy is allowed; IPC/startup-report contracts remain unchanged.

Compatibility origin is not direct access, RBI, public listening, Local UI login or application authentication. Random credentials block ambient browser use but do not make loopback a cross-user security boundary.

# Evidence

- `redeven:internal/portforward/service.go` - Source.
