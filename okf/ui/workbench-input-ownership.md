---
type: UI Contract
title: Workbench input ownership
tags: [ui, workbench, interaction, accessibility]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Explicit markers distinguish canvas zoom, local scroll, pointer actions and text selection. Selected widgets do not automatically own wheel input; regions declare their role. Workbench preserves predictable canvas behavior alongside native nested product interactions.

# Contract

## Mechanism
Wheel ownership uses exported local scroll viewport props that set `data-floe-canvas-wheel-interactive="true"` and a local-scroll role. Text selection surfaces use separate marker props and do not receive wheel ownership unless combined with local scroll viewport props.

Fit and actual-size actions reset the scale deterministically, while Ctrl/Cmd-wheel and keyboard `+`, `-`, `0`, and `1` remain scoped to the image viewport.

# Boundaries

Selected widget boundaries guard canvas zoom. A surface that supports text selection does not automatically own wheel input, and a surface that owns local scrolling must declare the exported wheel contract props.

Components embedded in projected Workbench surfaces must use the shared floating layer rather than hand-rolling viewport-to-surface coordinates.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/workbenchWheelInteractive.ts:1` - Source.
- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/workbenchInputRouting.test.ts:51` - Tests.
