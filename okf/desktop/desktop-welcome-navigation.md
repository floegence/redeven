---
type: UI Contract
title: Desktop Welcome navigation
description: Switch Welcome pages immediately, retain page state, and present explicitly selected Environment Center tabs.
tags: [desktop, welcome, flower, navigation]
timestamp: 2026-09-23T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-26"
---
# Summary

Welcome owns immediate local page selection. Flower/Environments navigation never waits for Launcher IPC, snapshots or Runtime preparation; visited pages retain state. Runtime readiness still gates Flower requests without blocking return navigation. Explicit Environment Center tab changes may animate destination cards, while refresh and retained-page return preserve stable headers and never replay entrance motion.

# Contract

- Header, logo, sidebar and contextual actions select locally. Health/progress/snapshot updates cannot override navigation. Main captures navigation after asynchronous reads so stale destinations cannot publish newer revisions.
- Selecting Environments, Redeven Cloud or Gateways renders immediately. Hiding/disposing cancels motion; return does not replay it. [Environment library](desktop-environment-library.md) retains card/state ownership.
- Environments and Flower mount on first visit and remain mounted until disposal. Filesystem invalidation uses environment ID, Runtime start identity and session key, never health/probe timestamps.

- Gateway management retains this shell and its search/filter state. Overview, Environments, Access and Settings belong only to a selected Gateway modal. Enrollment replaces that layer and returns to its retained context; it does not introduce a separate workspace or navigation rail.

# Boundaries

Navigation grants no Runtime authority. [Ask Flower windows](../ui/ask-flower-window.md) owns contextual placement.

# Evidence

- `redeven:desktop/src/welcome/App.tsx` - Renderer navigation and retained page visibility.

- `redeven:desktop/src/main/main.ts` - Explicit host request revision and snapshot capture.

- `redeven:desktop/src/main/desktopWelcomeState.ts` - Welcome snapshot projection.
