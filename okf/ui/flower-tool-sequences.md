---
type: UI Contract
title: Flower consecutive tool sequences
description: Compact tools and bounded thinking without hiding dialogue or taking over active reading.
tags: [ui, flower, activity, thinking, disclosure, accessibility]
timestamp: 2026-10-21T00:00:00Z
---
# Summary

Flower groups consecutive tool calls in the shared Desktop and Env App timeline.
Thinking bounded by tools becomes an inline node in that sequence. Older settled
sequences collapse while the newest sequence and active tools remain expanded.
This is product presentation over existing published Floret facts; it introduces
no upstream contract, canonical summary or backend migration.

# Contract

## Boundaries and identity

A sequence requires at least two tool calls with the same thread, turn and run.
Successful, active and failed ordinary tool activity and argument previews qualify.
Leading and trailing thinking retain the existing standalone disclosure; only
thinking between calls joins a sequence. Counts distinguish calls from thinking
segments and failed calls without generating semantic summaries. Even a newer
single-call segment makes an earlier untouched sequence eligible for automatic
collapse.

Prose, user messages, interactions, parent events, compaction, Goal updates,
SubAgent operations, approvals, uncertain effects and non-tool errors break
sequences. Failed ordinary tool calls remain in the group, with a visible failed
count and a yellow status color on the original tool glyph; expanding the group
retains each call's original error details. Approval and waiting rows remain
outside tool folding. Whole-turn disclosure continues to use its separate
canonical eligibility and existing thinking policy. Sequence grouping never
alters that order, the source blocks, or final output.

Canonical tool identities and content-block keys own row lifetime. The first
call owns the sequence identity through appends and status changes. A thought
becoming bounded changes its presentation in place without reparenting its body.
The existing tool trigger, semantic type glyph, independent details and
secondary file actions remain intact. Failed calls retain their type glyph and
use the existing theme warning token as its status color. One thin line connects
the existing icons. Completed rows use existing quiet theme tokens; active rows
keep existing foreground treatment.
Tool title font size and line height remain unchanged. Inline thinking uses a
16px Lucide Brain glyph with a 1.7 stroke; standalone thinking keeps its chevron.

## Disclosure and reading

The existing interface-lifetime disclosure store owns sequence choices in a
runtime/thread/tool namespace. Automatic collapse settles once. Explicit open or
closed choices survive new content, reconnects and navigation within the surface;
refresh restores defaults. Focus, selection, a pressed gesture, manually opened
details or thinking, and visible reading away from the tail retain expansion.
Protection also runs before previously independent content joins a closed group.
There is no delayed collapse retry.

Group collapse keeps existing rows mounted to preserve inner detail state while
making them inert and inaccessible. Outer whole-turn closure still releases its
body after motion. The existing motion controller and the timeline's shared
completion tracking report to the sole transcript scroll controller. Manual
collapse returns interior focus to the sequence button; automatic folding above
the reader preserves visible content position. User scrolling takes precedence.

Native controls expose all controlled viewport IDs, localized counts and
expand/collapse labels. Hidden nodes leave no repeated inter-message gaps.
Reduced motion, visible focus, forced colors, narrow layouts and comfortable
pointer targets follow existing Flower rules. Both product catalogs explicitly
translate the shared copy for every shipped locale.

# Boundaries

Sequence state is ephemeral host UI state. It cannot authorize tools, summarize
model context, infer execution outcomes or write another durable lifecycle.
Published upstream components and the canonical timeline remain the sources of
mechanics and facts. See [activity interaction](flower-activity-interaction.md)
and [whole-turn disclosure](flower-turn-process-disclosure.md) for their owners.

# Evidence

- `redeven:internal/flower_ui/src/flowerToolSequences.test.ts` - Bounded thinking, failed and active tool counts, interaction boundaries, recent-segment policy and stable identity.
- `redeven:internal/flower_ui/src/FlowerToolSequenceNode.tsx` - Mounted stable rows, native group disclosure and existing motion integration.
- `redeven:internal/flower_ui/src/FlowerTurnTimeline.tsx` - Existing store, reading protection and sole scroll owner.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.toolSequences.browser.test.tsx` - Live appends, focus, selection, gestures, detail retention, navigation, theme typography and reading anchors.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.turnProcess.browser.test.tsx` - Whole-turn disclosure and independent thinking regression coverage.

## Qualification limit

The existing whole-turn Goal-editor browser case also fails on the unmodified
feature base `69833567d`: the completed Goal tag is absent before its `closest`
assertion. That baseline failure is excluded from passing evidence for this
change; the focused sequence suite and remaining whole-turn regressions pass.
