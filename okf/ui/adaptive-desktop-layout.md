---
type: UI Contract
title: Adaptive desktop and mobile navigation
tags: [ui, desktop, layout, navigation, accessibility]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Desktop and mobile remain distinct interaction modes; narrow desktop regions use temporary drawers without rewriting saved placement. Files/Git navigation begins with its mode switch, without a separate Files title row or reserved header space. The switch uses the published field height, including its border and padding, so the sidebar and single-row file toolbar dividers align at every interface scale.

# Contract

## Desktop adaptation
### One interaction mode
Desktop Welcome and Desktop-hosted Env App configure `mobileQuery: 'not all'`; the Env App recognizes its native host through the existing Desktop bridge.

Resizing a desktop browser cannot rewrite its saved Activity/Workbench choice or activate mobile terminal input.

A hidden toolbar action must retain an explicit reachable entry.

### Temporary desktop navigation
Shell, Flower conversations, Files/Git navigation, and Terminal sessions measure their own shared navigation/content region. When that region cannot fit the current sidebar width plus 480 CSS pixels of main content, the sidebar becomes a transient left side drawer.

The mobile close action shares that row; desktop drawers retain their accessible dialog title and dismissal. Sidebar resizing and local tree scrolling remain available.

File filtering and entering or leaving idle path editing never add header feedback or change toolbar height. The shared bottom status bar owns the filtered item count and view indicator. Path editing keeps Enter submission, Escape cancellation, and blur cancellation without an instruction row; pending navigation and errors retain their accessible header feedback.

Mobile navigation retains its product-specific bottom/side panel behavior under the [mobile Shell](#mobile-shell) and [Flower](#mobile-flower) contracts.

## Mobile Shell
### Persistent navigation and tools
The existing ordered page tabs remain horizontally scrollable.

Download counts and failure attention derive from the same download manager used on desktop. A newer panel request cancels an outgoing handoff.

### Panel boundary and dismissal
One transient requested state selects closed, plugins, More, or a tools subpage.

No drag, snap, or persisted geometry is owned by the product.

## Mobile Flower
The bottom Flower tab enters Flower and opens its conversation drawer.

Background summaries cannot open or close the drawer.

A later focus choice, especially returning to the composer, wins; restoration must not reclaim focus, scroll the page, or interrupt the keyboard session.

# Boundaries

### Flower welcome
Desktop Flower retains its mark, title, introduction, working directory, four complete starter suggestions, and keyboard hints even when the chat region is 767 CSS pixels or narrower. Container queries adjust spacing and the suggestion grid; they cannot hide content or switch interaction mode.

Narrow layouts may ellipsize selection titles; explanations remain normal prose and mobile suggestion cards retain their compact presentation.

The shared local dialog has no global aria-modal claim. Initial focus goes to a close button, never search.

Desktop transitions close mobile navigation and restore the framework toolbar without recreating the active business page.

The [Activity companion](flower-activity-companion.md#companion) owns product placement. The shared [floating boundary](env-app-floating-layer-order.md) owns visible viewport geometry and safe areas.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/App.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserWorkspace.navigation.browser.test.tsx` - Tests.
