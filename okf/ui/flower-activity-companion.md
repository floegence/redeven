---
type: UI Contract
title: Flower Activity companion
description: Activity presents one Flower surface as a dedicated page or a continuous floating companion without changing canonical ownership.
tags: [ui, flower, activity, companion, read-state, floret]
timestamp: 2026-10-13T03:06:33Z
quality_exception: Cross-surface placement contract spanning Activity, Workbench residency, contextual launch handoff, and viewer read acknowledgement; composer presentation has its own owner.
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

After access first becomes ready, Env App owns one stable `EnvAIPage` and `FlowerSurface`. On desktop, the published `BottomBarCompanion` provides a centered collapsed field and a bounded detail surface that grows upward without changing body geometry. The dedicated Activity Bar page and an available, unfiltered Workbench Flower widget are placements of that same product tree. Workbench selection controls canvas input and focus only; clearing selection never revokes Flower placement or engagement. Placement changes hosts, presentation, visibility, and engagement; it never creates a second Flower surface or changes Floret authority. Floret owns thread lifecycle state, while Redeven owns product placement, read acknowledgement, and ephemeral UI state.

# Contract

## Companion ownership
`@floegence/floe-webapp-core/layout` owns the reusable companion shell, fixed geometry, visual-viewport and safe-area clamping, motion phases, capture-phase outside dismissal, Escape routing, and explicit mount handling.

The companion Portal mounts to the explicit Activity overlay host and never falls back to `document.body`.

A running task never prevents the user from collapsing the companion or clicking another surface.

## Activity Terminal footer
Desktop Activity Terminal registers a 24-pixel anchor in its existing 28-pixel footer, centered in the terminal content column with a maximum width of 360 pixels and room to shrink.

Workbench Terminal widgets and mobile terminals never register an entry; their existing footer heights and navigation remain unchanged. This placement does not introduce a second Flower instance, change terminal transport, or route Flower keystrokes through terminal input.

## Stable Flower placement
The product root consumes the same authoritative visibility decision for native `hidden`, `aria-hidden`, and `inert`.

[Flower setup and settings](flower-setup-and-settings.md#retained-panels) owns retained form, editor and inactive-panel semantics.

## Contextual Ask Flower
New companion conversations can include the desktop Activity origin page through the read-only page reader selected by Shell's current Activity ID.

Send and context-action behavior remain defined by [Flower turn launcher](flower-turn-launcher.md).

## Presence and summary
[Flower companion presence](flower-companion-presence.md) owns collapsed status priority, live output tails, completion acknowledgement, composer precedence, and the single workspace observation stream. Presence never changes the placement and focus ownership defined here.

## Dismissal, focus, and reads
Capture-phase outside pointer dismissal includes the companion shell, its anchor, and explicitly classified Flower-owned Portal surfaces. Activity plugin windows project host pointer and focus input plus trusted iframe bridge activation, focus, and action events into the same outside-dismiss behavior, because cross-origin iframe events cannot bubble into the product document.

Shared SSE summaries remain activity-only, while initial/reconnect baselines and later viewer read-state envelopes are scoped to the same `UserPublicID`.

# Boundaries

The Workbench Flower widget retains its existing window, canvas, and focus contracts while contributing only a placement host for the Env App-owned Flower product.

The companion never auto-expands for completion, failure, approval, or user input. Showing an available, unfiltered Workbench Flower widget moves the retained product tree into that widget without starting a second list load or live stream, and later canvas deselection does not move it away.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/plugins/ActivityPluginSurfacePage.tsx` - Active-page trusted bridge interaction projection.

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.localAccess.e2e.test.tsx` - Pinned plugin interaction dismisses Flower without retiring either product surface.

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx` - Env App separates the published companion shell Portal from the stable product Portal and all explicit placement hosts.
