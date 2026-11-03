---
type: UI Contract
title: Plugin surfaces
tags: [ui, plugins, activity, workbench, plugin-center]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Redeven owns plugin discovery, navigation and placement; ReDevPlugin owns admission, surface authority, bridge sessions, confirmation and revocation. Activity/Workbench use independent SDK slots. Management retains search/selection and reconciles unknown outcomes against authoritative state.

# Contract

## Discovery and pinning
Activity Bar Plugins opens a Shell-root Launcher without changing surface. Search intersects category with NFKC/locale-folded names, canonical keywords and explicit locale aliases. Tablet/desktop details overlay without grid reflow and restore row focus.

Tiles have one launch action, no pin overlay/indicator. Right-click/ContextMenu/Shift+F10 exposes information and current-mode Activity Bar/Workbench Dock pinning. Pinning keeps Launcher open; dismiss restores tile focus. Plugin Center provides explicit touch pins with 44px compact targets; cards/details and Activity headers also expose Activity pinning.

All entries use existing environment-scoped Shell placement preferences. Activity/Workbench pins are independent; selected state/accessibility update together. Pins never launch/enable/authorize. Unpinning an Activity page first completes its exact retirement; failed close retains pin/error. Windows/siblings retain their lifetimes.

## Recovery, installation and policy
Authenticated session-ready calls idempotent Host recoverEnabled without timers. All placements consume action_state; trust/grants/policy/recovery flags cannot derive can_open. [Installation](plugin-installation-progress.md) owns durable Execution/approved setup; [package review](plugin-package-review.md) owns external packages. Failure preserves placement.

Plugin Center joins inventory/grants/Host requirements/policy. Method effects cannot rename capabilities. Failure reloads authority and requires new confirmation.

## Activity pages/windows
Each window opens a fresh PluginSurfaceSlot via openSurfaceInSlot. Opening/bridge failures replace iframe with local recovery; timeout offers Retry. Restart restores shortcuts but opens a built-in page, never third-party content.

Equivalent metadata preserves an existing page's container/iframe/state. Visibility uses slot lifecycle; instance/surface/management-revision/runtime-generation changes retire its lease. Authority cannot survive merely for continuity. Cold open immediately shows one themed accessible waiting surface without rotating bootstrap labels; ready replaces it, failure retains recovery/details.

Each pinned page owns a stable component function. Inventory/pins may update names/icons/order without remounting siblings or discarding edits. Published Floe retained views own sibling isolation/stable DOM order: moving an identical iframe can reload its document. Acceptance checks inner document/draft as well as container; never copy another keep-alive stack.

## Workbench and teardown
[Layout continuity](plugin-layout-continuity.md) owns bindings/atomic placement/exact removal/recovery. Status overlays cannot forward input, guess focus or create bridges. Workbench unpin removes only shortcut.

One abort-aware FIFO dialog handles confirmations independently with initial Cancel focus. Hidden/retired/revoked surfaces cannot approve queued work. Retired surfaces cannot download; Shell never uploads/retains export bytes.

# Boundaries

Manifest kinds stay view|command|background with semantic roles. Activity/Workbench/window/widget/inventory/navigation/settings/layout are product placement, not manifest fields. Redeven never verifies packages/releases, mints tokens, serves assets, grants implicit permissions or directly calls business adapters.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginQuickPin.browser.test.tsx` - Tests.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginPinButton.test.tsx`: reject duplicate pending clicks; failed updates preserve authoritative selection/Retry.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.localAccess.e2e.test.tsx` - Tests.
- `redeven:internal/envapp/ui_src/src/ui/plugins/ActivityPluginSurfaceContinuity.test.tsx` - Tests.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginSurfaceFrame.test.tsx` - Tests.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginWebGL.browser.test.tsx`: actual published SDK WebGL1/2 pixels, visibility and close/reopen.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:1` - Source.

- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginPinButton.test.tsx` - Tests.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginWebGL.browser.test.tsx` - Tests.
