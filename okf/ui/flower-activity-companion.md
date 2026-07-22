---
type: UI Contract
title: Flower Activity companion
description: Activity presents one Flower surface as a dedicated page, fixed work-detail overlay, or bottom-bar presence without changing canonical ownership.
tags: [ui, flower, activity, companion, read-state, floret]
timestamp: 2026-07-22T00:00:00Z
quality_exception: Cross-surface UI contract spanning Activity placement, shared Flower projection, contextual launch handoff, and Workbench isolation.
---
# Summary

After Activity is first visited, it owns one stable `EnvAIPage` and `FlowerSurface` with three placements: centered bottom-bar presence, a fixed work-detail overlay, and the dedicated Activity Bar page. Placement changes geometry, visibility, and engagement only; it never creates a second surface, reparents the Portal, resizes the Activity body, or changes Floret authority. Workbench retains its independent widget. Floret owns admitted lifecycle state; Redeven owns product settings, queued follow-ups, user-scoped `read_status`, placement, and ephemeral UI state. Bootstrap failure disables live/read behavior until exact canonical content is presented after paint.

# Contract

## Placement and entry

Activity registers `ai` as a geometry and navigation host only. Selecting it from the Activity Bar enters `full_page`; the host must not instantiate another `EnvAIPage`. The real Activity Flower instance is created once by the Activity kept-alive owner and remains in one root Portal. An initial Workbench-only visit does not mount it. Leaving Activity keeps the visited instance mounted but hidden and inert, and an open `expanded` overlay collapses without clearing thread state, drafts, presence, or read state.

The desktop bottom bar uses a symmetric three-track layout so a real single-line Flower input remains centered independently of the environment and status tracks. The published Shell replaces that bar with `MobileTabBar` at its production mobile breakpoint, so Redeven places the same quick-entry control in a centered, fixed product rail immediately above the measured tab bar. The mobile rail derives its bounds from the real tab-bar rectangle, visual viewport, and four safe areas; it does not replace or duplicate mobile navigation. Exactly one desktop or mobile quick-entry instance is mounted at a time, and breakpoint changes re-anchor the same Flower surface without retaining detached geometry. Empty click or Enter expands the work-detail overlay and focuses the existing composer; `Tab` only focuses the input. The first non-composition text input creates one consumable `FlowerComposerHandoffRequest`. `FlowerSurface` switches to its existing new-chat session, preserves the selected-thread draft, appends to an existing new-chat draft with two newlines, applies the requested selection, focuses the standard composer, and acknowledges consumption only after focus and selection are applied. The shell clears quick-entry text only after that acknowledgement. The quick entry never sends a turn or duplicates composer capabilities.

`expanded` is fixed to the visual viewport and anchored eight pixels above the measured center input lane. Desktop width is the measured lane width up to 34rem; narrow screens preserve a 12px viewport inset rather than becoming full width. Height is bounded by available visual-viewport space and 34rem. Transcript scrolling stays inside the panel and the composer remains visible. The panel has no backdrop, manual resize, docked state, or maximize state, and opening it does not alter Activity body height or scroll geometry. Close and Escape return focus to the quick entry; a pointer interaction outside Flower-related floating surfaces collapses without stealing the destination focus.

## Contextual Ask Flower

Activity and Workbench use the existing floating `FlowerTurnLauncherWindow`; Activity has no inline launcher. Opening it records the exact origin mode, Activity surface, placement, and Workbench anchor where applicable. While the launcher is open, the Activity Flower instance remains the presence owner but is hidden, inert, disengaged, and unable to acknowledge transcript reads.

Successful submit closes the launcher and focuses the exact receipt or uncertain-admission thread. From an ordinary Activity surface it preserves that active surface and enters `expanded`; from `full_page` it remains `full_page` and does not stack an overlay. Workbench retains its existing widget handoff. Cancel restores the origin placement. Admission and context-action behavior remain defined by [Flower turn launcher](flower-turn-launcher.md).

## Presence and read acknowledgement

Bottom-bar presence is a pure projection with this priority: attention, unread failure, running, queued, unread canceled, unread completed, unavailable, idle. Each thread contributes to at most one category. The projection remains visible when work detail is collapsed. While status is running, the Flower glyph may rotate at a restrained linear cadence; reduced-motion disables rotation, and a visible status marker plus accessible status text remain authoritative because motion is never the only signal.

Every Activity `markThreadRead` call passes one final gate. The gate requires Activity foreground, document visibility, a visible and engaged Flower placement, no launcher, current chat panel, exact selected detail, a matching after-paint content-presented token, no bootstrap/loading/error state, and the current selection sequence. Collapsed, Workbench foreground, launcher presentation, hidden transcripts, staging, and recovery cannot acknowledge read. Background polling may refresh summaries but consumes selected live events only after the exact canonical bootstrap is visible and engaged again.

## Ownership boundary

Floret owns canonical turn, run, message, activity, approval, input, todo, and lifecycle projection. Redeven owns product thread settings, queued follow-up commands, user-scoped read acknowledgement, placement, quick-entry handoff, focus routing, local drafts, and visual state. Activity must not add a transcript cache, event reducer, thread database, lifecycle endpoint, alternate admission path, or second Flower surface.

# Boundaries

Workbench Flower geometry, wheel guards, floating layers, canvas input handoff, and `aiThreadFocusRequest` remain unchanged. Activity focus requests use a distinct consumed request namespace. Only Activity Bar selection enters `full_page`; bottom-bar quick entry and ordinary Activity Ask Flower handoff enter `expanded` without changing the active business surface.

The companion never auto-expands for completion, failure, approval, or input. Presence communicates progress without stealing focus. Related Flower dialogs, menus, previews, thread switchers, and launchers are inside the outside-interaction boundary. Mode switch, access gate, or recovery hides the surface without leaving focus inside an inert or `aria-hidden` ancestor.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:1189` - Activity derives mobile-rail and companion geometry from the visual viewport, safe areas, connected anchors, and the measured MobileTabBar.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:3734` - one kept-alive `EnvAIPage` is Portal-mounted and changes presentation without creating another surface.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:3783` - desktop and mobile placements reuse the same accessible quick-entry control and handoff handlers.
- `redeven:internal/envapp/ui_src/src/ui/activityFlowerFrame.ts:25` - the pure frame resolver enforces collapsed, fixed overlay, and full-page geometry.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:2748` - read acknowledgement requires exact engaged, selected, loaded, and after-paint presented state.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:3997` - a visible engaged surface consumes quick text into the existing new-chat composer session.
- `redeven:internal/flower_ui/src/flowerCompanionPresence.ts:52` - canonical summaries produce the pure bottom-presence priority projection.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.desktopFloatingSurfaces.e2e.test.tsx:755` - lifecycle tests prove one Activity Flower DOM instance across all three placements.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.desktopFloatingSurfaces.e2e.test.tsx:998` - launcher tests preserve the ordinary Activity surface and focus the admitted thread in the overlay.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.flowerCompanion.browser.test.tsx:841` - real production MobileTabBar tests prove visible Ask Flower handoff, fixed geometry, body stability, outside close, and collapsed progress.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.flowerCompanion.browser.test.tsx:902` - mobile browser tests prove visual-viewport and safe-area behavior above the soft keyboard.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.flowerCompanion.browser.test.tsx:961` - the same Flower DOM and one quick input re-anchor across the production 767/768 breakpoint.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.composerHandoff.test.tsx:44` - focused tests prove draft preservation, selection, acknowledgement ordering, and request deduplication.
