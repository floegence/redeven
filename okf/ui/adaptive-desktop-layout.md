---
type: UI Contract
title: Adaptive desktop layout
description: Preserve desktop workflows in narrow windows while allocating temporary navigation drawers from local space.
tags: [ui, desktop, layout, navigation, accessibility]
timestamp: 2026-09-27T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-27"
---
# Summary

Redeven chooses interaction mode through released Floe layout configuration.
Native Desktop always uses desktop interaction. Browser mobile interaction
requires all three conditions: width below 768 CSS pixels, a coarse primary
pointer, and no primary hover capability. Narrow mouse windows retain Activity
and Workbench. Floe owns media-query observation, local space measurement, and
drawer placement/focus; Redeven owns navigation disclosure and content.
Automatic sidebar placement never changes saved navigation or collapse preferences.

# Contract

## One interaction mode
Desktop Welcome and Desktop-hosted Env App configure `mobileQuery: 'not all'`; the Env App recognizes its native host through the existing Desktop bridge.

Resizing a desktop browser cannot rewrite its saved Activity/Workbench choice or activate mobile terminal input.

A hidden toolbar action must retain an explicit reachable entry.

## Temporary desktop navigation
Shell, Flower conversations, Files/Git navigation, and Terminal sessions measure their own shared navigation/content region. When that region cannot fit the current sidebar width plus 480 CSS pixels of main content, the sidebar becomes a transient left side drawer.

Files/Git navigation begins with its mode switch, without a separate Files title row or reserved header space. The mobile close action shares that row; desktop drawers retain their accessible dialog title and dismissal. Sidebar resizing and local tree scrolling remain available.

Mobile navigation retains its product-specific bottom/side panel behavior under the [mobile Shell](mobile-shell-navigation.md) and [Flower](flower-mobile-navigation.md) contracts.

# Boundaries

## Flower welcome
Desktop Flower retains its mark, title, introduction, working directory, four complete starter suggestions, and keyboard hints even when the chat region is 767 CSS pixels or narrower. Container queries adjust spacing and the suggestion grid; they cannot hide content or switch interaction mode.

Narrow layouts may ellipsize selection titles; explanations remain normal prose and mobile suggestion cards retain their compact presentation.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/App.tsx` - Maps native host identity and browser capabilities into Floe configuration.

- `redeven:desktop/src/welcome/App.tsx` - Fixes Desktop Welcome to desktop interaction.

- `redeven:internal/envapp/ui_src/src/ui/mobileViewportPolicy.ts` - Defines the browser product query.

- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserWorkspace.navigation.browser.test.tsx` - Checks compact sidebar geometry, mobile dismissal, and retained navigation across inline/drawer transitions.
