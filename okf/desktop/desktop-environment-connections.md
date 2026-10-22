---
type: Desktop Contract
title: Desktop Environment connections
description: Explain each Environment connection and apply one address namespace policy to Welcome and settings.
tags: [desktop, environment, connection, settings]
timestamp: 2026-09-30T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Desktop derives connection presentation from host access, process placement, Runtime-reported public addresses, and Runtime health. Welcome cards and settings share one pure connection model; presentation never chooses or changes a transport. An exactly linked Runtime and Cloud Environment share one visual card while retaining independent action owners. Every address retains its host or container namespace. An absent address does not prove the Runtime stopped, and private bridge authorities never become browser, clipboard, or QR targets. Missing or failed observations remain visibly unconfirmed; explicit Stop clears current addresses even while an old window remains.

[Verified access routes](desktop-environment-access.md) owns identity association and locally saved access defaults.

# Contract

Open sessions follow [Desktop interaction continuity](desktop-interaction-continuity.md).

## Connection information and address actions
Connection details identify the selected Environment before listing access addresses. Desktop never substitutes an SSH alias for a Runtime URL host or relies on WSL localhost forwarding.

Settings keep their fixed window and footer geometry regardless of address count.

# Boundaries

## Gateway connection facts
Independent Gateway source cards retain their explicit URL, local, SSH, or container transport. They never appear as Runtime lifecycle actions on catalog Environment cards.

Session tokens and private loopback proxy credentials never enter card facts, clipboard actions or QR data.

## Environment library presentation
[Environment library](desktop-environment-library.md) owns relationship cards, Runtime/Cloud access perspectives, source grids, searching, counts, and owner-scoped pin presentation. Unsupported legacy links retain their recovery fact.

## Access settings and independent clients
Public Runtime addresses are independent from Desktop's private management connection. Saved bind, protocol, port, password, and certificate changes apply on the next Runtime start; drafts never synthesize or replace the current reported URL.

Failed writes preserve the prior password verifier and report failure rather than claiming success.

# Evidence

- `redeven:desktop/src/main/desktopWelcomeRuntimePoller.test.ts` - Verifies five-second real probes with a pending Cloud request, per-target deduplication, and disabled automatic probing.

- `redeven:desktop/src/main/runtimeState.test.ts` - Keeps current public reports authoritative over private startup metadata and handles explicit empty lists.

- `redeven:desktop/src/shared/desktopEnvironmentConnection.ts` - One typed connection, address, and status model for Welcome and settings.
