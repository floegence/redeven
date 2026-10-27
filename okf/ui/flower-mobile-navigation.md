---
type: UI Contract
title: Flower mobile navigation
description: Keep conversations, reading, and composition usable within the mobile visible area.
tags: [ui, flower, mobile, navigation, composer]
timestamp: 2026-09-24T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

In shared mobile mode, Flower opens its list in a large bottom drawer over retained detail. Floe owns presence/focus/motion and scroll-preserving focus return. Keep draft/selection/DOM and stationary detail/header throughout animation. Covered detail is inert and cannot acknowledge reads until exit. Desktop uses the same adaptive-layout contract.

# Contract

The bottom Flower tab enters Flower and opens its conversation drawer.

Background summaries cannot open or close the drawer.

A later focus choice, especially returning to the composer, wins; restoration must not reclaim focus, scroll the page, or interrupt the keyboard session.

# Boundaries

The [Activity companion](flower-activity-companion.md) owns product placement. The shared [floating boundary](env-app-floating-layer-order.md) owns visible viewport geometry and safe areas.

# Evidence

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Retains detail and thread-rail nodes, routes drawer navigation, and gates detail engagement.

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.mobile.browser.test.tsx` - Checks mobile widths, draft and node retention, desktop restoration, and action geometry.
