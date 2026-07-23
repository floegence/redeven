---
type: UI Contract
title: Flower Activity companion
description: Activity presents one Flower surface as a dedicated page or a continuous bottom-bar companion without changing canonical ownership.
tags: [ui, flower, activity, companion, read-state, floret]
timestamp: 2026-07-22T00:00:00Z
quality_exception: Cross-surface UI contract spanning Activity placement, shared Flower projection, contextual launch handoff, and Workbench isolation.
---
# Summary

After access first becomes ready, Activity owns one stable `EnvAIPage` and `FlowerSurface`. The published `BottomBarCompanion` provides a centered collapsed field and a bounded detail surface that grows upward without changing body geometry. The dedicated Activity Bar Flower page remains a separate placement of the same Activity-owned product tree. Placement changes hosts, presentation, visibility, and engagement; it never creates a second Activity Flower surface or changes Floret authority. Floret owns admitted lifecycle state, while Redeven owns product placement, read acknowledgement, and ephemeral UI state.

# Contract

## Companion ownership

`@floegence/floe-webapp-core/layout` owns the reusable companion shell, fixed geometry, visual-viewport and safe-area clamping, motion phases, capture-phase outside dismissal, Escape routing, and explicit mount handling. Redeven consumes the published package and does not reuse `FloatingWindow` or `SurfaceFloatingLayer` for this surface. The companion has independent `retained`, `visible`, and `open` inputs: residency, product availability, and expanded geometry are not aliases for one another.

The desktop Bottom Bar keeps a symmetric three-track layout so the anchor stays centered independently of environment and status controls. Mobile uses one product-owned fixed anchor rail above the measured mobile tab bar. Each anchor is a layout placeholder only. The companion Portal mounts to the explicit Activity overlay host and never falls back to `document.body`. A missing or disconnected replacement mount retains the previous shell hidden and inert until the requested mount and anchor are ready.

Shell geometry is an EnvApp bootstrap dependency, not a lazy Flower-product detail. Anchor, overlay, Bottom Bar, mobile rail, and product-root geometry styles load with the main EnvApp stylesheet so the anchor has measurable size before `BottomBarCompanion` creates its content host. The Activity registry always registers the full-page Flower host because registry membership is fixed when the runtime owner mounts. Access readiness still gates every Flower entry, command, companion mount request, and navigation action. Conditional visibility must not be implemented by conditionally registering the host or lazily loading the anchor geometry.

The companion is absent while password access is checking, locked, or resuming. Recovery, Workbench foreground, the Ask Flower launcher, and the dedicated Flower page hide the retained companion without discarding Flower state. A running task never prevents the user from collapsing the companion or clicking another surface.

## Stable Flower placement

Redeven owns a second, stable Portal around exactly one Activity `EnvAIPage`. Its requested target is either the connected companion content host or the connected dedicated full-page host. Target replacement is atomic: if the requested host is unavailable, the product tree remains in its previous connected host hidden, inert, and disengaged. Neither the shell Portal nor the product Portal uses an implicit body mount.

The ordinary Flower composer textarea is literally the collapsed Bottom Bar field and the expanded detail composer. Expansion and collapse do not clone, replace, crossfade, or copy its value, selection, focus, or composition state. Focusing or typing in the collapsed textarea requests expansion while that same node remains mounted. The old quick-entry input, quick draft, IME bridge, composer handoff request, and manual frame resolver do not exist.

Collapsed presentation hides and disengages the header, transcript, thread rail, status lanes, and supporting composer controls while retaining the ordinary textarea. Canonical secret questions and approval decisions are different composer kinds: collapsed presentation shows a compact action that opens the detail surface, while the real password or approval control remains hidden and inert. A presentation change itself never changes composer kind.

Expanded companion presentation keeps an ordinary chat composer to one stable row. The textarea occupies the flexible track; a More button immediately precedes Send. Working directory, permission, model and reasoning, and context usage are available from the upward-opening More panel instead of creating a second footer row. Setup, model-source recovery, handler failure, detail loading, read-only, approval, and user-input composers retain their complete specialized layout. The dedicated Flower page keeps the standard full composer.

Opening animates one shell upward from the anchor while preserving its bottom edge, width, border, background, and clipping boundary. Closing keeps valid geometry through every transition frame. It never clears fixed coordinates during exit, never flashes at the viewport origin, and never changes Activity body height. Reduced motion applies the same final state without geometry or glyph animation.

## Contextual Ask Flower

Activity and Workbench keep the existing `FlowerTurnLauncherWindow` interaction. Opening records the exact origin mode, Activity surface, companion placement, and Workbench anchor where applicable. The Activity Flower instance remains the presence owner but is hidden, inert, disengaged, and unable to acknowledge transcript reads while its launcher is open.

