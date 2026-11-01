---
type: UI Contract
title: Mobile shell navigation
tags: [ui, mobile, navigation, shell, accessibility]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Redeven owns mobile navigation; Floe owns viewport, presence and focus. Mobile hides the framework toolbar behind a fixed More action while keeping bottom navigation reachable. Covered content stays inert through exit, confirmations remain modal, and closing navigation preserves content and admitted operations.

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

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx` - Shell navigation, handoff and disclosure coordination.

- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginPanel.tsx` - Retains plugin content while Shell owns mobile placement.
