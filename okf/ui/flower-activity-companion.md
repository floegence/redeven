---
type: UI Contract
title: Flower Activity companion
description: Activity presents one Flower surface as a dedicated page or a continuous floating companion without changing canonical ownership.
tags: [ui, flower, activity, companion, read-state, floret]
timestamp: 2026-10-12T00:00:00Z
quality_exception: Cross-surface placement contract spanning Activity, Workbench residency, contextual launch handoff, and viewer read acknowledgement; composer presentation has its own owner.
---
# Summary

After access first becomes ready, Env App owns one stable `EnvAIPage` and `FlowerSurface`. On desktop, the published `BottomBarCompanion` provides a centered collapsed field and a bounded detail surface that grows upward without changing body geometry. The dedicated Activity Bar page and an available, unfiltered Workbench Flower widget are placements of that same product tree. Workbench selection controls canvas input and focus only; clearing selection never revokes Flower placement or engagement. Placement changes hosts, presentation, visibility, and engagement; it never creates a second Flower surface or changes Floret authority. Floret owns thread lifecycle state, while Redeven owns product placement, read acknowledgement, and ephemeral UI state.

# Contract

## Companion ownership

`@floegence/floe-webapp-core/layout` owns the reusable companion shell, fixed geometry, visual-viewport and safe-area clamping, motion phases, capture-phase outside dismissal, Escape routing, and explicit mount handling. Redeven consumes the published package and does not reuse `FloatingWindow` or `SurfaceFloatingLayer` for this surface. The companion has independent `retained`, `visible`, and `open` inputs: residency, product availability, and expanded geometry are not aliases for one another.

Desktop Activity omits the global status bar through the published `Shell.bottomBarMode="hidden"` contract, returning its complete height to the main layout. The default 32-pixel companion anchor is positioned absolutely at the bottom center of the stable `AppViewport`, with a maximum width of 360 pixels, at least 12 pixels of horizontal clearance, and 12 pixels above the bottom safe area. It reserves no content height and adds no full-width accessory rail. Only the companion surface receives pointer input; the overlay host and anchor allow underlying page interaction. Redeven requests a 544-pixel expanded width through the published `expandedWidth` contract; Floe centers and clamps that width to the safe visual viewport. Mobile has no persistent companion field or accessory rail. The Flower navigation tab opens its full page; [mobile Flower navigation](flower-mobile-navigation.md) owns its single-pane list/detail interaction. `AppViewport` bounds the stable application root to the visible viewport; Shell and companion consume the same published viewport observer. Only measured software-keyboard occlusion hides mobile navigation. Hardware-keyboard focus, browser chrome changes, and rotation do not hide it. Horizontal screen safe areas remain outside the product layout. Each anchor is a layout placeholder only. Viewport events update geometry without remounting pages or editors, changing Flower presentation, or requesting focus; keyboard dismissal restores navigation and retains drafts, selection, and IME state. The companion Portal mounts to the explicit Activity overlay host and never falls back to `document.body`. That host uses the fixed Flower band defined by [Env App floating layer order](env-app-floating-layer-order.md), so an expanded or transitioning companion remains above every movable product or plugin window but below the plugin launcher Panel, blocking product modals, and command palette. A missing or disconnected replacement mount retains the previous shell hidden and inert until the requested mount and anchor are ready.

Environment resource usage remains available from Monitor, runtime details from Settings, and Audit log and Reconnect from their existing command-palette actions. Connection recovery keeps its visible status and guarded retry controls. The desktop shell adds no replacement status control to the toolbar. Metrics retain the [runtime read-permission boundary](../architecture/runtime-session-permission-gates.md).

Shell geometry is an EnvApp bootstrap dependency, not a lazy Flower-product detail. Anchor, overlay, and product-root geometry styles load with the main EnvApp stylesheet so the anchor has measurable size before `BottomBarCompanion` creates its content host. The Activity registry always registers the full-page Flower host because registry membership is fixed when the runtime owner mounts. Access readiness still gates every Flower entry, command, companion mount request, and navigation action. Conditional visibility must not be implemented by conditionally registering the host or lazily loading the anchor geometry. The Shell imports the lightweight draft coordinator directly; the Flower product surface stays behind its existing lazy entry instead of entering the initial graph through the product barrel.

The companion is absent while password access is checking, locked, or resuming. Mobile layout, recovery, Workbench foreground, the Ask Flower launcher, and the dedicated Flower page hide the retained companion without discarding Flower state. A running task never prevents the user from collapsing the companion or clicking another surface.

