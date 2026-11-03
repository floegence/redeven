---
type: UI Contract
title: Desktop Welcome navigation
tags: [desktop, welcome, flower, navigation]
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

Welcome page selection is immediate and independent of Launcher IPC or Runtime preparation. Visited pages retain state; readiness gates Flower requests, not navigation. Explicit Environment tab changes may animate cards, while refresh/return preserves headers and skips entrance replay.

# Contract

- Header, logo, sidebar and contextual actions select locally. Health/progress/snapshot updates cannot override navigation. Main captures navigation after asynchronous reads so stale destinations cannot publish newer revisions.
- Selecting Environments, Redeven Cloud or Gateways renders immediately. Hiding/disposing cancels motion; return does not replay it. [Environment library](desktop-environment-library.md) retains card/state ownership.
- Environments and Flower mount on first visit and remain mounted until disposal. Filesystem invalidation uses environment ID, Runtime start identity and session key, never health/probe timestamps.

- Gateway management is an in-shell detail page. Returning to All Gateways restores list search, filter, scroll and focus. [Gateway Desktop interactions](../gateway/gateway-desktop-interactions.md) owns its sections, enrollment dialogs and recovery behavior; global navigation preserves the retained management context.

# Boundaries

Navigation grants no Runtime authority. [Ask Flower windows](../ui/ask-flower-window.md) owns contextual placement.

# Evidence

- `redeven:desktop/src/welcome/App.tsx` - Source.
- `redeven:desktop/src/main/desktopWelcomeState.ts` - Source.
