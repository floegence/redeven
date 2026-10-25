---
type: Runtime Contract
title: Web Service browser sessions
description: Address-first Web Service opening, ephemeral forward lifecycle, and isolated Desktop browsing.
tags: [architecture, desktop, port-forward, security, ui]
timestamp: 2026-09-09T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Web Services accepts ports or HTTP(S) deep links to the current Environment's loopback and opens them through authorized forwarding. Other targets fail before session/window creation. Registry-owned `access_mode` selects secure `unified_proxy` or HTTP-only Desktop `desktop_loopback`; heuristics and failures cannot override it. Stale windows, mismatched routes, invalid modes and expired temporary forwards fail closed.

# Contract

- Backend normalization accepts `3000`, `:3000` and absolute/scheme-less HTTP(S) with exact `localhost`, numeric `127.0.0.0/8` or `::1`. Renderer checks are feedback only.
- Browser Local UI unified access uses `/pf/<forward_id>/...`; remote sessions use authorized `pf-<forward_id>` origin and one-time entry. [Loopback access](web-service-desktop-loopback.md) and [Desktop windows](../desktop/web-service-browser-window.md) own Desktop presentation.
- [Operation progress](managed-service-operation-progress.md) owns per-service feedback. Managed services open through their verified `open-session` result.

# Boundaries

Temporary forwards are memory-only until Save; expired/unknown identities cannot be recreated from request fields. Browser-only Env App retains its popup route; no direct-target fallback or device heuristic changes registry authority.

# Evidence

- `redeven:internal/portforward/service.go` - Runtime normalizes addresses and owns exact persistent reuse, temporary expiry, and explicit persistence.

- `redeven:internal/codeapp/appserver/managed_web_services.go` - Authorizes non-cacheable Managed Service opening without placing a private application path in audit detail.

- `redeven:internal/managedwebservice/open_session.go` - Observes the applied instance and shares bounded opening preparation without implicit Restart.
