---
type: UI Contract
title: Plugin Center interaction
description: Browse and manage plugins in an Activity page or an input-isolated Workbench bottom drawer with retained navigation and responsive details.
tags: [ui, plugins, plugin-center, workbench, accessibility]
timestamp: 2026-09-11T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns Plugin Center navigation and presentation; released Floe Webapp owns
Dialog positioning, Portal placement, presence, and modal input. Workbench opens
one retained bottom drawer outside its inert canvas. Activity uses the same
directory in a page. Search, filters, selection, and scroll survive reopening.
Failed actions remain actionable; closing management never cancels an admitted
Host Execution. Released ReDevPlugin remains the authority for lifecycle actions,
permissions, exact inventory identity, and SDK surface lifetime.

# Contract

## Management placement and input
Only Plugin Center explicitly selects global Dialog placement at the product modal layer. Recent Dock or widget interactions cannot mount the drawer under `.workbench-surface`, `inert`, or a transformed canvas ancestor.

A successful Open closes management and focuses the target after canvas input becomes available; a failed Open preserves the directory and error feedback.

## Directory and responsive details
Local filters combine source (official catalog or external), trust, and lifecycle without rebuilding identity. Refresh status remains outside the card grid, so a pending refresh cannot appear as a duplicate card.

External installation source tabs retain three columns with the same complete accessible names when their visible selection labels need ellipsis.

# Boundaries

Management presentation never creates a second lifecycle or permission authority. Global placement applies only to this product modal and its confirmations, not to ordinary Workbench widget dialogs or menus.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterDrawer.tsx:1` - Retains content within an explicit global placement context and consumes the released bottom-drawer Dialog.

- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterView.tsx:1` - Owns exact selection, scoped keyboard behavior, distinct accessibility IDs, and responsive details.
