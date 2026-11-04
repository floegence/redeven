---
type: UI Contract
title: Workbench composition, input and surface lifetime
tags: [ui, workbench, composition, editing, persistence]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Published Floe owns canvas composition and generic input mechanics; Redeven supplies permission, persistence and selected-widget adapters. Explicit wheel and text-selection contracts stay separate. Lazy module delivery preserves the mounted canvas and never creates another lifecycle or eagerly initializes inactive features.

# Contract

## Composition
Published matte palettes own canvas/widget/header/selection colors. Product adapters add no palette, preview or drag engine; adjacent-node changes retain responsive actions. Dark canvas has a 0.21 OKLCH lightness floor: Porcelain Dark uses #181819 around #0C0C0D body, including overview zoom; headers/borders/shadows/grid/light canvases retain palette/geometry.

Pristine runtimes receive one English welcome canvas: two editable notes beside Files, Terminal and Monitoring in three unnamed regions. Existing layouts, including intentionally empty advanced revisions, never reseed. Published controls own placeholders; locale changes update copy.

`workbench_layout_runtime` schema v6 appends sticky-note title via contiguous 5→6 migration. Handlers use current schema and persist material changes.

## Input ownership
Exported local-scroll viewport props declare `data-floe-canvas-wheel-interactive="true"` and a local-scroll role. Text-selection markers are separate and grant no wheel ownership unless combined with those props. Selected-widget boundaries guard canvas zoom. Image fit/actual-size reset deterministically; Ctrl/Cmd-wheel and keyboard `+`, `-`, `0`, `1` stay image-viewport scoped.

## Surface lifetime
Selection/loading/recovery retain widget identity. Floe owns Dock focus; selected Terminal viewports own wheel without DOM focus, unselected viewports remain canvas-owned. Shared recovery overlays make retained content inert without a visibility store.

[Page loading](page-loading-continuity.md#page-continuity) supplies per-widget Suspense/initial presentation while the canvas stays mounted; [Activity companion](flower-activity-companion.md#companion) owns retained Flower placement. Lazy delivery adds no lifecycle and cannot pre-mount inactive features or initialize Flower providers eagerly.

## Integration boundary
Projected widgets use the shared floating layer, never handmade viewport-to-surface coordinates or incidental DOM to infer canvas/input/recovery/focus/overlay ownership. Published Floeterm and floe-webapp own generic mechanisms.

# Boundaries

Published Floe owns composition editing/floating mechanics. [Database migrations](../architecture/database-schema-migrations.md) owns atomicity, incompatible-schema rejection and startup failure; users never delete layouts to upgrade.

Lazy loading cannot weaken permissions, restoration, input or recovery. Only shell recovery snapshots may suspend the Workbench interaction tree. After terminal failure the retained canvas has no read/write interaction until a new Desktop session opens.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/RedevenWorkbenchSurface.composition.browser.test.tsx` - Published 35%/100% canvas colors, themes, localization/accessibility.
- `redeven:internal/envapp/ui_src/src/ui/workbench/workbenchInitialCanvas.test.ts` - Tests.
- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/RedevenWorkbenchSurface.tsx` - Source.

- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/workbenchWheelInteractive.ts:1` - Source.
- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/workbenchInputRouting.test.ts:51` - Tests.

- `redeven:internal/envapp/ui_src/src/ui/workbench/EnvWorkbenchPage.test.tsx:2806` - Tests.
- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/workbenchInputRouting.ts:241` - Source.
