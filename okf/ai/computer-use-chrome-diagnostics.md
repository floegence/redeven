---
type: Runtime and Product Contract
title: Chrome connection diagnostics and recovery
tags: [ai, browser-use, chrome, diagnostics]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Runtime owns readiness/handshakes; both carriers provide host-specific recovery. Installed Chrome/accepted launch proves neither control nor continuation. Distinguish resource/session/launch/status failures; only compatible live profiles enter Floret Respond, without browser substitution.

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

- `redeven:internal/ai/computer_extension_diagnostics.go` - Source.
- `redeven:internal/ai/computer_extension_onboarding.go` - Source.
- `redeven:internal/ai/computer_extension_diagnostics_test.go` - Tests.
