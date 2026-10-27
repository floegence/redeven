---
type: Interaction Contract
title: Desktop interaction continuity
description: Preserve open Welcome sessions through background observations and isolate authority and completion boundaries.
tags: [desktop, interaction, accessibility, testing]
timestamp: 2026-10-16T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Desktop Welcome owns interaction sessions; Launcher and Runtime own business facts and execution progress. Background observations must preserve an open dialog or popup, its draft, selection, step, details, focus, native text selection and scroll. Only explicit opening, closing, switching, handoff or the current operation's completion changes visibility. Invalid authority preserves the visible session and input, blocks stale submission and offers verification or an accessible exit. Closing progress does not cancel its task.

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
