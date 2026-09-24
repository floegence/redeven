---
type: UI Contract
title: Mobile shell navigation
description: Reach shell tools and plugins above persistent mobile navigation without reducing the working area.
tags: [ui, mobile, navigation, shell, accessibility]
timestamp: 2026-09-25T00:00:00Z
---
# Summary

Redeven owns mobile navigation choices; released Floe Shell owns the layout,
visible viewport, presence, and focus boundary. Below 768 CSS pixels the framework
toolbar is hidden and its actions remain reachable from a fixed More button.
Navigation panels never cover or disable the bottom bar. Covered page content
stays inert through panel exit, and global confirmations retain full modality.
Closing navigation preserves page content and does not cancel product operations.

# Contract

## Persistent navigation and tools

The existing ordered page tabs remain horizontally scrollable. A fixed 64px More
action follows that scroll region in the 56px navigation row, above the bottom
safe area. Page selection and panel disclosure are separate: opening More or
Plugins does not change the selected page. The hidden framework toolbar's top
safe area belongs to Shell; page-specific headings remain visible.

More exposes Search and commands, Notes, Downloads, browser-owned Language,
Appearance, and the existing dashboard action. Downloads, language, and appearance
use one panel with a Back action. Reopening More starts at its root. Download
counts and failure attention derive from the same download manager used on desktop.
Language and appearance reuse the same preference setters and selection controls.
Search, Notes, and dashboard handoff wait for panel exit before moving focus.
Page-tab actions also wait for exit so the destination can focus its controls
after content isolation ends. A newer panel request cancels an outgoing handoff.

## Panel boundary and dismissal

One transient requested state selects closed, plugins, More, or a tools subpage.
The retained display value only preserves outgoing content during exit. Clicking
an open trigger closes it; another panel trigger replaces its content; a page
tab closes it and performs the tab's existing action. Opening shell navigation
closes Flower conversation, terminal-session, and file-directory navigation.

The panel has 8px margins above navigation, 24px corners, and a maximum height
of 680px or 86% of available content. Plugin navigation uses the large height;
tools use natural content height. Identity and close controls remain above one
scrollable content region. Touch targets are at least 44px, tools rows at least
48px, and search text at least 16px. No drag, snap, or persisted geometry is owned
by the product.

The shared local dialog has no global aria-modal claim. Its scrim blocks covered
page input while bottom navigation remains reachable by touch, horizontal
scrolling, and keyboard. Initial focus goes to a close button, never search.
Escape clears plugin search first, returns from a tools subpage next, and closes
the root panel. Explicit dismissals restore the visible trigger without scrolling;
page changes leave focus to the destination. Global confirmation dialogs retain
priority over this local navigation boundary.
Changing a tools subpage must not replay panel-entry focus after the user has
already moved to bottom navigation. Tab and Shift+Tab traverse both focus roots.

Floe keeps navigation visible above the software keyboard while a panel is
present. Ordinary page editors retain the existing keyboard-driven navigation
hiding. Browser toolbar and viewport changes resize available content without a
second product viewport observer. Desktop transitions close mobile navigation
and restore the framework toolbar without recreating the active business page.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx` - Coordinates requested navigation, Shell integration, handoff, and disclosure triggers.
- `redeven:internal/envapp/ui_src/src/ui/MobileShellTools.tsx` - Places shared tools inside one navigation panel.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginPanel.tsx` - Retains plugin content while Shell owns mobile placement.
- `redeven:internal/envapp/ui_src/scripts/checkMobileNavigation.mjs` - Validates built application geometry and interactions in Chromium and WebKit.
