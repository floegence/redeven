---
type: UI Contract
title: Workbench composition surfaces and editing
description: Edit notes, text, and optional region names through published Floe surfaces while preserving layout content and materials.
tags: [ui, workbench, composition, editing, persistence]
timestamp: 2026-10-01T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Published Floe Webapp owns Workbench composition rendering, direct text editing, material previews, and anchored tools. Redeven owns localized copy, product defaults, and shared layout persistence. Clicking editable text preserves native caret placement, selection, and input-method composition. Region names may remain completely empty. Saving or reopening a layout must preserve content, colors, geometry, and materials; a failed database upgrade leaves the previous supported layout intact.

# Contract

## Surfaces and tools
Canvas and widget surfaces use the published matte palette across every shell preset and Workbench appearance. Redeven must not override the shared canvas, window, header, or selection colors with a competing product palette.

Responsive layout and action dimensions remain stable when adjacent nodes appear or disappear; the host adds no alternate preview or drag implementation.

## Editing
A pristine Runtime receives an English welcome canvas once, independent of interface language: two editable notes beside Files, Terminal, and Monitoring, organized by three unnamed regions. Existing layouts, including intentionally empty layouts with an advanced revision, are never reseeded.

Placeholder substitution remains owned by the shared controls; switching product language refreshes their copy.

## Persistence
`workbench_layout_runtime` schema version 6 appends the sticky-note `title` column through the contiguous 5-to-6 migration. Current request handlers always use the current schema.

Material changes participate in shared-layout equality so they trigger persistence.

# Boundaries

Published Floe owns composition editing and floating-layer mechanics.

Migration atomicity, incompatible-schema rejection, and startup failure behavior follow [database schema migration ownership](../architecture/database-schema-migrations.md). Users never need to delete their layout to receive this update.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/workbench/workbenchInitialCanvas.test.ts` - English first-run content, non-overlapping region placement, and complete-scene laptop framing.

- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/RedevenWorkbenchSurface.tsx` - Thin published-surface adapter and localized composition messages.

- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/RedevenWorkbenchSurface.composition.browser.test.tsx` - Product CSS across themes and direct localized note/region editing in Chromium.
