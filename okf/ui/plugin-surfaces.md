---
type: UI Contract
title: Plugin discovery, placement and layout continuity
tags: [ui, plugins, activity, workbench, plugin-center]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Redeven owns navigation/pins/geometry; published ReDevPlugin owns slots/authority. Tiles launch once without pin overlays. ContextMenu/right-click/Shift+F10 exposes info and current-mode pins; pinning keeps Launcher open and dismissal restores focus.

# Contract

## Discovery and surfaces
### Discovery and pinning
Activity Bar Plugins opens Shell-root Launcher without navigation. Search intersects categories with NFKC/locale-folded names, canonical keywords and explicit locale aliases. Desktop/tablet details overlay without grid reflow. Center cards/details/pinned context menus offer Activity pins with44px touch controls; floating windows show identity/window controls only.

Environment-scoped independent Activity/Workbench pin preferences synchronize selection/accessibility, granting no launch/enable/authority. Activity unpin must finish exact retirement first; failure keeps pin/error. Other surfaces keep lifetimes.

### Recovery, installation and policy
Session-ready invokes idempotent Host recoverEnabled, no timer. Placements consume action_state; grants/source/policy/recovery cannot infer can_open. [Installation](plugin-package-review.md#installation-progress) owns durable observation and [review](plugin-package-review.md#package-review) external packages. Failure retains placement. Center joins inventory/grants/requirements/policy; effects cannot rename capabilities. Failed mutation reloads authority and needs fresh confirmation.

### Activity pages/windows
Center opens/focuses installed plugin above retained Activity page, preserving search/filter/selection/scroll and origin focus on close. Existing pinned page keeps separate slot/edits; never move its iframe. Queued opens capture placement without reversing later navigation. Workbench opens exact widget before leaving Center. Creation opens independent project-owned window in either mode, retaining route/composer/preview when hidden; mobile isolates until close. Queued creation rechecks project; eviction closes exact window only.

Allocate fresh slot only for visible placement/document; hidden unopened layouts need no iframe/authority/open/revoke. After opening starts, hiding retains independent slot/draft/selection/undo/work. Concurrent visible opens capture current context revision and deliver later changes once. Windows use openSurfaceInSlot. Bridge/open failure replaces iframe with local recovery; timeout offers Retry. Restart restores shortcuts, opens built-in page.

Equal metadata preserves container/iframe; lifecycle owns visibility. Instance/surface/management revision/runtime generation changes retire lease. Cold opening has one themed accessible wait then ready/recovery, no cycling labels. Published3.23.2 waits for replacement parser/module graph/initial SDK context before reveal; host adds no timers/paint requirements/DOM inspection.

Stable pinned component functions own wrappers; metadata/order cannot remount siblings. Published Floe retained views own isolation/order; moving an iframe can reload it. Assert inner document/draft plus container, no second keep-alive stack.

### Workbench and teardown
[Continuity](#layout-continuity) owns bindings/removal/recovery. Overlays cannot forward input/guess focus/create bridges. Workbench unpin removes shortcut only. One abort-aware FIFO confirmation starts on Cancel; hidden/retired/revoked surfaces cannot approve, retired surfaces cannot download. Shell never uploads/retains export bytes.

## Layout continuity
Open captures mode/independent slots; neither creates Center widget. workbench/actions/open_plugin atomically reuses/creates exact instance/surface. Late requests cannot lower revision/substitute surface; failed cleanup retries reconciliation, never uninstall. Containers retain identity as leases retire. Committed/unknown platform effects invalidate registry first; no close after revoke. Shell owns disconnect; authenticated inventory restores layout. Failed initial load leaves canvas unready/autosave off with Retry; saved cards require explicit reload/fresh authority.

# Boundaries

Manifest kinds stay view|command|background with semantic roles, not placement fields. Host never verifies packages/releases, mints tokens, serves assets, grants permissions or calls adapters directly. Retention grants no authority, store inspection, deleted-layout reconstruction or unsaved-memory recovery.

# Evidence

smoke_desktop_plugin_first_presentation.mjs qualifies real isolated dark/light cold opens, delayed modules, retained input/reopening/titlebar. ActivityPluginSurfaceOpening.browser.test.tsx checks visible geometry/zero padding; PluginPinButton.test.ts blocks duplicate clicks and preserves authoritative state/Retry on failure.
