---
type: UI Contract
title: Mobile shell navigation
description: Reach shell tools and plugins above persistent mobile navigation without reducing the working area.
tags: [ui, mobile, navigation, shell, accessibility]
timestamp: 2026-09-25T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns mobile navigation choices; released Floe Shell owns the layout,
visible viewport, presence, and focus boundary. In the browser mobile mode defined
by [adaptive desktop layout](adaptive-desktop-layout.md), the framework toolbar is hidden and its actions remain reachable from a fixed More button.
Navigation panels never cover or disable the bottom bar. Covered page content
stays inert through panel exit, and global confirmations retain full modality.
Closing navigation preserves page content and does not cancel product operations.

# Contract

## Persistent navigation and tools
The existing ordered page tabs remain horizontally scrollable.

Download counts and failure attention derive from the same download manager used on desktop. A newer panel request cancels an outgoing handoff.

## Panel boundary and dismissal
One transient requested state selects closed, plugins, More, or a tools subpage.

No drag, snap, or persisted geometry is owned by the product.

# Boundaries

The shared local dialog has no global aria-modal claim. Initial focus goes to a close button, never search.

Desktop transitions close mobile navigation and restore the framework toolbar without recreating the active business page.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx` - Coordinates requested navigation, Shell integration, handoff, and disclosure triggers.

- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginPanel.tsx` - Retains plugin content while Shell owns mobile placement.
