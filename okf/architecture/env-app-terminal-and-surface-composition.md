---
type: Frontend Contract
title: Env App terminal and surface composition
tags: [architecture, env-app, terminal, ui]
quality_exception: Cross-surface frontend composition contract spanning semantic terminal rendering, lazy boundaries, keep-alive navigation, recovery presentation, and renderer evidence.
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Env App keeps terminal and Activity/Workbench surfaces thin over published Floeterm and Floe components. A mounted view owns only its semantic projection and local interaction state; Floeterm owns PTY facts and Floe owns shell, selection, KeepAlive, focus, and layer mechanics. Lazy loading and recovery preserve those ownership boundaries while keeping existing surfaces mounted and interactive where policy allows.

# Contract

File preview surfaces carry an internal `surface` contract that defaults to `main`.

A history viewport is one atomic server snapshot with canonical width and height even when its compact payload crosses multiple transport chunks.

Floe owns the CSS contract; Redeven marks custom compound controls without duplicating focus styling.

# Boundaries

Redeven supplies product placement, permission mapping, local-path capability, and localized chrome. It must not parse terminal output, predict echo, own history or renderer state, recreate shell token/layer/focus state machines, or replace a retained surface with a second recovery curtain. Browser validation and semantic terminal carriers prove this adapter boundary; packaged Desktop evidence remains a separate gate.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalSessionRuntime.tsx` - Adapts published semantic renderer, input, history, activation, and live APIs.

- `redeven:internal/envapp/ui_src/src/ui/services/terminalTransport.ts` - Opens only `terminal/live_v1` and delegates ordering to Floeterm.

- `redeven:internal/envapp/ui_src/src/ui/services/terminalCatalogTransport.ts` - Keeps catalog/history outside the initial live renderer graph.
