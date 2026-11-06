---
type: UI Contract
title: Plugin discovery, placement and layout continuity
tags: [ui, plugins, activity, workbench, plugin-center]
lifecycle: contract
reviewed_at: "2026-11-06"
---
# Summary

Redeven owns navigation, pins and persisted geometry; released ReDevPlugin owns surface slots and authority. Activity and Workbench placements remain independent, lazy opening captures current context and hidden opened surfaces retain edits. Layout continuity never revives revoked authority or replays unknown writes.

# Contract

## Discovery and surfaces
### Discovery and pinning
Activity Bar Plugins opens a Shell-root Launcher without navigation. Search intersects category with NFKC/locale-folded names, canonical keywords and explicit locale aliases. Tablet/desktop details overlay without grid reflow and restore row focus.

Tiles have one launch action, no pin overlay/indicator. Right-click/ContextMenu/Shift+F10 offers information/current-mode Activity Bar or Workbench Dock pins; pinning keeps Launcher open, dismiss restores tile focus. Plugin Center has explicit 44px touch pins; cards/details and pinned Activity context menus also offer Activity pins. Floating plugin windows show only their identity and window controls; they do not duplicate shortcut pin actions.

Use environment-scoped Shell preferences with independent Activity/Workbench pins and synchronized selected/accessibility state. Pins grant no launch/enable/authority. Activity unpin first completes exact retirement; failed close retains pin/error. Other windows/siblings retain lifetimes.

### Recovery, installation and policy
Authenticated session-ready invokes idempotent Host recoverEnabled without timers. Every placement consumes action_state; source classification/grants/policy/recovery cannot derive can_open. [Installation](plugin-package-review.md#installation-progress) owns durable Execution observation; [package review](plugin-package-review.md#package-review) external packages. Failure preserves placement. Plugin Center joins inventory/grants/Host requirements/policy. Method effects cannot rename capabilities; failure reloads authority/requires fresh confirmation.

### Activity pages/windows
Allocate a fresh PluginSurfaceSlot only when placement and document are visible. Hidden unopened placements retain layout without iframe/authority; close requires no open/revoke round trip. Once opening starts, hiding retains independent slot/draft/selection/undo/pending work. Visible placements may open concurrently; each actual open captures current context revision and delivers later changes once. Windows use openSurfaceInSlot. Open/bridge failure replaces iframe with local recovery; timeout offers Retry. Restart restores shortcuts but opens a built-in page.

Equivalent metadata preserves container/iframe/state; slot lifecycle owns visibility. Instance/surface/management-revision/runtime-generation changes retire leases. Cold open shows one themed accessible waiting surface, then ready or recovery/details; never rotate bootstrap labels. The published platform waits for the replacement document parser/module graph and initial SDK context delivery before revealing its frame. Product does not add timers, paint requirements or inspect application DOM.

Stable pinned-page component functions allow names/icons/order updates without remounting siblings or losing edits. Published Floe retained views own sibling isolation/DOM order: moving the same iframe can reload it. Acceptance checks inner document/draft and container; add no second keep-alive stack.

### Workbench and teardown
[Layout continuity](#layout-continuity) owns bindings/removal/recovery. Overlays cannot forward input, guess focus or create bridges; Workbench unpin removes only shortcut. One abort-aware FIFO dialog handles independent confirmations with initial Cancel focus. Hidden/retired/revoked surfaces cannot approve queued work; retired surfaces cannot download. Shell never uploads/retains export bytes.

## Layout continuity
Open captures display mode with independent SDK slots; neither mode creates a Plugin Center widget. `workbench/actions/open_plugin` atomically creates/reuses exact instance/surface binding. Late requests cannot lower management revision or substitute surfaces; failed cleanup retries reconciliation, never uninstall.

Containers retain identity while SDK leases retire. Committed/unknown platform outcomes invalidate slot registry first; no close after revocation. Shell reconnect owns disconnection; authenticated inventory recovery restores layout. Failed initial reads keep canvas unready/autosave off with Retry. Saved cards offer explicit reload for fresh authority, never indefinite preparation/retired-session reuse.

# Boundaries

Manifest kinds remain view|command|background with semantic roles; product placements are not manifest fields. Redeven never verifies packages/releases, mints tokens, serves assets, grants implicit permissions or directly calls business adapters. Retention grants no authority, platform-store inspection, reconstruction of deleted placements or unsaved plugin memory.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginQuickPin.browser.test.tsx` - Tests.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginPinButton.test.tsx`: reject duplicate pending clicks; failed updates preserve authoritative selection/Retry.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.localAccess.e2e.test.tsx` - Tests.
- `redeven:internal/envapp/ui_src/src/ui/plugins/ActivityPluginSurfaceContinuity.test.tsx` - Tests.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginSurfaceFrame.test.tsx` - Tests.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginWebGL.browser.test.tsx`: actual published SDK WebGL1/2 pixels, visibility and close/reopen.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:1` - Source.

- `redeven:internal/workbenchlayout/plugin_widgets.go:1` - Source.
- `redeven:internal/workbenchlayout/plugin_widgets_test.go:1` - Tests.
