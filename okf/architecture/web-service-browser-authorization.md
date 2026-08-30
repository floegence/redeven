---
type: Runtime Contract
title: Web Service system-browser authorization
description: Hand Desktop-private Web Services to a system browser without exposing the bridge credential or creating a public fallback.
tags: [architecture, desktop, local-ui, port-forward, security]
timestamp: 2026-08-30T00:00:00Z
---
# Summary

Runtime Local UI is the sole authority for opening a `unified_proxy` Desktop-private Web Service in a system browser. Desktop obtains a short-lived, single-use entry for the exact forward and application path; Runtime redeems it into a Host-only browser session on the existing `pf-<forward_id>.localhost:<bridge_port>` origin. The bridge header never enters the system browser, the browser credential never enters the user service, and failures open no URL. A `desktop_loopback` service is Desktop-only and never enters this handoff. There is no public Local UI fallback, `/pf/<id>` conversion, persistent session record, or alternate Runtime proxy path.

# Contract

## Mint and redemption

Only a request already admitted by the private Desktop bridge header may call the internal mint endpoint. It supplies one DNS-safe `forward_id` and a relative application path. Runtime rejects absolute URLs, credentials, network-path references, oversized input, malformed JSON, and the reserved handoff query name. A successful mint creates 256 bits of random authority, binds it to the current loopback bridge authority, forward, exact entry path, and 60-second expiry, and returns an HTTP URL on `pf-<forward_id>.localhost:<bridge_port>`. Pending entries are memory-only, capped at 128, cleaned on access, and oldest-first evicted after expired entries are removed.

The browser redeems the entry with one GET. Runtime consumes the entry on the first attempt and rejects reuse, expiry, another method, Host, port, forward, or path. Successful redemption sets a Host-only, HttpOnly, SameSite=Strict cookie with path `/`, then returns a non-cacheable 303 to the clean application path without the entry credential. The redirect preserves the original path, query, and fragment. The cookie is intentionally not `Secure` because the private bridge is loopback HTTP; it carries random session authority rather than the Desktop bridge token.

## Session and proxy boundary

One current browser session exists per exact bridge authority and forward. A new redemption replaces the prior value. Sessions expire after 12 hours or Runtime shutdown, remain memory-only, are capped at 256, and are cleaned or oldest-first evicted under the same bounded store. Every HTTP and WebSocket request must present the current cookie on the exact virtual Host and port. A cookie from another forward, bridge port, or Runtime process cannot authorize the request, and browser authorization is never accepted on base Local UI.

After admission, Runtime removes every reserved browser cookie and the Desktop bridge header before dispatching through the common port-forward proxy. The proxy drops an upstream `Set-Cookie` using the reserved name and keeps ordinary application cookies Host-bound. Root-relative resources, application-owned `/pf/*` paths, same-protocol same-port redirects, HTTP query parameters, fragments, and WebSockets continue through the existing root-mounted forward without a second routing rule.

## Desktop action

Desktop derives the relative application location only from the exact private `pf-<forward_id>.localhost:<bridge_port>` route. It posts through the current native or placement bridge, then validates the returned scheme, Host, port, forward, path, query, fragment, and one shaped entry credential before invoking the operating system. Mint errors, oversized or malformed responses, response mismatches, timeouts, and OS-open failures stay in the current window and surface one localized error. The former public-URL conversion and private-route fallback do not exist.

If a unified-proxy target view explicitly blocked an external HTTP(S) navigation, the user's Open in browser action opens that reviewed address directly. An already authorized remote Provider or Gateway `pf-*` route also opens on its existing origin. Neither case enters the Desktop-private mint flow. Local-compatibility mode disables the action and cannot silently switch access modes.

# Boundaries

The system-browser cookie authorizes one unified Web Service proxy origin; it is not a Local UI login, Flowersec artifact, Provider session, Gateway ticket, reusable Desktop credential, local-compatibility credential, or public-access mechanism. Browser session state does not change the persistent port-forward registry. The Desktop IPC action and Runtime startup report remain unchanged.

# Evidence

- `redeven:internal/localui/desktop_browser_handoff.go:1` - Runtime owns bounded one-time entries, clean redemption, exact session replacement, expiry, and cookie admission.
- `redeven:internal/localui/localui.go:240` - The existing private bridge selects header or exact browser-session admission before the common forward backend.
- `redeven:internal/codeapp/appserver/server.go:301` - The reserved browser cookie is stripped before upstream dispatch and filtered from upstream responses.
- `redeven:desktop/src/main/webServiceBrowserExternal.ts:1` - Desktop mints, bounds, and validates an exact entry before opening the system browser.
- `redeven:internal/localui/desktop_browser_handoff_test.go:1` - Tests cover one-use and expiry, Host, port, forward and path binding, session replacement, scope isolation, and bounded memory.
- `redeven:desktop/src/main/webServiceBrowserExternal.test.ts:1` - Tests prove private minting, exact response validation, no-open failures, reviewed external links, and retained remote routes.
