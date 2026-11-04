---
type: UI Contract
title: Flower child task navigation and detail window
tags: [ai, flower, subagents, ui]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Authorized parent inventory controls child navigation; canonical thread identity chooses portraits and task labels. The detail window reads bounded current state without selecting the parent or creating another stream. Stable capsules, dropdowns and footer preserve reading geometry through updates and failures.

# Contract

## Task presentation
The parent header replaces the numeric robot badge with at most three circular canonical portraits and a separate `+N` remainder.

Single-target operations place the compact portrait/name capsule beside the action title. A deferred target field reserves the same line from its summary, before action or identity reads finish. Loading and read failures stay in that slot; long names truncate without wrapping. Touch targets and enlarged fonts retain stable row geometry. Creation failures retain their error details.

The existing field reader remains the sole read owner. Header rendering adds no request, polling, measurement loop, or child-detail prefetch. Portraits use bundled SVG selected by canonical `thread_id`. An identity without authorized parent membership remains informational; only the existing parent inventory enables child navigation. Name-only targets use the same compact capsule without inventing a portrait or navigation identity, including deferred fields and creation failures. Creation titles contain only the action; the capsule owns the task name and its full tooltip.

[Subagent detail window](#detail-window) owns complete current-view reads, live replacement, Activity rendering, child navigation, and queued-input controls.

## Detail window
The detail GET returns exactly `{ summary, current }` and accepts no paging query. Child currents use the same bounded unsent-text coalescing and transient browser-frame rules as roots, described by [live current transport](flower-live-timeline.md).

The window stacks three in-flow regions: a facts band, the transcript region, and an optional run-progress footer. The footer is a sibling of the transcript region, never an overlay, so a live run indicator can neither cover message text nor change the transcript's measured top and height. The footer centers one fixed-width pill under the window's inline center; [received output progress](flower-output-progress.md#output-progress) owns the pill's stability rules.

Floret remains the lifecycle owner described in [Subagent runtime](../ai/subagent-runtime.md#child-runtime).

# Boundaries

Flower must not recover a missing child identity from activity sidecars, a title, a delegated approval alias, a fallback thread id, or local state.

The dropdown lists tasks only. The empty trigger uses Floe's outline Workflow
icon; canonical portrait stacks remain for existing agents. Empty dropdowns use
a compact text row without an oversized illustration or placeholder card. The published
SurfaceAnchoredLayer owns measured placement, local surface boundaries and
viewport updates, with a six-pixel gap. Never position from an estimated menu
width. Shared floating presence retains entry/exit motion and disables exiting
content; shared overlay masking owns outside dismissal. Arrow/Home/End navigation
and Escape focus restoration remain product task-list semantics.

The detail window must not infer membership from activity, poll for updates, switch the selected parent conversation, persist a second transcript, or replay uncertain effects. [Subagent detail presentation](#task-presentation) owns parent membership, task labels, dropdown and operation capsules.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.subagentDisclosure.browser.test.tsx` - Tests.
- `redeven:internal/flower_ui/src/SubagentAvatarStack.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.subagentHeader.browser.test.tsx` - Tests.
- `redeven:internal/ai/types.go:172` - Source.

- `redeven:internal/ai/flower_current_projection.go` - Source.
- `redeven:internal/flower_ui/src/threadCache.ts` - Source.
- `redeven:internal/envapp/ui_src/src/ui/flower/SubagentDetailWindow.progressDock.browser.test.tsx` - Centered footer below transcript; stable pill/inset as tokens grow 11 to 1234567.
