---
type: Runtime Contract
title: Web Service browser sessions
description: Address-first Web Service opening, ephemeral forward lifecycle, and isolated Desktop browsing.
tags: [architecture, desktop, port-forward, security, ui]
timestamp: 2026-07-31T00:00:00Z
---
# Summary

Redeven Web Services accepts a port, host, or HTTP(S) deep link and opens it through the Environment-authorized port-forward route. An address-first open is temporary by default and does not modify the persistent Web Service registry. Desktop renders the route in a Redeven-owned isolated window with no target preload; browser-only Env App sessions retain the existing explicit popup route and do not claim Desktop isolation. Invalid targets, stale Environment windows, route mismatches, and expired temporary forwards fail closed.

# Contract

## Address and lifecycle

The address field accepts a numeric port such as `3000`, `:3000`, `host:port`, or an absolute HTTP(S) URL. A numeric port resolves to `localhost:<port>`. The Runtime normalizes the transport target to an origin with an explicit port while preserving the path, query, and fragment as the requested application path. Schemes other than HTTP(S), user information, missing hosts, and ports outside `1..65535` are rejected.

Opening an address first searches the persistent registry for the normalized origin. A match reuses the existing forward identity and updates its last-opened time. Otherwise the Runtime creates an in-memory forward with a random DNS-safe identity. Temporary forwards are discoverable only by exact identity through the proxy path, are excluded from persistent list responses, and expire after two hours without access. Explicit Save persists the same forward identity, normalized origin, and user-facing metadata before removing the temporary entry. Runtime restart discards all unsaved entries by construction; no database migration or cleanup is required.

The address field is the primary Web Services action. Saved-service management remains available below it. Opening blocks only the initiating Web Services surface while the route or entry ticket is resolved. A temporary result is visibly identified and offers an explicit Save command; opening alone must not create a durable service.

## Route and Desktop isolation

Local UI opens a Web Service through `/pf/<forward_id>/...`; remote Environment sessions use the existing `pf-<forward_id>` sandbox origin and one-time entry ticket. The requested application path is carried into either route without exposing it as registry state. Proxy lookup resolves both persistent and unexpired temporary identities through the same permission-gated port-forward backend.

When the trusted Desktop Shell bridge is present, Env App requests a semantic Web Service window instead of creating a renderer popup. Electron main accepts only absolute HTTP(S) URLs that remain inside the current Environment navigation family and identify the exact forward through either the local `/pf/<id>` path or remote `pf-<id>` host. Each forward window uses a dedicated non-persistent Electron partition, `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, and no preload. Closing the window or its Environment session destroys the window and clears the partition storage. Reopening the same live forward reuses its isolated window.

Target navigation and popups may remain in the isolated window only while the exact Environment and forward constraints continue to hold. Navigation outside that boundary is denied to the target WebContents and handed to the system browser. The target document never receives the Redeven Desktop bridge, Env App preload, or the parent Environment session partition.

# Boundaries

The in-memory forward is product session coordination, not a second persistent registry. It must not be written to the database until Save succeeds, and an expired or unknown identity must not be reconstructed from request data. Saving retains the same identity so an already-open proxy route does not silently switch authority.

Desktop isolation is a B-level browsing surface over Redeven's existing authorized route; it is not Remote Browser Isolation and does not claim a general-purpose browser security boundary. The browser-only Env App path remains an explicit popup route. Redeven must not label a same-page iframe as complete isolated browsing, copy a reusable RBI implementation into this repository, or bypass the published-dependency policy to obtain one.

# Evidence

- `redeven:internal/portforward/service.go:109` - Runtime normalizes addresses and owns temporary forward creation, reuse, expiry, and explicit persistence.
- `redeven:internal/codeapp/appserver/server.go:5880` - Permission-gated Local UI APIs open and save Web Service sessions.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx:851` - Web Services presents the address-first open and explicit temporary-session Save flow.
- `redeven:desktop/src/shared/desktopShellWebServiceWindowIPC.ts:1` - The semantic Desktop IPC validates HTTP(S) URLs and DNS-safe forward identities.
- `redeven:desktop/src/main/navigation.ts:243` - Desktop navigation binds the candidate URL to the exact port-forward path or sandbox host.
- `redeven:desktop/src/main/main.ts:7893` - Desktop prepares the isolated network partition before creating the no-preload window, owns popup/navigation policy, and clears partition storage and cache.
- `redeven:internal/portforward/service_test.go:54` - Focused tests cover deep-link normalization, no persistence before Save, saved-origin reuse, identity-preserving Save, expiry, identity collision rejection, and concurrent save visibility.
