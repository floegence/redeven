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

ComputerUseRuntime owns Chrome readiness and its live handshake inventory.
Desktop and Env App present the same host-specific prerequisite and failure
facts. Installed Chrome alone does not establish browser-control readiness.
Missing resources, unavailable graphical sessions, application launch failures,
status-read failures and conversation-continuation failures have separate recovery
instructions. Neither a successful launch nor installation acknowledgement resumes
a task; only a compatible live profile can reach the existing Floret Respond path.
Failures preserve user guidance and never substitute a different browser.

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
