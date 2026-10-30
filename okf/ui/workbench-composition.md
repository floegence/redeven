---
type: UI Contract
title: Workbench composition surfaces and editing
tags: [ui, workbench, composition, editing, persistence]
lifecycle: contract
reviewed_at: "2026-10-30"
---
# Summary

Published Floe owns composition rendering, direct editing, materials and anchored tools; Redeven owns localization, defaults and layout persistence. Native caret, selection and IME remain intact, with optional empty region names. Save/reopen preserves content, color, geometry and material; failed upgrades retain the prior supported layout.

# Contract

## Surfaces and tools
Published matte palettes own canvas/widget/header/selection colors across themes. Product adapters add no competing palette, preview or drag engine; adjacent-node changes retain responsive action geometry.

The published dark canvas uses a 0.21 OKLCH lightness floor. Porcelain Dark
renders #181819 around the retained #0C0C0D product body, including overview
zoom. Widget headers, borders, shadows, grid and light canvases retain their
existing palette and geometry.

## Editing
Pristine runtimes receive one English welcome canvas: two editable notes beside Files, Terminal and Monitoring in three unnamed regions. Existing layouts, including intentionally empty advanced revisions, never reseed. Published controls own placeholders; locale changes update copy.

## Persistence
`workbench_layout_runtime` schema v6 appends sticky-note title through contiguous 5→6 migration. Handlers use current schema; material equality changes trigger persistence.

# Boundaries

Published Floe owns composition editing and floating-layer mechanics.

Migration atomicity, incompatible-schema rejection, and startup failure behavior follow [database schema migration ownership](../architecture/database-schema-migrations.md). Users never need to delete their layout to receive this update.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/RedevenWorkbenchSurface.composition.browser.test.tsx` - Published canvas/body colors at 35% and 100% zoom, shell palettes, localized editing and accessibility.

- `redeven:internal/envapp/ui_src/src/ui/workbench/workbenchInitialCanvas.test.ts` - English first-run content, non-overlapping region placement, and complete-scene laptop framing.

- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/RedevenWorkbenchSurface.tsx` - Thin published-surface adapter and localized composition messages.
