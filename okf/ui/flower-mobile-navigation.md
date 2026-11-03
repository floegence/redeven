---
type: UI Contract
title: Flower mobile navigation
tags: [ui, flower, mobile, navigation, composer]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Shared mobile Flower opens a bottom list drawer over retained detail. Floe owns focus/presence/motion and scroll-preserving return. Draft/selection/DOM/header remain stable; covered detail stays inert and cannot acknowledge reads until exit under the shared adaptive contract.

# Contract

The bottom Flower tab enters Flower and opens its conversation drawer.

Background summaries cannot open or close the drawer.

A later focus choice, especially returning to the composer, wins; restoration must not reclaim focus, scroll the page, or interrupt the keyboard session.

# Boundaries

The [Activity companion](flower-activity-companion.md) owns product placement. The shared [floating boundary](env-app-floating-layer-order.md) owns visible viewport geometry and safe areas.

# Evidence

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.mobile.browser.test.tsx` - Tests.
