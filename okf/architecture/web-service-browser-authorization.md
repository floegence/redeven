---
type: Runtime Contract
title: Web Service system-browser authorization
tags: [architecture, desktop, local-ui, port-forward, security]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Runtime alone admits browser access to Desktop-private unified_proxy services. Single-use exact-forward/path entries become Host-only pf-<id>.localhost sessions. Keep bridge/browser/service credentials separate; failed admission opens nothing and desktop_loopback is excluded.

# Contract

- Only private-bridge-header admission can mint entries. Memory-only entries cap at 128; remove expired then evict oldest. Loopback HTTP cookies intentionally omit Secure and contain independent random session authority.
- One session per bridge authority/forward expires after 12 hours or shutdown. Memory-only sessions cap at 256 with the same cleanup policy.
- Existing root-mounted forwarding preserves root-relative resources, app-owned `/pf/*`, same-protocol/port redirects, queries, fragments and WebSockets. No new routing rule is added.
- Desktop derives relative paths only from that exact private origin. Local compatibility disables browser handoff and cannot switch mode.

# Boundaries

The cookie admits one proxy origin, never Local UI, Provider/Gateway, Flowersec artifacts or other Desktop credentials. No public fallback, `/pf/<id>` conversion, durable session or alternate proxy is allowed; IPC/startup-report contracts remain unchanged.

# Evidence

- `redeven:internal/localui/desktop_browser_handoff.go:1` - Source.
- `redeven:internal/codeapp/appserver/server.go:301` - Source.
