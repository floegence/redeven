---
type: Runtime Contract
title: Web Service browser sessions
description: Address-first Web Service opening, ephemeral forward lifecycle, and isolated Desktop browsing.
tags: [architecture, desktop, port-forward, security, ui]
timestamp: 2026-07-31T00:00:00Z
---
# Summary

Redeven Web Services accepts a port or an HTTP(S) deep link whose host is the current Environment's loopback interface, then opens it through the Environment-authorized port-forward route. Public, LAN, and other non-loopback targets are rejected before a forward session or window is created. An address-first open is temporary by default and does not modify the persistent Web Service registry. Desktop renders the route in a Redeven-owned browser window with a trusted navigation toolbar and a separate target view that has no preload; browser-only Env App sessions retain the existing explicit popup route and do not claim Desktop isolation. Invalid targets, stale Environment windows, route mismatches, unsupported persisted targets, and expired temporary forwards fail closed.

# Contract

## Address and lifecycle

The address field accepts a numeric port such as `3000` or `:3000`, or an absolute or scheme-less HTTP(S) address whose host is exactly `localhost`, a numeric IPv4 address in `127.0.0.0/8`, or the IPv6 loopback address `::1`. A numeric port resolves to `localhost:<port>`. The Runtime normalizes the transport target to an origin with an explicit port while preserving the path, query, and fragment as the requested application path. Other DNS names, public or LAN IP addresses, schemes other than HTTP(S), user information, missing hosts, and ports outside `1..65535` are rejected. Backend normalization is authoritative; renderer validation provides immediate feedback but is not a security boundary.

Opening an address first searches the persistent registry for the normalized origin. A match reuses the existing forward identity and updates its last-opened time. Otherwise the Runtime creates an in-memory forward with a random DNS-safe identity. Temporary forwards are discoverable only by exact identity through the proxy path, are excluded from persistent list responses, and expire after two hours without access. Explicit Save persists the same forward identity, normalized origin, and user-facing metadata before removing the temporary entry. Runtime restart discards all unsaved entries by construction; no database migration or cleanup is required.

A persisted record created by an older build with a non-loopback target is not migrated, repaired, or deleted automatically. Runtime resolution, last-opened updates, session save, and record updates reject that target before use or mutation. Proxy parsing independently applies the same loopback-only normalizer, so a stored external address cannot bypass the service-level check.

The address field is the primary Web Services action. Its quiet default guidance identifies the local-service boundary without competing with the primary action. For malformed, non-loopback, or otherwise unsupported input, that guidance becomes a compact caution state with a short scope statement, a plain-language reason, and a separate line of accepted examples. It must not use a destructive-error treatment or imply that the product itself failed. Validation remains inline before any API request or window creation. After a session opens, Env App normalizes the launcher field to the complete target URL and application path so it matches the address shown by the Desktop window. The Desktop address field accepts the same numeric-port shorthand as the launcher: entering the current port resets the target to its root, and a port followed by a path resolves that path without treating the port as a path segment. Saved-service management remains available below it. Opening blocks only the initiating Web Services surface while the route or entry ticket is resolved. A temporary result is visibly identified and offers an explicit Save command; opening alone must not create a durable service.

## Route and Desktop isolation

Local UI opens a Web Service through `/pf/<forward_id>/...`; remote Environment sessions use the existing `pf-<forward_id>` sandbox origin and one-time entry ticket. The requested application path is carried into either route without exposing it as registry state. Proxy lookup resolves both persistent and unexpired temporary identities through the same permission-gated port-forward backend.

When the trusted Desktop Shell bridge is present, Env App requests a semantic Web Service window instead of creating a renderer popup. The request carries the normalized loopback service origin for trusted presentation, but that display value grants no navigation authority. Electron main accepts only absolute HTTP(S) route URLs that remain inside the current Environment navigation family and identify the exact forward through either the local `/pf/<id>` path or remote `pf-<id>` host. The window exposes a conventional address field, Back, Forward, Reload, Stop, Developer Tools, and explicit Open in browser controls. The address field projects the internal protected route back onto the user-facing service origin and current application path; it must not expose Runtime listener ports, `/pf/<id>` prefixes, forward identities, boot routes, entry tickets, or other transport details. Address edits may use the same service's complete target URL, a service-relative path, query, or fragment. Electron main maps each edit back to the existing protected route and validates it against the exact Environment, forward, and target origin before navigation; another origin or port is rejected.