## Activity Terminal footer

Desktop Activity Terminal registers a 24-pixel anchor in its existing 28-pixel footer, centered in the terminal content column with a maximum width of 360 pixels and room to shrink. The footer stays the same height while the companion expands or collapses. Session and recovery text remain on the left; shared-layout information, history, and recovery actions are on the right. Footer-local container queries shorten layout information and hide history before controls overlap. Terminal provides only the measured anchor; the companion and retained Flower editor remain in the existing overlay host, preserving drafts, selection, IME, focus, and outside-dismiss ownership. Footer controls are outside Flower and can dismiss it without consuming their action.

Only the real `terminal` Activity ID selects this anchor. Empty authorized Terminal pages also expose the footer. Loading and permission states without a footer use the default viewport anchor, and disposal unregisters only the exact registered element. Other Activity pages retain their default floating placement. Workbench Terminal widgets and mobile terminals never register an entry; their existing footer heights and navigation remain unchanged. This placement does not introduce a second Flower instance, change terminal transport, or route Flower keystrokes through terminal input.

## Stable Flower placement

The product root consumes the same authoritative visibility decision for native `hidden`, `aria-hidden`, and `inert`. An unavailable placement must suppress the complete product's paint and layout boxes while retaining its DOM, draft, and selection. Accessibility hiding or input isolation alone is insufficient: the retained mobile overlay must never paint a background or composer over the active page after unlock, navigation, or a breakpoint change. Restoring an available placement reveals the same product and editor nodes.

Redeven owns one stable product Portal around exactly one `EnvAIPage`. That owner mounts outside the Activity and Workbench mode views, so starting directly in a persisted Workbench mode does not depend on Activity rendering first. Its requested target is the connected companion content host, dedicated Activity full-page host, or available and unfiltered Workbench Flower host. On mobile outside the Flower page, the existing Activity overlay host retains the hidden, inert product without reserving layout space. The Workbench widget contributes only that host; it never constructs an adapter or Flower surface. While that widget remains available and unfiltered in Workbench, its host stays foreground and engaged even when a background pointer gesture clears selection or its canvas lifecycle becomes cold. Permission loss, filtering, or host disposal withdraws the host. Target replacement is atomic: if the requested host is unavailable, the product tree remains in its previous connected host hidden, inert, and disengaged. Neither the shell Portal nor the product Portal uses an implicit body mount.

[Flower companion composer and motion](flower-companion-composer.md) owns native editor identity, explicit compact entry, text and toolbar layout, autosizing, content dissolve, and surface treatment. These presentation rules do not change the placement or lifecycle owner.

## Contextual Ask Flower

New companion conversations can include the desktop Activity origin page through
the read-only page reader selected by Shell's current Activity ID. Capture timing,
frozen chips, removal and strict admission belong to
[Activity origin page references](flower-page-context.md). This adds no context
state owner to Shell and does not extend Workbench, mobile, standalone windows or
the separate Ask Flower launcher.

[Ask Flower window boundaries](ask-flower-window.md) owns Header avoidance,
constrained resizing, and the launcher's disabled maximization.

Activity and Workbench keep the existing `FlowerTurnLauncherWindow` interaction. Opening records the exact origin mode, Activity surface, companion placement, and Workbench anchor where applicable. The Activity Flower instance remains the presence owner but is hidden, inert, disengaged, and unable to acknowledge transcript reads while its launcher is open.

Successful submit closes the launcher and focuses the accepted thread. From desktop Activity it opens the companion detail surface; on mobile it selects the full Flower page. From the dedicated Flower page it stays full page. Workbench retains its existing widget handoff. Cancel restores the captured origin. Send and context-action behavior remain defined by [Flower turn launcher](flower-turn-launcher.md).

## Presence and summary

[Flower companion presence](flower-companion-presence.md) owns collapsed status priority, live output tails, completion acknowledgement, composer precedence, and the single workspace observation stream. Presence never changes the placement and focus ownership defined here.

## Dismissal, focus, and reads

