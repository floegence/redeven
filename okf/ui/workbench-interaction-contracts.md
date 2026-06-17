---
type: UI Contract
title: Workbench interaction contracts
description: Workbench wheel, text selection, and action surfaces use explicit marker props to avoid accidental canvas ownership.
tags: [ui, workbench, interaction, accessibility]
timestamp: 2026-06-17T00:00:00Z
---

Workbench input ownership is explicit. Canvas zoom, widget activation, local scrolling, text selection, and action controls must be distinguishable by marker contracts rather than inferred from hover state or incidental DOM layout.

# Mechanism

Wheel ownership uses exported local scroll viewport props that set `data-floe-canvas-wheel-interactive="true"` and a local-scroll role. Layout-only regions can declare a non-interactive wheel role. Text selection surfaces use separate marker props and do not receive wheel ownership unless combined with local scroll viewport props. Action surfaces declare their own marker so clickable controls can remain interactive inside widgets without becoming text selection surfaces.

# Boundaries

Selected widget boundaries guard canvas zoom. A surface that supports text selection does not automatically own wheel input, and a surface that owns local scrolling must declare the exported wheel contract props.

# Citations

[1] redeven:internal/envapp/ui_src/src/ui/workbench/surface/workbenchWheelInteractive.ts:1 - Wheel ownership uses a dedicated data attribute.
[2] redeven:internal/envapp/ui_src/src/ui/workbench/surface/workbenchWheelInteractive.ts:8 - Local scroll viewport props mark real local scroll regions.
[3] redeven:internal/envapp/ui_src/src/ui/workbench/surface/workbenchWheelInteractive.ts:13 - Layout-only wheel props avoid granting scroll ownership.
[4] redeven:internal/envapp/ui_src/src/ui/workbench/surface/workbenchTextSelectionSurface.ts:12 - Text selection surfaces use a separate marker attribute.
[5] redeven:internal/envapp/ui_src/src/ui/workbench/surface/workbenchTextSelectionSurface.ts:22 - Text-selection scroll viewports explicitly combine scroll and selection props.
[6] redeven:internal/envapp/ui_src/src/ui/workbench/surface/workbenchInputRouting.test.ts:51 - Tests enforce that text-selection props do not grant wheel ownership by themselves.
[7] redeven:internal/envapp/ui_src/src/ui/workbench/surface/RedevenWorkbenchSurface.interaction.test.tsx:864 - Interaction tests cover selected text-selection surfaces versus widget-body activation.
[8] redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewContent.tsx:211 - File preview content uses the combined text-selection scroll viewport props.
