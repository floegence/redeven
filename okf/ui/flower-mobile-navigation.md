---
type: UI Contract
title: Flower mobile navigation
description: Keep conversations, reading, and composition usable within the mobile visible area.
tags: [ui, flower, mobile, navigation, composer]
timestamp: 2026-09-24T00:00:00Z
---
# Summary

Redeven owns Flower's mobile product navigation. Below 768 CSS pixels, the
conversation list opens in a large bottom drawer over the retained detail.
Released Floe Dialog owns placement, presence, focus containment, and motion.
Opening or closing the drawer retains the detail DOM, draft, and selection.
The covered detail is inert and cannot acknowledge reads until exit completes.
Desktop keeps its side-by-side layout.

# Contract

The bottom Flower tab enters Flower and opens its conversation drawer. Clicking
the tab again closes it; the tab remains reachable outside the surface-local
modal boundary and announces its expanded state. The chat header also opens the
drawer. Its heading, new-conversation action, and close control remain visible
above one search-and-refresh row and a separately scrolling conversation list.
The search input and refresh target are at least 44px high; the drawer does not
repeat the list title or generic sorting description. A handle, rounded
corners, scrim, and shared bottom-drawer motion distinguish navigation from the
chat content. Reduced motion follows the released presence contract.

Selecting a conversation reveals its retained detail without focusing the
composer or opening the software keyboard. Creating a conversation remains an
explicit composition action. Opening navigation focuses a button, not search;
closing restores a visible navigation trigger. Background summaries cannot
open or close the drawer. Leaving Flower closes it, and responsive transitions
retain the search and editor nodes.

Mobile welcome suggestions are task cards in two columns, with an icon above
the title and a localized suggestion heading. Initially two are visible;
More/Fewer reveals the remainder. Suggestions fill the current draft through
the existing composition action and never masquerade as conversation rows.

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

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Retains detail and thread-rail nodes, routes drawer navigation, and gates detail engagement.
- `redeven:internal/flower_ui/src/styles/flower.css` - Defines task cards, the mobile drawer, and the nonshrinking circular primary action.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.mobile.browser.test.tsx` - Checks mobile widths, draft and node retention, desktop restoration, and action geometry.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.flowerCompanion.browser.test.tsx` - Checks hidden mobile companion, full-page handoff, bottom-tab toggling, and keyboard/navigation continuity.

- `redeven:internal/envapp/ui_src/scripts/checkMobileNavigation.mjs` - Validates built, released-dependency pages in Chromium and WebKit and serves an isolated iOS acceptance fixture.
