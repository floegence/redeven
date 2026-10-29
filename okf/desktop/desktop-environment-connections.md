---
type: Desktop Contract
title: Desktop Environment connections
tags: [desktop, environment, connection, settings]
lifecycle: contract
reviewed_at: "2026-10-29"
---
# Summary

Welcome and settings share a pure connection model derived from host access, placement, Runtime public addresses and health. Presentation never selects transport. Addresses retain their host/container namespace; missing or failed observations remain unconfirmed rather than proving process exit. Private bridge credentials never become browser, clipboard or QR targets. Explicit Stop clears addresses even when a prior window remains open.

# Contract

- Identify the selected Environment before listing addresses. Never replace a URL host with an SSH alias or rely on WSL localhost forwarding. Address count cannot resize settings or move its footer.
- Internal browser access aligns its label and scope with the connection facts, stacking at narrow widths. The internal-listener disclosure owns the address count and filtered count; it preserves expansion on refresh and offers no browser, copy or share actions for environment-only addresses.
- Gateway source cards retain explicit URL/local/SSH/container transport and never gain Runtime lifecycle authority. Tokens and private loopback credentials remain absent from displayed facts, clipboard and QR data.
- Public addresses remain independent of private management. Saved bind/protocol/port/password/certificate changes apply next start; drafts cannot synthesize current URLs. Failed writes preserve the password verifier and report failure.

# Boundaries

[Verified routes](desktop-environment-access.md) owns identity/defaults; [Environment library](desktop-environment-library.md) owns grouping, source grids, search/counts and owner pins. Unsupported legacy links retain recovery facts. [Interaction continuity](desktop-interaction-continuity.md) owns open sessions.

# Evidence

- `redeven:desktop/src/main/desktopWelcomeRuntimePoller.test.ts` - Verifies five-second real probes with a pending Cloud request, per-target deduplication, and disabled automatic probing.

- `redeven:desktop/src/shared/desktopEnvironmentConnection.ts` - One typed connection, address, and status model for Welcome and settings.
- `redeven:desktop/scripts/check-welcome-compact-layout.mjs` - Real Welcome geometry, keyboard disclosure, refresh continuity and actions across shipped locales, themes and widths.
