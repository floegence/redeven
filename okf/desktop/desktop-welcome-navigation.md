---
type: UI Contract
title: Desktop Welcome navigation
description: Switch Welcome pages immediately, retain page state, and present explicitly selected Environment Center tabs.
tags: [desktop, welcome, flower, navigation]
timestamp: 2026-09-23T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The Desktop Welcome renderer owns navigation inside its existing window. Opening
Flower or returning to Environments changes the visible page on the click without
waiting for Launcher IPC, an environment snapshot, or runtime preparation. Visited
pages retain their state. Runtime readiness and compatibility still determine
whether Flower can use its runtime; a blocked or loading runtime never prevents
returning to Environments. Explicit Environment Center tab selection presents the
destination cards with a staggered fade and rise when motion is allowed. Header
controls remain steady, and refresh or retained-page return never replay entrance
motion.

# Contract

## Navigation ownership
Local header, logo, sidebar, and contextual Flower handoff actions select the renderer page directly.

Environment health, operation progress, issue clearing, and ordinary snapshot refreshes retain that revision and cannot override local navigation. Main captures the navigation state after its asynchronous snapshot reads so an older captured destination cannot be published as a later request.

## Environment Center tab presentation
Activating a different Environments, Redeven Cloud, or Gateways tab immediately selects and renders its content.

Hiding the Environment page or disposing Welcome cancels unfinished tab motion, so returning from Flower never replays it. This presentation does not change tab state ownership or the [Environment library](desktop-environment-library.md) card stability contract.

## Retained pages
Environments and Flower mount on their first visit and remain mounted until Welcome is disposed.

Filesystem context invalidation uses only the selected environment ID, Runtime start identity, and open session key; health timestamps and probe progress are not filesystem identities.

# Boundaries

Navigation grants no runtime authority. This contract concerns the main Flower page; contextual window placement remains in [Ask Flower window boundaries](../ui/ask-flower-window.md).

# Evidence

- `redeven:desktop/src/welcome/App.tsx` - Renderer navigation and retained page visibility.

- `redeven:desktop/src/main/main.ts` - Explicit host request revision and snapshot capture.

- `redeven:desktop/src/main/desktopWelcomeState.ts` - Welcome snapshot projection.
