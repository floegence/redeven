---
type: Interaction Contract
title: Desktop interaction continuity
tags: [desktop, interaction, accessibility, testing]
lifecycle: contract
reviewed_at: "2026-11-08"
---
# Summary

Welcome owns interaction sessions; Launcher/Runtime own business operations. Before the first asynchronous submission, one synchronous transition records the attempt, closes its menu and opens its operation surface. The interaction-continuity package command runs required state and real component suites, including the production snapshot subscription and observer.

# Contract

## Ownership and observations
Each interaction field has one owner: the existing library overlay, guidance, lifecycle disclosure, Gateway foreground action or settings opening. Retained cards supply presentation only; submission reads current authoritative data.

Addresses no longer shareable still lose QR disclosure under the connection-security contract.

Duplicate activation cannot submit twice.

Deferred initial focus never overrides a user-selected menu item.

The cached commit group runs affected staged sources; bounded integration checks affected base-to-tip paths.

Synthetic composition verifies DOM continuity; it does not prove physical operating-system IME behavior.

## Native edit context menus
Desktop-owned BrowserWindows attach a localized native edit menu for unhandled Chromium context requests. Editable surfaces expose Undo, Redo, Cut, Copy, Paste and Select all with Chromium edit flags; reading selections expose Copy. Native roles preserve the originating frame, selection, undo stack and the existing paste event path (including Flower attachment handling). No renderer clipboard-read bridge is introduced. Renderer-owned menus prevent the native fallback, so conversation/file/terminal menus remain authoritative. Navigation and window close dismiss pending native menus. Browser-hosted editors retain their browser-native menu.

# Boundaries

Settings adapters capture exact environment ID and Runtime start timestamp. Native admission rejects stopped, replaced or restarted targets before dispatch; explicit settings reads never start them. Contextual browser adapters capture again only on a fresh opening.

## Layers, exit and recovery
Published presence and overlay ownership provide one exit and input-routing lifecycle.

Failure, permission loss, cancellation failure and missing progress retain an exit or recovery action. Closing never infers cancellation.

# Evidence

- [Retained owners](../../desktop/src/welcome/EnvironmentCards.tsx)

- [Live presence and layers](../../desktop/src/welcome/DesktopActionPopover.tsx)
