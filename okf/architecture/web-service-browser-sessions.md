---
type: Runtime Contract
title: Web Service browser sessions
description: Address-first Web Service opening, ephemeral forward lifecycle, and isolated Desktop browsing.
tags: [architecture, desktop, port-forward, security, ui]
timestamp: 2026-09-09T00:00:00Z
---
# Summary

Redeven Web Services accepts a port or an HTTP(S) deep link whose host is the current Environment's loopback interface, then opens it through the Environment-authorized port-forward route. Public, LAN, and other non-loopback targets are rejected before a forward session or window is created. Each persisted forward owns one `access_mode`: `unified_proxy` uses Redeven's secure route everywhere, while HTTP-only `desktop_loopback` gives one Desktop window a protected `127.0.0.1` origin for applications that require a local browser. The registry is the sole mode authority; no device heuristic or direct-target fallback may override it. Invalid targets, stale Environment windows, route mismatches, unsupported modes, and expired temporary forwards fail closed.

# Contract

## Address and lifecycle

The address field accepts a numeric port such as `3000` or `:3000`, or an absolute or scheme-less HTTP(S) address whose host is exactly `localhost`, a numeric IPv4 address in `127.0.0.0/8`, or the IPv6 loopback address `::1`. A numeric port resolves to `localhost:<port>`. The Runtime normalizes the transport target to an origin with an explicit port while preserving the path, query, and fragment as the requested application path. Other DNS names, public or LAN IP addresses, schemes other than HTTP(S), user information, missing hosts, and ports outside `1..65535` are rejected. Backend normalization is authoritative; renderer validation provides immediate feedback but is not a security boundary.

Opening an address first searches the persistent registry for the normalized origin. A route-safe match reuses the existing forward identity, its access mode, and updates its last-opened time. Otherwise the Runtime creates an in-memory forward with a random DNS-safe identity and the requested mode. The fresh Registry baseline accepts only DNS-safe persisted identities; invalid records fail instead of receiving an alias. Temporary forwards are discoverable only by exact identity through the proxy path, are excluded from persistent list responses, and expire after two hours without access. Explicit Save requires a bounded name, then persists it, an optional description, the selected access mode, the existing identity, and the user-reviewed normalized loopback URL before removing the temporary entry. Later detail edits may update that same record's loopback URL, name, description, and access mode without replacing its identity. Runtime restart discards all unsaved entries by construction.

For ordinary saved services, `target_url` remains the proxy origin and `default_app_path` owns the user-reviewed launch path, query, and fragment. Save prefills the complete temporary-session URL; create and edit accept that same loopback deep-link syntax. Runtime splits the submitted target once and atomically persists both fields. List, create, edit, and touch responses retain the default path. The row displays and searches the complete default URL, editing prefills it, and Open uses it. An explicit address launch may request another path without overwriting the saved default. An origin-only edit resets the default to `/`; metadata-only edits retain it. The `portforward_registry_v2` lineage advances from version 1 to 2 with a contiguous automatic migration that defaults existing records to `/`, preserves user records, verifies exact source and target DDL, and rolls back schema, data, and version together on failure. Managed process-bound paths remain owned by `open-session` and are never copied into this field.

A [Managed Web Service](managed-web-services.md) owns a persistent protected, DNS-safe forward from installation until uninstall. Install and Start run in the background without reserving a window. Explicit Open calls the authorized, non-cacheable `open-session` endpoint to observe the applied instance and resolve its verified entrance. The [independent Host lifecycle](independent-host-services.md) owns process recovery, hooks, private opening records, pending template changes, and concurrent opening preparation. Opening never implicitly restarts a service; an already active explicit Start or Restart may be followed before it continues.

Renderer passes the returned path into existing route preparation without reconstructing it from list state. Queries in a dynamic path are excluded from Registry, audit, diagnostics, logs, and UI copy. Stopping the application retains the forward so Open, restart, recovery, and unavailable-service presentation remain attached to one stable route; ordinary delete-forward requests fail while that ownership exists.

A persisted record created by an older build with a non-loopback target is not migrated, repaired, or deleted automatically. Runtime resolution, last-opened updates, session save, and record updates reject that target before use or mutation. Proxy parsing independently applies the same loopback-only normalizer, so a stored external address cannot bypass the service-level check.

