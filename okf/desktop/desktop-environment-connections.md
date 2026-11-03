---
type: Desktop Contract
title: Desktop Environment connections
tags: [desktop, environment, connection, settings]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Welcome/settings derive connections from host access, placement, Runtime addresses and health. Presentation never selects transport; failed observations cannot prove exit. Keep host/container namespaces and private credentials distinct; explicit Stop clears addresses.

# Contract

- Identify the selected Environment before listing addresses. Never replace a URL host with an SSH alias or rely on WSL localhost forwarding. Address count cannot resize settings or move its footer.
- Internal browser access aligns its label with one expandable scope-and-count summary, stacking at narrow widths. Do not repeat the scope with explanatory paragraphs or a separate disclosure label. The disclosure owns the address count and filtered count, preserves expansion on refresh, and offers no browser, copy or share actions for environment-only addresses.
- Gateway source cards retain explicit URL/local/SSH/container transport and never gain Runtime lifecycle authority. Tokens and private loopback credentials remain absent from displayed facts, clipboard and QR data.
- Public addresses remain independent of private management. Saved bind/protocol/port/password/certificate changes apply next start; drafts cannot synthesize current URLs. Failed writes preserve the password verifier and report failure.

# Boundaries

[Verified routes](desktop-environment-access.md) owns identity/defaults; [Environment library](desktop-environment-library.md) owns grouping, source grids, search/counts and owner pins. Unsupported legacy links retain recovery facts. [Interaction continuity](desktop-interaction-continuity.md) owns open sessions.

# Evidence

- `redeven:desktop/src/main/desktopWelcomeRuntimePoller.test.ts` - Tests.
- `redeven:desktop/src/shared/desktopEnvironmentConnection.ts` - Source.
- `redeven:desktop/scripts/check-welcome-compact-layout.mjs` - Tests.
