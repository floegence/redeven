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

Sticky notes offer tint, tab, and ruled materials with six colors, including graphite. Notes expose an editable body, an optional editable title, and a dedicated drag handle. Existing body-only notes keep their title absent. They do not show an uneditable metadata strip. Regions offer color field, outline, hatch, dots, grid, and wash materials; existing stored materials retain their identity. Newly created regions use solid fill at 0.72 opacity. Palette previews share the actual object’s theme-aware colors. Compact material thumbnails emphasize pattern contrast and density so hatch, dots, grid, and wash remain distinct at small sizes; they contain no miniature widget decorations.

Selected-object tools stay anchored to the object during movement and viewport changes. The published local floating layer owns projection, clamping, and above/below placement. Tools keep a readable screen size and hide when their object leaves the visible canvas. Compact material and emoji menus use one mutually exclusive popup, measured before it becomes visible, without resizing the toolbar. Region and text drag handles sit outside the left edge. Position updates are driven by geometry or viewport changes and resize observation, without continuous idle polling. Materials use fills, borders, and static patterns rather than animated filters.

## Editing

A pristine Runtime receives a localized welcome canvas once: two editable notes beside Files, Terminal, and Monitoring, organized by three unnamed regions. Preset windows reserve room for file navigation, terminal sessions, and monitoring content; their sizes do not change catalog Add sizes. Existing layouts, including intentionally empty layouts with an advanced revision, are never reseeded. Welcome copy becomes user content after creation. Overview includes notes, text, and regions as well as windows, with extra bottom padding for the Dock and a bounded scale that fits the complete scene while retaining useful widget content dimensions.

Work mode edits sticky notes and business widgets. Composition mode edits only canvas text and regions; sticky notes and widget subtrees become dimmed and inert, preserving their state while blocking editing, dragging, and keyboard actions. Switching modes commits an active text draft. Editable text accepts a direct click, dragging selects text, and moving objects uses the designated handles or region surface. Entering an editor never pans or zooms the canvas. Text and its editor scale together with the canvas while tools keep a readable screen size. [Input ownership](workbench-input-ownership.md) remains authoritative for canvas and local scrolling.

Region names are optional. Clearing the name produces a plain region, with no placeholder text forced into saved content. The selected region exposes Add name when blank and Clear name in its material menu. Clearing the name closes the popup before the toolbar moves, so reopening uses its new anchor. Add name places focus in the actual editor. Blank note bodies and canvas text also remain blank after persistence.

Editing uses one transaction. Escape, clicking outside the field, blur, or Ctrl/Cmd+Enter commits automatically; Enter also commits a region name. No explicit editing/Done state remains in the toolbar. Native caret placement, drag selection, and IME composition remain intact, including blur before compositionend. Toolbar actions and canvas transforms use the shared editor lifecycle rather than host-side focus hacks. Each text field supports the shared emoji picker, preserving its caret or selected range and native undo. For a sticky note, insertion targets the last focused title or body. Escape closes an open picker first; the next Escape finishes editing. Input focus changes only the existing boundary color.

All composition controls, accessible labels, material names, and color names come from the complete Redeven locale catalog through Floe's composition message contract. Placeholder substitution remains owned by the shared controls; switching product language refreshes their copy.

## Persistence

`workbench_layout_runtime` schema version 6 appends the sticky-note `title` column through the contiguous 5-to-6 migration. Existing notes receive an empty title, omitted from API output so body-only notes remain valid. The 4-to-5 material migration and all earlier edges remain in the chain; the historical v3 note reader explicitly supplies the absent material and title fields. Title-only edits participate in shared-layout equality and produce persistence updates. Historical source shapes are validated through the shared read-only preflight before writable startup, and each migration verifies its source and target inside the transaction. Current request handlers always use the current schema.

The migration retains existing layout revisions, widget states, content, timestamps, region styles, and event payloads. Empty names and text are valid product content. The Runtime admits all published sticky colors and materials, including graphite and frame regions, and the UI layout adapter preserves them across projection and writeback. Material changes participate in shared-layout equality so they trigger persistence.

# Boundaries

Published Floe owns composition editing and floating-layer mechanics. Redeven
adapts localization and persistence without replacing those shared mechanics.
Business-widget input continues to follow the [input ownership contract](workbench-input-ownership.md).

Migration atomicity, incompatible-schema rejection, and startup failure behavior follow [database schema migration ownership](../architecture/database-schema-migrations.md). Users never need to delete their layout to receive this update.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/workbench/workbenchInitialCanvas.test.ts` - Localized first-run content, non-overlapping region placement, and complete-scene laptop framing.
- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/RedevenWorkbenchSurface.tsx` - Thin published-surface adapter and localized composition messages.
- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/RedevenWorkbenchSurface.composition.browser.test.tsx` - Product CSS across themes and direct localized note/region editing in Chromium.
- `redeven:internal/envapp/ui_src/src/ui/workbench/runtimeWorkbenchLayout.test.ts` - Material-aware equality and blank-content projection round trip.
- `redeven:internal/workbenchlayout/schema.go` - Contiguous schema upgrade and historical migration read boundary.
- `redeven:internal/workbenchlayout/composition_test.go` - Persistence, migration preservation, rollback, drift rejection, and repeated open behavior.
- `redeven:internal/workbenchlayout/sticky_title_test.go` - Version 5 migration, title-only save and clearing across reopen, rollback, and byte-preserving rejection of source/target schema drift.
