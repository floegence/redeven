---
type: UI Contract
title: Workbench composition surfaces and editing
description: Edit notes, text, and optional region names through published Floe surfaces while preserving layout content and materials.
tags: [ui, workbench, composition, editing, persistence]
timestamp: 2026-09-17T00:00:00Z
---
# Summary

Published Floe Webapp owns Workbench composition rendering, direct text editing, material previews, and anchored tools. Redeven owns localized copy, product defaults, and shared layout persistence. Clicking editable text preserves native caret placement, selection, and input-method composition. Region names may remain completely empty. Saving or reopening a layout must preserve content, colors, geometry, and materials; a failed database upgrade leaves the previous supported layout intact.

# Contract

## Surfaces and tools

Canvas and widget surfaces use the published matte palette across every shell preset and Workbench appearance. Redeven must not override the shared canvas, window, header, or selection colors with a competing product palette. Product widget bodies keep their own semantic surface roles. Window boundaries remain neutral without glow or backdrop blur.

Sticky notes offer tint, tab, and ruled materials with six colors, including graphite. Notes expose one editable body and a dedicated drag handle. They do not show an uneditable title or metadata strip. Regions offer color field, outline, hatch, dots, grid, and wash materials; existing stored materials retain their identity. Newly created regions use solid fill at 0.72 opacity. Palette and material previews derive from the same theme-aware surface renderer as the actual object.

Selected-object tools stay anchored to the object during movement and viewport changes. The published local floating layer owns projection, clamping, and above/below placement. Tools keep a readable screen size and hide when their object leaves the visible canvas. Position updates are driven by geometry or viewport changes and resize observation, without continuous idle polling. Materials use fills, borders, and static patterns rather than animated filters.

## Editing

In composition mode, note bodies, canvas text, and visible region names accept a direct click for editing. Business widgets keep their existing input boundary. Dragging text selects text; moving objects uses their designated handles or region surface. Small objects in overview are brought to a readable editing scale. [Input ownership](workbench-input-ownership.md) remains authoritative for canvas and local scrolling.

Region names are optional. Clearing the name produces a plain region, with no placeholder text forced into saved content. The selected region exposes Add name, Edit name, and Clear name actions as appropriate. Add name places focus in the actual editor. Blank note bodies and canvas text also remain blank after persistence.

Editing uses one transaction. Blur or Ctrl/Cmd+Enter commits; Enter also commits a region name. Escape cancels the current draft. Native caret placement, drag selection, and IME composition remain intact, including blur before compositionend. Toolbar actions and canvas transforms use the shared editor lifecycle rather than host-side focus hacks. Input focus changes only the existing boundary color.

All composition controls, accessible labels, material names, and color names come from the complete Redeven locale catalog through Floe's composition message contract. Placeholder substitution remains owned by the shared controls; switching product language refreshes their copy.

## Persistence

`workbench_layout_runtime` schema version 5 appends the sticky-note `material` column through the contiguous 4-to-5 migration. Existing notes receive `tint`. Earlier migrations, including removal of the retired Codex widget, remain in the chain; the historical v3 note reader used by that migration explicitly reads the pre-material shape. Current request handlers always use the current schema.

The migration retains existing layout revisions, widget states, content, timestamps, region styles, and event payloads. Empty names and text are valid product content. The Runtime admits all published sticky colors and materials, including graphite and frame regions, and the UI layout adapter preserves them across projection and writeback. Material changes participate in shared-layout equality so they trigger persistence.

# Boundaries

Published Floe owns composition editing and floating-layer mechanics. Redeven
adapts localization and persistence without replacing those shared mechanics.
Business-widget input continues to follow the [input ownership contract](workbench-input-ownership.md).

Migration atomicity, incompatible-schema rejection, and startup failure behavior follow [database schema migration ownership](../architecture/database-schema-migrations.md). Users never need to delete their layout to receive this update.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/RedevenWorkbenchSurface.tsx` - Thin published-surface adapter and localized composition messages.
- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/RedevenWorkbenchSurface.composition.browser.test.tsx` - Product CSS across themes and direct localized note/region editing in Chromium.
- `redeven:internal/envapp/ui_src/src/ui/workbench/runtimeWorkbenchLayout.test.ts` - Material-aware equality and blank-content projection round trip.
- `redeven:internal/workbenchlayout/schema.go` - Contiguous schema upgrade and historical migration read boundary.
- `redeven:internal/workbenchlayout/composition_test.go` - Persistence, migration preservation, rollback, drift rejection, and repeated open behavior.
