---
type: Runtime Contract
title: Web Service system-browser authorization
description: Hand Desktop-private Web Services to a system browser without exposing the bridge credential or creating a public fallback.
tags: [architecture, desktop, local-ui, port-forward, security]
timestamp: 2026-08-30T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Runtime Local UI is the sole authority for opening a `unified_proxy` Desktop-private Web Service in a system browser. Desktop obtains a short-lived, single-use entry for the exact forward and application path; Runtime redeems it into a Host-only browser session on the existing `pf-<forward_id>.localhost:<bridge_port>` origin. The bridge header never enters the system browser, the browser credential never enters the user service, and failures open no URL. A `desktop_loopback` service is Desktop-only and never enters this handoff. There is no public Local UI fallback, `/pf/<id>` conversion, persistent session record, or alternate Runtime proxy path.

# Contract

## Mint and redemption
Only a request already admitted by the private Desktop bridge header may call the internal mint endpoint. Pending entries are memory-only, capped at 128, cleaned on access, and oldest-first evicted after expired entries are removed.

The cookie is intentionally not `Secure` because the private bridge is loopback HTTP; it carries random session authority rather than the Desktop bridge token.

## Session and proxy boundary
One current browser session exists per exact bridge authority and forward. Sessions expire after 12 hours or Runtime shutdown, remain memory-only, are capped at 256, and are cleaned or oldest-first evicted under the same bounded store.

Root-relative resources, application-owned `/pf/*` paths, same-protocol same-port redirects, HTTP query parameters, fragments, and WebSockets continue through the existing root-mounted forward without a second routing rule.

## Desktop action
Desktop derives the relative application location only from the exact private `pf-<forward_id>.localhost:<bridge_port>` route.

Local-compatibility mode disables the action and cannot silently switch access modes.

# Boundaries

The system-browser cookie authorizes one unified Web Service proxy origin; it is not a Local UI login, Flowersec artifact, Provider session, Gateway ticket, reusable Desktop credential, local-compatibility credential, or public-access mechanism. The Desktop IPC action and Runtime startup report remain unchanged.

# Evidence

- `redeven:internal/localui/desktop_browser_handoff.go:1` - Runtime owns bounded one-time entries, clean redemption, exact session replacement, expiry, and cookie admission.

- `redeven:internal/localui/localui.go:240` - The existing private bridge selects header or exact browser-session admission before the common forward backend.

- `redeven:internal/codeapp/appserver/server.go:301` - The reserved browser cookie is stripped before upstream dispatch and filtered from upstream responses.
