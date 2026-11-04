---
type: UI Contract
title: Flower companion composer and motion
tags: [ui, flower, companion, composer, motion]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

One native textarea survives collapsed/expanded Flower with draft, selection, focus and IME intact. Redeven owns content; Floe shell geometry/motion. Expanded text sits above bottom toolbar/More; phase-driven close/reversal never remounts or adds lifecycle timers.

# Contract

Settings recovery stays inside the collapsed row, with a reachable Retry and unchanged height. It replaces compact summary copy until recovery; active Stop remains available. The published shell cannot clip recovery outside its bounds. Expanded recovery uses the existing floating notice stack.

## Retained editor and explicit entry
The same ordinary editor moves between compact/detail presentations. Specialized decisions retain separate controls; input/approval/work priority follows [presence](flower-companion-presence.md), never converts a decision/status entry into an editor.

## Editor layout and growth
Toolbar left stays empty; permission/model/reasoning remain in More during loading/errors. Recovery/guidance sit above the editor. Short input leaves no blank space beneath the toolbar; multiline growth moves it without replacing the editor. Dedicated pages retain complete starter suggestions.

## Motion and surface treatment
One shell grows upward/outward in width and height, preserving bottom edge, border, background and clipping. Close dissolves detail before compact layout; reversal follows current phase. Exit keeps fixed coordinates and Activity height, without origin flashes. Published forced-color and focus indicators remain. Composer disclosures follow [shared surface material](surface-material.md): portaled nested menus retain More ownership, Escape returns focus one level at a time, and exits stop accepting input immediately. Collapsed content uses only its compact composer inset; transcript/activity gutters apply to expanded content and cannot push the entry icon away from the left edge.

# Boundaries

This concept owns content presentation only. [Flower companion presence](flower-companion-presence.md) remains the owner of status precedence and workspace observation.

# Evidence

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.composerFocus.browser.test.tsx` - Tests.
