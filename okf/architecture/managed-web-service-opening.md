---
type: Runtime Contract
title: Managed Web Service opening
tags: [architecture, managed-services, security, desktop, recovery]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Templates parse entrances; Runtime verifies/persists preparation; Desktop navigates and Env App presents. HTTP401 proves availability only; failures offer recovery and never stop healthy apps. Missing or rotated output and an absent verified record require an explicitly chosen restart to produce a new entrance.

# Contract

## Sources and launch identity
TemplateSpec 7 accepts exactly one entrance source: a fixed endpoint path, the supported Host opening hook, or `startup_url.line_prefix`. Container and Compose never acquire permission to run Host scripts.

## One preparation owner
`open-session` observes the applied instance, prepares its entrance through one common owner, checks endpoint availability, and revalidates generation, applied identity, Forward and management state before handoff.

List and inspection never prepare an entrance or execute opening hooks.

Changed business scripts and settings still require their normal lifecycle review.

## Browser outcome and recovery
`ready` means the entrance is ready for browser handoff.

Trusted IPC accepts only bounded replies from that same live main frame.

Per-service progress follows [Web Services interface](web-services-interface.md).

# Boundaries

Entrance preparation operates within the existing [Managed Web Service contract](managed-web-services.md) and [Desktop protected-route contract](web-service-browser-sessions.md#desktop-loopback). It does not change execution, access-mode or Forward authorization ownership.

## Qualification ownership
`scripts/qualify_managed_web_opening.sh` is the dedicated real-service lane. A failed Electron runtime preflight is an explicit environment failure; qualification cannot alter macOS trust or sign dependencies.

# Evidence

- `redeven:internal/managedwebservice/opening_prepare.go` - Source.
