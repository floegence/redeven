---
type: Interaction Contract
title: Desktop interaction continuity
tags: [desktop, interaction, accessibility, testing]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Welcome owns interaction sessions; Launcher/Runtime own business operations. Observations retain open panels, draft, focus, selection, steps and scroll. Only explicit user transitions or current completion alter visibility. Invalid authority blocks submission with recovery; closing progress never cancels work.

# Contract

## Ownership and observations
Each interaction field has one owner: the existing library overlay, guidance, lifecycle disclosure, Gateway foreground action or settings opening. Retained cards supply presentation only; submission reads current authoritative data.

Addresses no longer shareable still lose QR disclosure under the connection-security contract.

Before the first asynchronous submission, one synchronous transition records the attempt, closes its menu and opens its operation surface. Duplicate activation cannot submit twice.

Deferred initial focus never overrides a user-selected menu item.

The interaction-continuity package command runs required state and real component suites, including the production snapshot subscription and observer. The cached commit group runs affected staged sources; bounded integration checks affected base-to-tip paths.

Synthetic composition verifies DOM continuity; it does not prove physical operating-system IME behavior.

# Boundaries

## Layers, exit and recovery
Published presence and overlay ownership provide one exit and input-routing lifecycle.

Failure, permission loss, cancellation failure and missing progress retain an exit or recovery action. Closing never infers cancellation.

# Evidence

- [Retained owners](../../desktop/src/welcome/EnvironmentCards.tsx)

- [Live presence and layers](../../desktop/src/welcome/DesktopActionPopover.tsx)