Each forward window uses a trusted local toolbar document plus a separate `WebContentsView` for target content. The target view uses a dedicated non-persistent Electron partition, `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, and no preload. The toolbar's narrow preload can only request browser actions and read browser state; it does not enter the target view. Closing the window or its Environment session destroys the target view and clears the partition storage. Reopening the same live forward reuses its isolated window.

The Developer Tools button and F12 operate on the target `WebContentsView`, never the trusted toolbar. The conventional macOS `Command+Option+I` and Windows/Linux `Ctrl+Shift+I` shortcuts share the same toggle path. Desktop opens the target inspector detached, reflects its open state in the toolbar, and permits closing it through the same action.

When the port-forward proxy cannot connect to its upstream, it returns a non-cacheable 502 with a Redeven-owned failure marker. Desktop recognizes that marker only on the target view's main document, cancels the raw response, and replaces it with a localized, scriptless local state page. The page states that the Environment was reached but the requested service did not respond, shows the normalized target address, lists service and port checks, and provides a retry intent. Retry immediately changes the button to a localized in-progress state for a short perceptible feedback window, then reloads the original authorized route from Electron main. A delayed retry runs only while the same unavailable page and retry intent remain current, so a new navigation or closed window cannot be overwritten. The local document does not receive a preload, bridge, route URL, or entry ticket. An unmarked 502 from the target application remains application content and must not be reclassified as a connection failure.

Target navigation and popups may remain in the isolated window only while the exact Environment and forward constraints continue to hold. Navigation outside that boundary is denied to the target WebContents and retained as a reviewable HTTP(S) target when possible without rendering a late scope error over the target content or automatically opening another application. Only the user's explicit Open in browser toolbar action may hand the retained target, or the current Web Service URL when no target is pending, to the system browser. The target document never receives the Redeven Desktop bridge, Env App preload, or the parent Environment session partition.

# Boundaries

The in-memory forward is product session coordination, not a second persistent registry. It must not be written to the database until Save succeeds, and an expired or unknown identity must not be reconstructed from request data. Saving retains the same identity so an already-open proxy route does not silently switch authority.

Desktop isolation is a B-level browsing surface over Redeven's existing authorized route; it is not Remote Browser Isolation and does not claim a general-purpose browser security boundary. The browser-only Env App path remains an explicit popup route. Redeven must not label a same-page iframe as complete isolated browsing, copy a reusable RBI implementation into this repository, or bypass the published-dependency policy to obtain one.

# Evidence

- `redeven:internal/portforward/service.go:109` - Runtime normalizes addresses and owns temporary forward creation, reuse, expiry, and explicit persistence.
- `redeven:internal/codeapp/appserver/server.go:5880` - Permission-gated Local UI APIs open and save Web Service sessions.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx:851` - Web Services presents the address-first open and explicit temporary-session Save flow.
- `redeven:desktop/src/shared/desktopShellWebServiceWindowIPC.ts:1` - The semantic Desktop IPC validates HTTP(S) URLs and DNS-safe forward identities.
- `redeven:desktop/src/main/navigation.ts:243` - Desktop projects protected routes as target-origin addresses and maps accepted edits back to the exact port-forward path or sandbox host.
- `redeven:desktop/src/main/main.ts:7916` - Desktop prepares the isolated network partition, owns the trusted browser toolbar and target view, handles marked connection failures and target DevTools, enforces popup/navigation policy, and clears partition storage and cache.
- `redeven:desktop/src/main/webServiceUnavailableDocument.ts:1` - The localized scriptless state page presents the target, recovery checks, and local retry intent without a renderer bridge.
- `redeven:internal/codeapp/appserver/server.go:6782` - The port-forward proxy marks only transport-owned upstream failures for Desktop presentation.
- `redeven:internal/portforward/service_test.go:54` - Focused tests cover deep-link normalization, no persistence before Save, saved-origin reuse, identity-preserving Save, expiry, identity collision rejection, and concurrent save visibility.