The address field is the primary action, with quiet local-service guidance. Invalid input replaces that guidance with an inline caution containing scope, a plain-language reason, and accepted examples; it must neither imply product failure nor issue an API request or create a window. After opening, the launcher shows the complete normalized target and application path, matching Desktop's address field. Both accept numeric-port shorthand: the current port alone opens its root, while a port with a path retains that path. Only the initiating Web Services surface is blocked during route or ticket resolution. Saved services remain below the launcher. Temporary results are identified and offer explicit Save; opening alone never persists a service.

Header, launcher, toolbar, and collection share a centered axis. The header contains only template and creation actions; the launcher is a full-width labeled form. Search and refresh sit beside the collection title and count. Managed and ordinary services share equal-height rows in one divided neutral surface. Desktop rows use four common columns: identity, location or recent activity, status, and a fixed-width action grid. Open buttons align; absent secondary actions reserve space without placeholder controls. State uses a compact dot and label, never a row tint. Template descriptions and detailed health timing stay outside rows; update, restart, logs, and uninstall share one overflow menu. Layout remains aligned and responsive across service types and collection sizes.

## Route and Desktop isolation

Browser-only Local UI opens a unified-proxy Web Service through `/pf/<forward_id>/...`; remote Environment sessions use the existing `pf-<forward_id>` sandbox origin and one-time entry ticket. A Desktop private bridge uses the root-mounted `http://pf-<forward_id>.localhost:<bridge_port>/...` authority. The requested application path is carried into every route independently of the proxy origin. Only an explicitly saved ordinary-service default becomes registry state; temporary navigation and Managed Service process-bound paths do not. Proxy lookup resolves persistent and unexpired temporary identities through the same permission-gated port-forward backend.

One routing decision reads the persisted `access_mode`. `unified_proxy` loads the protected route directly and remains available in Desktop, Web Env App, and the system browser. HTTP-only `desktop_loopback` follows the separate [Desktop loopback Web Service access](web-service-desktop-loopback.md) contract. No renderer heuristic, target probe, or failure may replace that decision.

System-browser handoff for `unified_proxy` is owned by [Web Service system-browser authorization](web-service-browser-authorization.md). It keeps the same `pf-<forward_id>.localhost:<bridge_port>` root origin and never converts to a public `/pf/<id>` route. A user-selected blocked external HTTP(S) link still opens directly in unified mode, while remote Provider and Gateway `pf-*` routes retain their existing remote authorization flow.

[Desktop Web Service windows](../desktop/web-service-browser-window.md) own trusted chrome, isolated application views, navigation, target DevTools, connection-failure presentation, and cleanup. Their routes remain authorized by this session contract.

# Boundaries

The in-memory forward is product session coordination, not a second persistent registry. It must not be written to the database until Save succeeds, and an expired or unknown identity must not be reconstructed from request data. `port_forwards.access_mode` is the single durable decision; managed services only project it. Saving retains the same identity so an already-open proxy route does not silently switch authority.

Desktop window isolation follows its dedicated contract; browser-only Env App retains its explicit popup route.

# Evidence

- `redeven:internal/portforward/service.go` - Runtime normalizes addresses and owns exact persistent reuse, temporary expiry, and explicit persistence.
- `redeven:internal/codeapp/appserver/managed_web_services.go` - Authorizes non-cacheable Managed Service opening without placing a private application path in audit detail.
- `redeven:internal/managedwebservice/open_session.go` - Observes the applied instance and shares bounded opening preparation without implicit Restart.
- `redeven:internal/codeapp/appserver/server.go:5880` - Permission-gated Local UI APIs open and save Web Service sessions.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx:470` - Web Services owns the unified service-row presentation, common browser-session resolution, address-first open, and explicit temporary-session Save flow.
- `redeven:internal/localui/localui.go:247` - The token-protected Desktop bridge admits exact per-forward virtual authorities and dispatches them through the common port-forward backend without a path prefix.
- `redeven:internal/codeapp/appserver/server.go:6200` - The common reverse proxy preserves application root paths and rewrites only same-protocol, same-port target redirects.
- `redeven:internal/codeapp/appserver/server.go:6782` - The port-forward proxy marks only transport-owned upstream failures for Desktop presentation.
- `redeven:internal/portforward/service_test.go:54` - Focused tests cover deep-link normalization, no persistence before Save, saved-origin reuse, identity-preserving Save, expiry, identity collision rejection, and concurrent save visibility.
