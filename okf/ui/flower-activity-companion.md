---
type: UI Contract
title: Flower Activity companion and contextual window placement
tags: [ui, flower, activity, companion, read-state, floret]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

One retained Flower surface moves between authorized Activity and Workbench hosts. Published Floe owns companion/window geometry, motion and dismissal; product adapters supply safe-area measurements and focus handoffs. Placement creates neither another stream nor a second execution or editor owner.

# Contract

## Companion
### Companion ownership
Published `BottomBarCompanion` owns geometry, viewport/safe-area clamps, motion, outside dismissal, Escape and mount handling. Its Portal uses the explicit Activity overlay host, never `document.body`. The collapsed field is centered; bounded detail grows upward without changing body geometry. Running work cannot prevent collapse or destination interaction.

### Activity Terminal footer
Desktop Activity Terminal supplies a 24-pixel anchor in its 28-pixel footer, centered in the terminal column with a shrinkable 360-pixel maximum width. Workbench/mobile terminals supply none. Terminal supplies its reactive background/foreground alongside the anchor. Only the collapsed footer entry uses that palette: a restrained tinted surface, visible border and monochrome Flower icon. Expanded Flower keeps the shell theme; palette changes never replace its editor. Placement does not create another Flower instance, alter transport or route Flower input through the terminal.

### Stable Flower placement
After first access readiness, one retained `EnvAIPage`/`FlowerSurface` moves among explicit hosts. Visibility drives `hidden`, `aria-hidden` and `inert` together. Available unfiltered Workbench placement survives deselection; canvas selection governs input/focus only. [Settings](flower-setup-and-settings.md#retained-panels) own retained panels/forms.

### Contextual Ask Flower
New companion conversations may capture the desktop Activity origin using its read-only page reader. [Turn launcher](flower-turn-launcher.md#submission) owns sending/context actions.

### Presence and summary
[Presence](flower-companion-presence.md#presence) owns collapsed priority, live tails, completion feedback, composer precedence and workspace observation.

### Dismissal, focus, and reads
Outside capture includes shell, anchor and classified Flower-owned Portals. Trusted cross-origin plugin bridge events join host pointer/focus dismissal without consuming the destination. Shared SSE summaries are activity-only; initial/reconnect read baselines and later read envelopes are scoped to the same `UserPublicID`.

A floating window's geometry controls inherit ownership only from its direct published surface. Flower preview resize handles retain the companion; unrelated windows still dismiss it.

## Contextual window
### Host boundary
The host adapter measures the visible Shell header's client-space bottom edge and takes the larger of that edge and the current Desktop titlebar safe area.

The host boundary and margin feed one published `viewportInsets` geometry path for anchored opening, centered opening, dragging, edge resizing, and viewport changes.

### Controls and constrained space
Ask Flower sets the published `FloatingWindow.maximizable` capability to false.

When it cannot accommodate the preferred size, the window shrinks within that viewport.

Outside-click dismissal treats the published geometry wrapper and its resize handles as part of the launcher; resizing must never dismiss it. Other windows remain outside this boundary.

# Boundaries

The Workbench Flower widget retains its existing window, canvas, and focus contracts while contributing only a placement host for the Env App-owned Flower product.

The companion never auto-expands for completion, failure, approval, or user input. Showing an available, unfiltered Workbench Flower widget moves the retained product tree into that widget without starting a second list load or live stream, and later canvas deselection does not move it away.

Redeven supplies the Ask Flower placement policy and host measurements; published Floe owns dragging, resizing, clamping, and maximize controls. Host insets must not be duplicated in an alternate drag controller. These constraints apply to the contextual launcher, not the main Flower surface or other floating windows.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/plugins/ActivityPluginSurfacePage.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.localAccess.e2e.test.tsx` - Tests.

- `redeven:desktop/src/shared/askFlowerWindowViewport.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FlowerTurnLauncherWindow.tsx` - Source.