Successful submit closes the launcher and focuses the admitted or uncertain-admission thread. From ordinary Activity it opens the companion detail surface; from the dedicated Flower page it stays full page. Workbench retains its existing widget handoff. Cancel restores the captured origin. Admission and context-action behavior remain defined by [Flower turn launcher](flower-turn-launcher.md).

## Presence and summary

Bottom Bar presence is a pure canonical projection with this priority: attention, unread failure, running, queued, unread canceled, unread completed, unavailable, idle. Each thread contributes to at most one category. A displayed title must be a non-empty canonical title whose `title_status` is `ready`; pending, failed, empty, or missing titles and inferred preview text are not usable. The title search covers the complete highest-priority group, so an untitled first item does not suppress a later ready title.

The collapsed visual line describes work instead of exposing internal aggregates. The semantic leads are `Needs your attention`, `Needs review`, `Working on`, `Waiting to start`, `Stopped`, and `Ready`, localized for every shipped locale. Running work uses the canonical model I/O phase (`preparing`, `waiting_response`, `streaming`, `retrying`, or `finalizing`) as its live lead. One titled item shows lead and title. A single running item whose title is still pending shows the live phase by itself. Multiple items add the count of remaining items. A group without a ready title uses a complete singular or plural sentence. Bare output such as `Failed · 1` is forbidden.

The visual line is single-line and ellipsized. Its tooltip and polite atomic live region use the complete sentence. When a higher-priority item is shown while other work continues, the accessible sentence adds the background running count without diluting the visual call to action. The Flower glyph turns whenever canonical running work exists; text and the status marker remain authoritative, and reduced motion disables rotation.

The collapsed companion has three mutually exclusive contents: a work-status button, a pending approval or secret-input action, or the ordinary textarea. The status button contains the Flower glyph, status marker, and single-line summary, and opens the companion detail surface when activated. It appears only when the textarea draft is empty after trimming, focus is elsewhere, and IME composition is inactive. While the status or pending action is visible, the ordinary textarea remains mounted for identity continuity but its content container is hidden, `inert`, and removed from accessibility navigation. A draft, caret, selection, or composition session always wins.

## Dismissal, focus, and reads

Capture-phase outside pointer dismissal includes the companion shell, its anchor, and explicitly classified Flower-owned Portal surfaces. Unrelated dialogs, menus, and application surfaces are outside even if they later stop propagation. Outside dismissal does not prevent the destination interaction or restore focus. Escape is observed in bubble phase so an owned Portal can consume it first; otherwise it collapses only for companion-owned focus and returns focus to the retained composer or compact action.

Every Activity `markThreadRead` call requires Activity foreground, document visibility, a visible and engaged expanded/full-page placement, no launcher, the current chat panel, exact selected detail, a matching after-paint content-presented token, and no bootstrap, loading, or error state. Collapsed presentation, staging between Portal hosts, Workbench foreground, launcher presentation, recovery, and access gates cannot acknowledge reads. Background polling may refresh canonical summaries while collapsed.

# Boundaries

Workbench Flower remains an independent widget and keeps its existing window, canvas, and focus contracts. Activity companion placement does not add a transcript cache, event reducer, lifecycle endpoint, alternate admission path, or Floret protocol. Related Flower dialogs and previews may continue using their established floating primitives; only the Bottom Bar companion shell is forbidden from doing so.

The companion never auto-expands for completion, failure, approval, or user input. Presence communicates progress without stealing focus. Selecting Flower from the Activity Bar enters the dedicated page; the Bottom Bar and ordinary Activity Ask Flower handoff enter the bounded companion detail surface.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx` - Activity separates the published companion shell Portal from the stable product Portal and explicit full-page host.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - collapsed presentation retains the ordinary composer and gates transcript engagement, secret input, and approval controls.
- `redeven:internal/flower_ui/src/flowerCompanionPresence.ts` - canonical thread summaries produce mutually exclusive priority groups and ready-title selection.
- `redeven:internal/envapp/ui_src/src/ui/activityFlowerSummary.ts` - semantic single-line and complete accessible summaries are projected independently of canonical state.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.flowerCompanion.browser.test.tsx` - browser tests cover continuous geometry, outside dismissal, breakpoint placement, and DOM identity.
- `redeven:internal/envapp/ui_src/scripts/checkPackagedRenderer.mjs` - production-build smoke loads the unmocked lazy Flower feature and verifies one companion, surface, composer, and stable full-page identity.
- `redeven:internal/flower_ui/src/FlowerSurface.visibility.test.tsx` - focused tests cover collapsed engagement, background refresh, and composer identity.
