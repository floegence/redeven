---
type: UI Contract
title: Workbench interaction contracts
description: Workbench wheel, text selection, and action surfaces use explicit marker props to avoid accidental canvas ownership.
tags: [ui, workbench, interaction, accessibility]
timestamp: 2026-06-17T00:00:00Z
---

Workbench input ownership is explicit. Canvas zoom, widget activation, local scrolling, text selection, and action controls must be distinguishable by marker contracts rather than inferred from hover state or incidental DOM layout.

# Mechanism

Wheel ownership uses exported local scroll viewport props that set `data-floe-canvas-wheel-interactive="true"` and a local-scroll role. Layout-only regions can declare a non-interactive wheel role. Text selection surfaces use separate marker props and do not receive wheel ownership unless combined with local scroll viewport props. Action surfaces declare their own marker so clickable controls can remain interactive inside widgets without becoming text selection surfaces. Terminal keyboard shortcuts such as panel-local search and tab switching are scoped to the owning TerminalPanel event tree; they do not create a window-level shortcut owner and do not widen wheel, selection, copy, or widget activation ownership. Terminal tab selection uses panel-local optimistic display state and an instant active-border indicator, so the selected-tab visual reaches the screen without waiting for slider measurement, parent Workbench state propagation, terminal core mount, history replay, focus restoration, RPCs, or disposal work. Terminal tab creation, first activation of an unmounted tab, and close interactions are UI-first inside the owning panel: tab selection or removal reaches the screen before terminal core mount, history replay, delete RPCs, or disposal work begins.

# Boundaries

Selected widget boundaries guard canvas zoom. A surface that supports text selection does not automatically own wheel input, and a surface that owns local scrolling must declare the exported wheel contract props. Terminal shortcuts may switch only the current panel's visible tabs and must preserve platform primary-mod behavior so terminal-native Ctrl sequences are not stolen on macOS. Terminal UI-first scheduling is a responsiveness contract only; it must not pre-mount hidden terminal tabs, move terminal shortcuts to a global listener, restore measured slider animation for terminal tab selection, or change terminal transport semantics. Delayed terminal mounts are cancelled when the user switches away before paint, so rapidly skipped tabs do not attach or replay history merely because their tab was briefly selected.

# Citations

[1] redeven:internal/envapp/ui_src/src/ui/workbench/surface/workbenchWheelInteractive.ts:1 - Wheel ownership uses a dedicated data attribute.
[2] redeven:internal/envapp/ui_src/src/ui/workbench/surface/workbenchWheelInteractive.ts:8 - Local scroll viewport props mark real local scroll regions.
[3] redeven:internal/envapp/ui_src/src/ui/workbench/surface/workbenchWheelInteractive.ts:13 - Layout-only wheel props avoid granting scroll ownership.
[4] redeven:internal/envapp/ui_src/src/ui/workbench/surface/workbenchTextSelectionSurface.ts:12 - Text selection surfaces use a separate marker attribute.
[5] redeven:internal/envapp/ui_src/src/ui/workbench/surface/workbenchTextSelectionSurface.ts:22 - Text-selection scroll viewports explicitly combine scroll and selection props.
[6] redeven:internal/envapp/ui_src/src/ui/workbench/surface/workbenchInputRouting.test.ts:51 - Tests enforce that text-selection props do not grant wheel ownership by themselves.
[7] redeven:internal/envapp/ui_src/src/ui/workbench/surface/RedevenWorkbenchSurface.interaction.test.tsx:864 - Interaction tests cover selected text-selection surfaces versus widget-body activation.
[8] redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewContent.tsx:211 - File preview content uses the combined text-selection scroll viewport props.
[9] redeven:internal/envapp/ui_src/src/ui/widgets/TerminalPanel.tsx:94 - Terminal tab shortcut bounds are local to the visible tab list.
[10] redeven:internal/envapp/ui_src/src/ui/widgets/TerminalPanel.tsx:356 - Terminal panel UI work can be deferred until after paint.
[11] redeven:internal/envapp/ui_src/src/ui/widgets/TerminalPanel.tsx:969 - Terminal history replay processes chunks in frame-bounded batches.
[12] redeven:internal/envapp/ui_src/src/ui/widgets/TerminalPanel.tsx:1848 - Terminal active display state can use panel-local optimistic selection before canonical state catches up.
[13] redeven:internal/envapp/ui_src/src/ui/widgets/TerminalPanel.tsx:1937 - First activation of an unmounted terminal session schedules mount after paint and validates the latest selection before mounting.
[14] redeven:internal/envapp/ui_src/src/ui/widgets/TerminalPanel.tsx:2879 - Terminal close hides the tab before starting delete operations.
[15] redeven:internal/envapp/ui_src/src/ui/widgets/TerminalPanel.tsx:3669 - Terminal root key handling applies panel-scoped primary-mod search and tab shortcuts.
[16] redeven:internal/envapp/ui_src/src/ui/widgets/TerminalPanel.tsx:3760 - Terminal tabs use an instant active-border indicator instead of the measured slider path.
[17] redeven:internal/envapp/ui_src/src/ui/widgets/TerminalPanel.tsx:3922 - Unmounted active terminal tabs show a panel-local loading surface before core mount.
