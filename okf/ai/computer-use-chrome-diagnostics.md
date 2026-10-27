---
type: Runtime and Product Contract
title: Chrome connection diagnostics and recovery
description: Identify Chrome prerequisites, preserve connection failures, and guide recovery on the actual environment host.
tags: [ai, browser-use, chrome, diagnostics]
timestamp: 2026-09-27T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

ComputerUseRuntime owns readiness/live handshakes; Desktop/Env App share host-specific guidance. Installed Chrome or accepted launch is not control readiness or task continuation. Resource, graphical-session, launch, status and continuation failures have distinct recovery. Only a compatible live profile enters Floret Respond; preserve guidance, never substitute browsers.

# Contract

## Readiness and diagnostics
`extension/status` reports the environment hostname, platform, Runtime build version when available, discovered installations, their live profiles, prior preparation and bounded per-installation diagnostics.

Browser target selection belongs to Flower; no separate browser source preference or product database is read during startup.

## Recovery on the environment host
The Chrome overview and connection guide share one compact readiness surface. Both consume the existing Runtime snapshot, including diagnostics embedded in `environment.chrome`; the overview must not reduce an explicit blocker to a generic disconnected state.

Connection observation remains bounded to the open guide; pressing Connect or copying the manual connection link starts a fresh observation window after installation, timeout or a failed check.

# Boundaries

A launch or installation acknowledgement cannot resume a task. Unreadable status remains a distinct failure and cannot be replaced by readiness inferred from an installed executable.

# Evidence

- `redeven:internal/ai/computer_extension_diagnostics.go` - resource and graphical-session prerequisites.

- `redeven:internal/ai/computer_extension_onboarding.go` - bounded process observation and generation-scoped failure.

- `redeven:internal/ai/computer_extension_diagnostics_test.go` - missing resources, no display and early/late process exits.
