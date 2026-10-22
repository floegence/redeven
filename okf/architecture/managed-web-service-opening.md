---
type: Runtime Contract
title: Managed Web Service opening
description: Prepare the current verified launch entrance and recover authentication without implicit lifecycle changes.
tags: [architecture, managed-services, security, desktop, recovery]
timestamp: 2026-10-12T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

- Authority: the released template package owns entrance declarations and parsing; Runtime owns launch verification, preparation and private persistence; Desktop owns navigation results; Env App owns factual presentation.
- Outcome: Host, Container and Compose hand a verified current entrance to the existing protected Forward route, including an already-running instance after an upgrade.
- Invariants: opening never restarts, upgrades, reinstalls or modifies application data; one public preparation path owns results; HTTP 401 proves response availability, not authenticated access.
- Failure boundary: unverified ownership, launch changes, unavailable output and unsafe URLs fail with retryable or explicit recovery explanations. A preparation failure never stops a healthy application.

# Contract

## Sources and launch identity
TemplateSpec 7 accepts exactly one entrance source: a fixed endpoint path, the supported Host opening hook, or `startup_url.line_prefix`. Container and Compose never acquire permission to run Host scripts.

Missing or rotated output and an absent verified record require an explicitly chosen restart to produce a new entrance.

## One preparation owner
`open-session` observes the applied instance, prepares its entrance through one common owner, checks endpoint availability, and revalidates generation, applied identity, Forward and management state before handoff.

List and inspection never prepare an entrance or execute opening hooks.

Changed business scripts and settings still require their normal lifecycle review.

## Browser outcome and recovery
`ready` means the entrance is ready for browser handoff.

Trusted IPC accepts only bounded replies from that same live main frame.

Per-service progress follows [Web Services interface](web-services-interface.md).

# Boundaries

Entrance preparation operates within the existing [Managed Web Service contract](managed-web-services.md) and [Desktop protected-route contract](web-service-desktop-loopback.md). It does not change execution, access-mode or Forward authorization ownership.

## Qualification ownership
`scripts/qualify_managed_web_opening.sh` is the dedicated real-service lane. A failed Electron runtime preflight is an explicit environment failure; qualification cannot alter macOS trust or sign dependencies.

# Evidence

- `redeven:internal/managedwebservice/opening_prepare.go` - Common source validation, private cache and generation checks.

- `redeven:internal/managedwebservice/opening_launch.go` - Native and container launch authority, including unique Compose entrance selection.

- `redeven:internal/containerengine/startup_logs.go` - Bounded current-launch output reads.
