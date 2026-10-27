---
type: UI Contract
title: Flower Activity companion
description: Activity presents one Flower surface as a dedicated page or a continuous floating companion without changing canonical ownership.
tags: [ui, flower, activity, companion, read-state, floret]
timestamp: 2026-10-13T03:06:33Z
quality_exception: Cross-surface placement contract spanning Activity, Workbench residency, contextual launch handoff, and viewer read acknowledgement; composer presentation has its own owner.
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Env App retains one Flower product tree across its Activity page, desktop companion and available Workbench widget. Published Floe owns the companion shell; Redeven owns placement, focus and read acknowledgement; Floret owns conversation lifecycle. Changing placement or canvas selection never creates another Flower surface or workspace stream.

# Contract

## Companion ownership
Published `BottomBarCompanion` owns geometry, viewport/safe-area clamps, motion, outside dismissal, Escape and mount handling. Its Portal uses the explicit Activity overlay host, never `document.body`. The collapsed field is centered; bounded detail grows upward without changing body geometry. Running work cannot prevent collapse or destination interaction.

## Activity Terminal footer
Desktop Activity Terminal supplies a 24-pixel anchor in its 28-pixel footer, centered in the terminal column with a shrinkable 360-pixel maximum width. Workbench/mobile terminals supply none. Placement does not create another Flower instance, alter transport or route Flower input through the terminal.

## Stable Flower placement
After first access readiness, one retained `EnvAIPage`/`FlowerSurface` moves among explicit hosts. Visibility drives `hidden`, `aria-hidden` and `inert` together. Available unfiltered Workbench placement survives deselection; canvas selection governs input/focus only. [Settings](flower-setup-and-settings.md#retained-panels) own retained panels/forms.

## Contextual Ask Flower
New companion conversations may capture the desktop Activity origin using its read-only page reader. [Turn launcher](flower-turn-launcher.md) owns sending/context actions.

## Presence and summary
[Presence](flower-companion-presence.md) owns collapsed priority, live tails, completion feedback, composer precedence and workspace observation.

## Dismissal, focus, and reads
Outside capture includes shell, anchor and classified Flower-owned Portals. Trusted cross-origin plugin bridge events join host pointer/focus dismissal without consuming the destination. Shared SSE summaries are activity-only; initial/reconnect read baselines and later read envelopes are scoped to the same `UserPublicID`.

# Boundaries

The Workbench Flower widget retains its existing window, canvas, and focus contracts while contributing only a placement host for the Env App-owned Flower product.

The companion never auto-expands for completion, failure, approval, or user input. Showing an available, unfiltered Workbench Flower widget moves the retained product tree into that widget without starting a second list load or live stream, and later canvas deselection does not move it away.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/plugins/ActivityPluginSurfacePage.tsx` - Active-page trusted bridge interaction projection.

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.localAccess.e2e.test.tsx` - Pinned plugin interaction dismisses Flower without retiring either product surface.
