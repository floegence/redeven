---
type: UI Contract
title: Flower subagent detail presentation
tags: [ai, flower, subagents, ui]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Floret parent-scoped List owns membership; complete child ThreadView owns details. Open stable immediate live windows without polling/reflowing sync UI. Routes require thread_id/task_name; malformed identity or mismatched parent-child fails without inferred legacy aliases.

# Contract

The parent header replaces the numeric robot badge with at most three circular canonical portraits and a separate `+N` remainder.

Single-target operations place the compact portrait/name capsule beside the action title. A deferred target field reserves the same line from its summary, before action or identity reads finish. Loading and read failures stay in that slot; long names truncate without wrapping. Touch targets and enlarged fonts retain stable row geometry. Creation failures retain their error details.

The existing field reader remains the sole read owner. Header rendering adds no request, polling, measurement loop, or child-detail prefetch. Portraits use bundled SVG selected by canonical `thread_id`. An identity without authorized parent membership remains informational; only the existing parent inventory enables child navigation. Name-only targets use the same compact capsule without inventing a portrait or navigation identity, including deferred fields and creation failures. Creation titles contain only the action; the capsule owns the task name and its full tooltip.

[Subagent detail window](flower-subagent-detail-window.md) owns complete current-view reads, live replacement, Activity rendering, child navigation, and queued-input controls.

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

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.subagentDisclosure.browser.test.tsx` - Tests.
- `redeven:internal/flower_ui/src/SubagentAvatarStack.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.subagentHeader.browser.test.tsx` - Tests.
- `redeven:internal/ai/types.go:172` - Source.
