---
type: Frontend Contract
title: Env App terminal and surface composition
tags: [architecture, env-app, terminal, ui]
quality_exception: Cross-surface frontend composition contract spanning semantic terminal rendering, lazy boundaries, keep-alive navigation, recovery presentation, and renderer evidence.
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Env App adapts published Floeterm/Floe. Views own projection and local interaction; Floeterm owns PTY facts, Floe owns shell, selection, KeepAlive, focus and layers. Loading/recovery preserve these boundaries and retain interactive surfaces where allowed.

# Contract

File preview surfaces carry an internal `surface` contract that defaults to `main`.

A history viewport is one atomic server snapshot with canonical width and height even when its compact payload crosses multiple transport chunks.

Floe owns the CSS contract; Redeven marks custom compound controls without duplicating focus styling.

## Terminal workspace placement

Published Floe SplitWorkspace owns recursive splits, presets, edge docking, center swaps and pointer/keyboard resizing. Redeven owns localized controls and the environment/panel-scoped v1 layout record. Validate saved trees and reconcile only after catalog hydration. Selecting another split member focuses it and restores a maximized layout. Selecting an unplaced session shows it alone without rewriting the saved split; selecting a member restores that split. Closing a pane preserves its session. Explicit splitting creates a session in the target group using its verified local cwd or group startup directory; dragging places an existing session. Group, cwd and placement remain independent.

Desktop starts at pane headers. The sidebar footer retains presets, search, clear, settings and creation; groups retain scoped creation. Overlays keep their toolbar/drawer trigger. Maximize changes to restore; docking restores splits.

Runtime nodes stay keyed by session ID across layout changes. Visible panes paint independently; active session alone owns keyboard input, search and toolbar commands. Mobile shows the active pane and pane tabs without changing the saved desktop tree. Maximize is transient. Alt+Shift+Left/Right cycles placed panes.

Pane headers, dividers, overlay toolbar and status footer use the terminal theme; the sidebar uses the shell theme. Prehydrated catalog snapshots initialize placement before reconciliation, preventing reload from pruning saved splits against an empty list. Resize controls retain keyboard focus.

# Boundaries

Redeven supplies placement, permissions, local-path capability and localized chrome. It must not parse output, predict echo, own history/renderer state, recreate shell token/layer/focus machinery, or overlay a retained surface with duplicate recovery. Browser/semantic carriers verify this boundary; packaged Desktop qualification is separate.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalSessionRuntime.tsx` - Published terminal semantic/input/history/live adapter.

- `redeven:internal/envapp/ui_src/src/ui/services/terminalTransport.ts` - Opens only `terminal/live_v1` and delegates ordering to Floeterm.

- `redeven:internal/envapp/ui_src/src/ui/services/terminalCatalogTransport.ts` - Keeps catalog/history outside the initial live renderer graph.

- `redeven:internal/envapp/ui_src/scripts/checkTerminalWorkspace.mjs` - Real PTY group moves, docking, retained runtime identity, mobile layout and reload.
