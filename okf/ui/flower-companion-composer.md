---
type: UI Contract
title: Flower companion composer and motion
tags: [ui, flower, companion, composer, motion]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

One native Flower textarea serves collapsed entry and expanded composer, retaining draft, selection, focus and IME. Redeven owns content; published Floe owns shell motion/geometry. Expanded text precedes a bottom toolbar, with controls in More and guidance above. Phase-driven close/reversal never remounts the editor or introduces lifecycle timers.

# Contract

## Retained editor and explicit entry
The same ordinary editor moves between compact/detail presentations. Specialized decisions retain separate controls; input/approval/work priority follows [presence](flower-companion-presence.md), never converts a decision/status entry into an editor.

## Editor layout and growth
Toolbar left stays empty; permission/model/reasoning remain in More during loading/errors. Recovery/guidance sit above the editor. Short input leaves no blank space beneath the toolbar; multiline growth moves it without replacing the editor. Dedicated pages retain complete starter suggestions.

## Motion and surface treatment
One shell grows upward/outward in width and height, preserving bottom edge, border, background and clipping. Close dissolves detail before compact layout; reversal follows current phase. Exit keeps fixed coordinates and Activity height, without origin flashes. Published forced-color and focus indicators remain.

# Boundaries

This concept owns content presentation only. [Flower companion presence](flower-companion-presence.md) remains the owner of status precedence and workspace observation.

# Evidence

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Retained editor and explicit entry decisions.

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.composerFocus.browser.test.tsx` - Stable resting appearance across focus cycles in both themes and presentations, with forced-colors focus preserved.
