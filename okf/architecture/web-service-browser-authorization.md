---
type: Runtime Contract
title: Web Service system-browser authorization
description: Hand Desktop-private Web Services to a system browser without exposing the bridge credential or creating a public fallback.
tags: [architecture, desktop, local-ui, port-forward, security]
timestamp: 2026-08-30T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Runtime alone admits system-browser access to Desktop-private `unified_proxy` services. Desktop requests a short-lived single-use entry for an exact forward/path; Runtime redeems it into a Host-only session on `pf-<forward_id>.localhost:<bridge_port>`. Bridge credentials stay out of browsers and browser credentials out of services. Failure opens no URL; `desktop_loopback` is excluded.

# Contract

- Only private-bridge-header admission can mint entries. Memory-only entries cap at 128; remove expired then evict oldest. Loopback HTTP cookies intentionally omit Secure and contain independent random session authority.
- One session per bridge authority/forward expires after 12 hours or shutdown. Memory-only sessions cap at 256 with the same cleanup policy.
- Existing root-mounted forwarding preserves root-relative resources, app-owned `/pf/*`, same-protocol/port redirects, queries, fragments and WebSockets. No new routing rule is added.
- Desktop derives relative paths only from that exact private origin. Local compatibility disables browser handoff and cannot switch mode.

# Boundaries

The cookie admits one proxy origin, never Local UI, Provider/Gateway, Flowersec artifacts or other Desktop credentials. No public fallback, `/pf/<id>` conversion, durable session or alternate proxy is allowed; IPC/startup-report contracts remain unchanged.

# Evidence

- `redeven:internal/localui/desktop_browser_handoff.go:1` - Runtime owns bounded one-time entries, clean redemption, exact session replacement, expiry, and cookie admission.

- `redeven:internal/localui/localui.go:240` - The existing private bridge selects header or exact browser-session admission before the common forward backend.

- `redeven:internal/codeapp/appserver/server.go:301` - The reserved browser cookie is stripped before upstream dispatch and filtered from upstream responses.
