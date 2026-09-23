---
type: UI Contract
title: Flower mobile navigation
description: Keep conversations, reading, and composition usable within the mobile visible area.
tags: [ui, flower, mobile, navigation, composer]
timestamp: 2026-09-23T00:00:00Z
---
# Summary

Redeven owns Flower's mobile product layout. Below 768 CSS pixels, the full
Flower page shows either the conversation list or the current detail across the
available height. Switching panes retains the detail DOM, draft, and selection.
The hidden pane cannot receive pointer, keyboard, or accessibility input, and
hidden details cannot acknowledge reads. Desktop keeps its side-by-side layout.

# Contract

The chat header opens the conversation list. The list can return to the retained
chat, select another conversation, or start a new one. Selecting or creating a
conversation opens its detail; background summary updates do not change panes.
Pane controls have localized accessible names and transfer focus to visible
navigation controls without opening the software keyboard. List and transcript
content scroll inside their own constrained areas.

The composer primary action retains a 36 CSS pixel circular shape, including
disabled, send, stop, and loading states. Responsive footer controls must not
override its width or shrink it into an icon-width strip. Existing upstream
button keyboard, loading, and disabled semantics remain authoritative.
Mobile composer, conversation search, and contextual launcher text fields use
at least 16 CSS pixels so Safari focus does not zoom the page or change its
visible width. Explicit host settings navigation reveals the detail pane.

# Boundaries

The [Activity companion](flower-activity-companion.md) owns product placement.
Mobile has no permanent Ask Flower field or reserved accessory row. The bottom
Flower tab and explicit contextual Ask Flower actions enter the full page; other
pages retain their available content area, including terminal keyboard space.
The shared [floating boundary](env-app-floating-layer-order.md) owns visible
viewport geometry and safe areas.

# Evidence

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Retains the two panes, routes explicit navigation, and gates detail engagement.
- `redeven:internal/flower_ui/src/styles/flower.css` - Defines the single-pane layout and nonshrinking circular primary action.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.mobile.browser.test.tsx` - Checks mobile widths, draft and node retention, desktop restoration, and action geometry.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.flowerCompanion.browser.test.tsx` - Checks hidden mobile companion, full-page handoff, and keyboard/navigation continuity.
