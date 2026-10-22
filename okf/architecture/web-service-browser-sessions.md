---
type: Runtime Contract
title: Web Service browser sessions
description: Address-first Web Service opening, ephemeral forward lifecycle, and isolated Desktop browsing.
tags: [architecture, desktop, port-forward, security, ui]
timestamp: 2026-09-09T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven Web Services accepts a port or an HTTP(S) deep link whose host is the current Environment's loopback interface, then opens it through the Environment-authorized port-forward route. Public, LAN, and other non-loopback targets are rejected before a forward session or window is created. Each persisted forward owns one `access_mode`: `unified_proxy` uses Redeven's secure route everywhere, while HTTP-only `desktop_loopback` gives one Desktop window a protected `127.0.0.1` origin for applications that require a local browser. The registry is the sole mode authority; no device heuristic or direct-target fallback may override it. Invalid targets, stale Environment windows, route mismatches, unsupported modes, and expired temporary forwards fail closed.

# Contract

## Address and lifecycle
The address field accepts a numeric port such as `3000` or `:3000`, or an absolute or scheme-less HTTP(S) address whose host is exactly `localhost`, a numeric IPv4 address in `127.0.0.0/8`, or the IPv6 loopback address `::1`. Backend normalization is authoritative; renderer validation provides immediate feedback but is not a security boundary.

Per-service operation presentation follows the [operation progress contract](managed-service-operation-progress.md).

## Route and Desktop isolation
Browser-only Local UI opens a unified-proxy Web Service through `/pf/<forward_id>/...`; remote Environment sessions use the existing `pf-<forward_id>` sandbox origin and one-time entry ticket.

No renderer heuristic, target probe, or failure may replace that decision.

Their routes remain authorized by this session contract.

# Boundaries

The in-memory forward is product session coordination, not a second persistent registry. It must not be written to the database until Save succeeds, and an expired or unknown identity must not be reconstructed from request data.

Desktop window isolation follows its dedicated contract; browser-only Env App retains its explicit popup route.

# Evidence

- `redeven:internal/portforward/service.go` - Runtime normalizes addresses and owns exact persistent reuse, temporary expiry, and explicit persistence.

- `redeven:internal/codeapp/appserver/managed_web_services.go` - Authorizes non-cacheable Managed Service opening without placing a private application path in audit detail.

- `redeven:internal/managedwebservice/open_session.go` - Observes the applied instance and shares bounded opening preparation without implicit Restart.
