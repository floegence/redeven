---
type: UI Contract
title: Adaptive desktop layout
description: Preserve desktop workflows in narrow windows while allocating temporary navigation drawers from local space.
tags: [ui, desktop, layout, navigation, accessibility]
timestamp: 2026-09-27T00:00:00Z
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

Desktop Welcome and Desktop-hosted Env App configure `mobileQuery: 'not all'`;
the Env App recognizes its native host through the existing Desktop bridge.
Browser Env App configures `(max-width: 767px) and (pointer: coarse) and (hover: none)`.
User agent strings, recent clicks, and individual content widths are not device
classifiers. Mixed-input devices follow their reported primary capabilities.

The released LayoutProvider owns synchronous initialization, media-query changes,
and cleanup even without a Shell. Shell, Flower, Notes, floating windows, and
terminal interaction consume this authority. Standalone Flower uses the released
configured layout accessor. Resizing a desktop browser cannot rewrite its saved
Activity/Workbench choice or activate mobile terminal input.

Column counts, wrapping, local scroll, menu bounds, and touch target sizes may
still adapt to actual space and input capabilities. A hidden toolbar action must
retain an explicit reachable entry.

## Temporary desktop navigation

Shell, Flower conversations, Files/Git navigation, and Terminal sessions measure
their own shared navigation/content region. Shell first excludes the activity
rail. When that region cannot fit the current sidebar width plus 480 CSS pixels
of main content, the sidebar becomes a transient left side drawer. Its width is
at most the region width minus 48 CSS pixels. An existing header or activity
navigation control opens it. Returning to sufficient width closes the transient
drawer and restores the previous inline state; automatic placement is never saved.

Drawer placement uses released `createRetainedContent` to reuse the original sidebar
nodes and restore native scroll offsets after reattachment. Search, list scroll, file
selection, chat draft and selection, editor identity, and terminal sessions retain
their owners across resize and disclosure. Main content is not rebuilt to change
navigation placement. Released local Dialog owns the scrim, keyboard containment,
entry/exit isolation, and focus return. Escape or scrim dismissal restores a
visible trigger. Opening navigation focuses a button, never a search field.
Mobile navigation retains its product-specific bottom/side panel behavior under
the [mobile Shell](mobile-shell-navigation.md) and [Flower](flower-mobile-navigation.md)
contracts.

## Flower welcome

Desktop Flower retains its mark, title, introduction, working directory, four
complete starter suggestions, and keyboard hints even when the chat region is
767 CSS pixels or narrower. Container queries adjust spacing and the suggestion
grid; they cannot hide content or switch interaction mode. Insufficient height
scrolls welcome content while the composer remains reachable. Suggestions fill
an editable draft and do not submit a turn. Two-card disclosure belongs only to
actual mobile interaction.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/App.tsx` - Maps native host identity and browser capabilities into Floe configuration.
- `redeven:desktop/src/welcome/App.tsx` - Fixes Desktop Welcome to desktop interaction.
- `redeven:internal/envapp/ui_src/src/ui/mobileViewportPolicy.ts` - Defines the browser product query.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx` - Supplies Shell space policy and shared interaction marker.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Shares interaction mode and preserves rail/detail ownership.
- `redeven:internal/envapp/ui_src/src/ui/widgets/BrowserWorkspaceShell.tsx` - Allocates Files/Git navigation from local space.
- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalPanel.tsx` - Separates session navigation placement from terminal input mode.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.desktopResponsive.browser.test.tsx` - Covers welcome width boundaries and retained draft/navigation nodes.
- `redeven:internal/envapp/ui_src/scripts/checkDesktopResponsive.mjs` - Verifies the built Env App in Chromium and WebKit.
- `redeven:desktop/scripts/check-flower-navigation.mjs` - Verifies real Desktop Welcome at narrow widths in English and Chinese.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserWorkspace.navigation.browser.test.tsx` - Checks retained directory/content nodes and drawer focus.
- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalPanel.loadingContinuity.browser.test.tsx` - Checks retained terminal runtime and session filtering across placement changes.
