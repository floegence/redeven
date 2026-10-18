---
type: Interaction Contract
title: Desktop interaction continuity
description: Preserve open Welcome sessions through background observations and isolate authority and completion boundaries.
tags: [desktop, interaction, accessibility, testing]
timestamp: 2026-10-16T00:00:00Z
---
# Summary

Desktop Welcome owns interaction sessions; Launcher and Runtime own business facts and execution progress. Background observations must preserve an open dialog or popup, its draft, selection, step, details, focus, native text selection and scroll. Only explicit opening, closing, switching, handoff or the current operation's completion changes visibility. Invalid authority preserves the visible session and input, blocks stale submission and offers verification or an accessible exit. Closing progress does not cancel its task.

# Contract

## Ownership and observations

Each interaction field has one owner: the existing library overlay, guidance, lifecycle disclosure, Gateway foreground action or settings opening. Snapshot membership and capability branches do not own an already-open session. Retained cards supply presentation only; submission reads current authoritative data. Health checks and equivalent snapshots never reinitialize a form or replace retained content with initial loading.

The native Local Environment's host-process placement comes from its saved Runtime root and the configured state root through one shared projection. Both lifecycle commands and Welcome use these coordinates even while a probe withdraws live Presence. Retained verified identity does not retain management capability. A real coordinate or verified identity change still revokes the existing disclosure's consent.

Destructive confirmation remains visible after target removal, replacement or capability loss, but its consent stays revoked even if the original target returns. Explicit verification starts a fresh target review and preserves the chosen reinstall mode. Expired invitations also revoke nested enrollment consent without clearing its address, code or current step.

Published KeyedFor retains nodes by business identity while item/index accessors read current data. Menus use action identity and timelines use step/task identity. Published Stepper and Tabs preserve semantic identity. Keys cannot use presentation positions. Disabled state and callbacks read current values even when the node survives.

A target removed from a list or whose connection identity, authorization or preview changes remains visible with its draft. Invalid actions are disabled in controls and handlers. Explicit revalidation fences older results; it never silently chooses another target or restores old consent. Expired security previews require fresh authorization. Addresses no longer shareable still lose QR disclosure under the connection-security contract.

# Admission, handoff and completion

Before the first asynchronous submission, one synchronous transition records the attempt, closes its menu and opens its operation surface. Admission is a named UI phase, not fabricated backend execution steps. Rejection, exceptions and unexpected results remain on that surface with retry and close. Duplicate activation cannot submit twice.

After Start, Restart or Update succeeds at Runtime ready, the card's enabled Open or Focus action resumes its normal behavior, including the current Open preflight. Completed progress does not intercept that action to reopen its timeline. Active work and failures retain their progress or recovery trigger; settings restart and revoked target disclosures retain their existing explicit continuation and review.

Launcher progress is selected by operation key and start time. Arrival order, temporarily absent progress, conflict binding and a late response cannot redirect a newer session. Settings save-and-restart retains its original target and passes visibly to its exact lifecycle disclosure; returning restores the draft. Successful current completion may close its surface. An older response never closes or reopens a newer opening. Menu exit does not restore focus into its old trigger during handoff; the destination owns focus. Deferred initial focus never overrides a user-selected menu item.

# Boundaries

## Layers, exit and recovery

Published presence and overlay ownership provide one exit and input-routing lifecycle. Hidden or exiting surfaces immediately become inert and aria-hidden. Nested dialogs receive their own focus, Escape and outside interactions. Exit reversal retains the live subtree; no captured HTML clone or independent fallback timer receives input. Completion callbacks validate their owning session.

Anchored popups retain their last anchor if it disappears, stay clamped to the viewport and keep recovery and close reachable. Failure, permission loss, cancellation failure and missing progress retain an exit or recovery action. Closing never infers cancellation.

# Permanent gates

The interaction-continuity package command runs required state and real component suites, including the production snapshot subscription and observer. The cached commit group runs affected staged sources; bounded integration checks affected base-to-tip paths. Missing files, empty suites, failed scope detection, execution errors and nonzero tests fail closed. The existing local gate owns the exact source-tree cache.

Quick CI runs bounded Node policy tests for the required manifest, package commands, hook/integration registration, qualification wiring and failure propagation. It does not install browsers. Browser continuity belongs to Desktop full local checks and its dedicated manual workflow. It covers pointer-down/refresh/pointer-up, composition events, focus and selection, draft retention, exit and recovery across shipped locales and narrow windows. Synthetic composition verifies DOM continuity; it does not prove physical operating-system IME behavior.

# Evidence

- [Retained owners](../../desktop/src/welcome/EnvironmentCards.tsx)
- [Operation and settings handoffs](../../desktop/src/welcome/App.tsx)
- [Live presence and layers](../../desktop/src/welcome/DesktopActionPopover.tsx)
- [Authority and member consent](../../desktop/src/welcome/RuntimeGatewayConnectionsDialog.tsx)
- [Production observer regressions](../../desktop/src/welcome/EnvironmentRelation.client.test.tsx)
- [Required suite manifest](../../scripts/interaction_continuity_contract.mjs)
- [Gate policy tests](../../scripts/interaction_continuity_policy.test.mjs)
- [Browser qualification](../../desktop/scripts/check-interaction-continuity.mjs)
- [Manual workflow](../../.github/workflows/interaction-continuity.yml)
