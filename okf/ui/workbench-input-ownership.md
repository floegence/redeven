---
type: UI Contract
title: Workbench input ownership
description: Wheel, pointer, local-scroll, and text-selection ownership.
tags: [ui, workbench, interaction, accessibility]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Workbench input ownership is declared through explicit marker contracts so canvas zoom, local scrolling, pointer actions, and text selection remain distinguishable. A selected widget boundary does not automatically own wheel input, and local-scroll regions must declare their role rather than relying on incidental DOM structure. These contracts let the canvas remain predictable while nested product surfaces preserve native interaction.

# Contract

## Mechanism
Wheel ownership uses exported local scroll viewport props that set `data-floe-canvas-wheel-interactive="true"` and a local-scroll role. Text selection surfaces use separate marker props and do not receive wheel ownership unless combined with local scroll viewport props.

Fit and actual-size actions reset the scale deterministically, while Ctrl/Cmd-wheel and keyboard `+`, `-`, `0`, and `1` remain scoped to the image viewport.

# Boundaries

Selected widget boundaries guard canvas zoom. A surface that supports text selection does not automatically own wheel input, and a surface that owns local scrolling must declare the exported wheel contract props.

Components embedded in projected Workbench surfaces must use the shared floating layer rather than hand-rolling viewport-to-surface coordinates.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/workbenchWheelInteractive.ts:1` - Wheel ownership uses a dedicated data attribute.

- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/workbenchTextSelectionSurface.ts:12` - Text selection surfaces use a separate marker attribute.

- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/workbenchInputRouting.test.ts:51` - Tests enforce that text-selection props do not grant wheel ownership by themselves.
