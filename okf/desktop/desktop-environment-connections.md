---
type: Desktop Contract
title: Desktop Environment connections
description: Explain each Environment connection and apply one address namespace policy to Welcome and settings.
tags: [desktop, environment, connection, settings]
timestamp: 2026-09-30T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Welcome and settings share a pure connection model derived from host access, placement, Runtime public addresses and health. Presentation never selects transport. Addresses retain their host/container namespace; missing or failed observations remain unconfirmed rather than proving process exit. Private bridge credentials never become browser, clipboard or QR targets. Explicit Stop clears addresses even when a prior window remains open.

# Contract

- Identify the selected Environment before listing addresses. Never replace a URL host with an SSH alias or rely on WSL localhost forwarding. Address count cannot resize settings or move its footer.
- Gateway source cards retain explicit URL/local/SSH/container transport and never gain Runtime lifecycle authority. Tokens and private loopback credentials remain absent from displayed facts, clipboard and QR data.
- Public addresses remain independent of private management. Saved bind/protocol/port/password/certificate changes apply next start; drafts cannot synthesize current URLs. Failed writes preserve the password verifier and report failure.

# Boundaries

[Verified routes](desktop-environment-access.md) owns identity/defaults; [Environment library](desktop-environment-library.md) owns grouping, source grids, search/counts and owner pins. Unsupported legacy links retain recovery facts. [Interaction continuity](desktop-interaction-continuity.md) owns open sessions.

# Evidence

- `redeven:desktop/src/main/desktopWelcomeRuntimePoller.test.ts` - Verifies five-second real probes with a pending Cloud request, per-target deduplication, and disabled automatic probing.

- `redeven:desktop/src/main/runtimeState.test.ts` - Keeps current public reports authoritative over private startup metadata and handles explicit empty lists.

- `redeven:desktop/src/shared/desktopEnvironmentConnection.ts` - One typed connection, address, and status model for Welcome and settings.