Capture-phase outside pointer dismissal includes the companion shell, its anchor, and explicitly classified Flower-owned Portal surfaces. Unrelated dialogs, menus, and application surfaces are outside even if they later stop propagation. Activity plugin windows project host pointer and focus input plus trusted iframe bridge activation, focus, and action events into the same outside-dismiss behavior, because cross-origin iframe events cannot bubble into the product document. Active pinned Activity plugin pages project those same trusted bridge events into dismissal without changing navigation, stack order, or plugin focus. Hidden pages and selection notifications cannot dismiss the companion. Programmatic plugin-window ordering remains a pure stack operation and does not impersonate user interaction. The remote Browser page forwards trusted pointer input from its separate document through the existing private product port into that same dismissal route; source-control permission is not required for this local placement action. Browser focus and programmatic state updates do not impersonate pointer input. Outside dismissal does not prevent the destination interaction or restore focus. The explicit header close control moves focus to the Activity neutral viewport anchor and collapses without issuing a composer-focus request, so closing does not reclaim editing focus. Escape is observed in bubble phase so an owned Portal can consume it first; otherwise it collapses only for companion-owned focus. Once the shell reaches its collapsed phase, Escape returns focus to the visible entry or retained ordinary editor without reopening. The expanded content remains mounted through the entire closing phase, including the interval before the shell reports `collapsing`.

Focus handoffs are consumed once and scoped to the current Flower instance, initiating focus owner, thread, and question/approval identity. Replacement prompts, thread changes, reversed dismissal, external focus transfer, hidden placement, or disposal cancel obsolete handoffs. Background state changes never request focus or expansion. Focus queries never recover through another Flower instance.

Every Activity `markThreadRead` call requires Activity foreground, document visibility, a visible and engaged expanded/full-page placement, no launcher, the current chat panel, exact selected detail, a matching after-paint content-presented token, and no bootstrap, loading, or error state. Collapsed presentation, including its unread failure summary and read-only summary stream, staging between Portal hosts, Workbench foreground, launcher presentation, and access gates cannot acknowledge reads. This keeps a failure visible until the user opens its exact thread and genuinely sees it. Read acknowledgement has one durable watermark: `activity_revision`. One selection cycle attempts each revision at most once, coalesces in-flight updates to the greatest pending revision, and restores unread presentation after failure without polling or automatic retry. A newer revision or a later genuine presentation cycle may submit again. Canonical SSE summary batches never contain private read state; viewer read-state envelopes are scoped to the same `UserPublicID` and never enter shared summary or timeline history.

# Boundaries

The Workbench Flower widget retains its existing window, canvas, and focus contracts while contributing only a placement host for the Env App-owned Flower product. Selection, z-order, and canvas lifecycle do not own product residency. Host movement adds no persistent transcript cache, lifecycle endpoint, alternate command path, or second live reducer. Related Flower dialogs and previews may continue using their established floating primitives; only the floating companion shell is forbidden from doing so.

The companion never auto-expands for completion, failure, approval, or user input. Presence communicates progress without stealing focus; explicit activation selects the associated thread before expansion. Selecting Flower from the Activity Bar enters the dedicated page; the desktop floating entry and desktop Activity Ask Flower handoff enter the bounded companion detail surface. Mobile handoff selects the full Flower page. Showing an available, unfiltered Workbench Flower widget moves the retained product tree into that widget without starting a second list load or live stream, and later canvas deselection does not move it away.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/plugins/ActivityPluginSurfacePage.tsx` - Active-page trusted bridge interaction projection.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.localAccess.e2e.test.tsx` - Pinned plugin interaction dismisses Flower without retiring either product surface.

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx` - Env App separates the published companion shell Portal from the stable product Portal and all explicit placement hosts.
- `redeven:internal/envapp/ui_src/src/ui/workbench/redevenWorkbenchWidgets.tsx` - Workbench registers a placement host instead of mounting an independent Flower product.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - collapsed presentation retains the ordinary composer and gates transcript engagement, secret input, and approval controls.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.flowerCompanion.browser.test.tsx` - browser tests cover continuous geometry, outside dismissal, breakpoint placement, and DOM identity.
- `redeven:internal/envapp/ui_src/scripts/checkPackagedRenderer.mjs` - production-build checks load the unmocked lazy Flower feature, verify desktop placement, and cover mobile unlock, hidden paint, navigation, breakpoint changes, and retained drafts in both themes.
- `redeven:internal/flower_ui/src/FlowerSurface.visibility.test.tsx` - focused tests cover collapsed engagement, background refresh, and composer identity.

- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalPanel.loadingContinuity.browser.test.tsx` - Footer registration, empty-session access, narrow geometry, recovery actions, and Workbench/mobile exclusion.
