---
type: UI Contract
title: Flower companion composer and motion
description: Preserve one native editor while placing tools below text and dissolving detail into the compact companion entry.
tags: [ui, flower, companion, composer, motion]
timestamp: 2026-10-16T08:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns the Flower companion content presentation; released Floe owns its shell geometry and motion phases. One native composer retains its draft, selection, focus and IME through every presentation change. Expanded text sits above a bottom toolbar whose left side stays empty; permission, model and reasoning remain in More during loading and model failures. Guidance and recovery actions sit above the editor rather than competing with toolbar space. Closing detail dissolves before the compact layout appears, and reversal follows the current shell phase without remounting an editor or adding lifecycle timers. Specialized decisions retain their controls. [Flower Activity companion](flower-activity-companion.md) owns placement, dismissal, focus handoffs and read acknowledgement.

# Contract

## Retained editor and explicit entry
The ordinary Flower composer textarea is literally the collapsed floating field and the expanded detail composer.

Answer mode and progress never change this entry into an editor.

Pending input, approval, and active-work summary precedence remains unchanged.

## Editor layout and growth
Expanded companion presentation keeps one stable ordinary chat composer. Short input must not leave unused space below that toolbar; multiline growth moves the toolbar down without changing editor identity.

The dedicated Flower page retains the complete starter suggestion grid and its prompt-to-composer actions.

## Motion and surface treatment
Opening animates the width and height of one shell together, growing upward and outward from the compact entry while preserving its bottom edge and continuous border, background, and clipping boundary. It never clears fixed coordinates during exit, never flashes at the viewport origin, and never changes Activity body height.

Forced colors and toolbar keyboard focus keep their published indicators.

# Boundaries

This concept owns content presentation only. [Flower companion presence](flower-companion-presence.md) remains the owner of status precedence and workspace observation.

# Evidence

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Retained editor and explicit entry decisions.

- `redeven:internal/flower_ui/src/styles/flower.css` - Compact content isolation and expanded text/toolbar layout.

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.composerFocus.browser.test.tsx` - Stable resting appearance across focus cycles in both themes and presentations, with forced-colors focus preserved.
