---
type: UI Contract
title: Flower consecutive tool sequences
description: Compact tools and bounded thinking without hiding dialogue or taking over active reading.
tags: [ui, flower, activity, thinking, disclosure, accessibility]
timestamp: 2026-10-21T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-27"
---
# Summary

Desktop/Env App group consecutive tools with adjacent thinking. Active groups open; the first following prose or canonical turn end folds eligible groups, never temporary gaps. Explicit inspection survives. Answered input splits settled work into independently closed groups. This is presentation over published Floret facts, with no canonical summary or migration.

# Contract

## Membership and counts

A group has ≥two nodes in one thread/turn/run, including a tool. One call plus thinking qualifies; standalone thinking does not. Calls, failures, argument previews and adjacent leading/trailing thinking retain source order, outputs/actions/errors. A newer singleton may settle an older group without overriding its explicit choice.

Prose, users, interactions, compaction, approvals, non-tool errors and Goal updates break groups. Goal/Web Search calls remain tools. SubAgent calls and canonically scoped report/completion events join; unknown parent-event ownership breaks. Returned uncertain tool errors stay with their exact identity and display localized unconfirmed counts when coverage is complete, including folded state. Invalid success-with-uncertainty or uncertain parent lifecycle events break. Running attention/SubAgent waits join; other waits break. Empty live assistant placeholders are transparent; unknown text bodies cannot establish continuity. Answered input splits settled work into independently closed sequences, including the newest. Active calls and whole-turn disclosure retain their policies.

Canonical call IDs retain row lifetime; thinking moves in place. Pagination keeps the loaded anchor's choice while canonical first-node DOM takes ownership, including subsequent navigation. Icons use theme-owned active/completed/failure states.

Counts require known boundaries and no missing internal items/events; partial windows and running turns may contain complete groups. Unknown coverage shows only localized Consecutive tool calls (also accessible name), with no partial totals, running count, latest-tool preview or loading message. Known failures retain attention/detail behavior. Ordinary pagination may complete counts in place, retaining disclosure/focus/selection. Statistics never acquire history, whole turns, receipts or bodies.

## Disclosure and bodies

Session choices key runtime/thread/tool. Defaults settle initially and once when an active open group becomes eligible to fold. Explicit choices survive updates, completion, reconnect and navigation until refresh. Focus/selection/gestures/open details/thinking/away-from-tail reading protect expansion but cannot reopen a closed group; direct disclosure or explicit navigation can. Choice subscriptions are per-group.

An eligible live sequence closes over 180 ms before its newly arriving prose paints. The timeline holds the following prose blocks' visibility and accessibility until the existing motion finishes, including blocks arriving during the fold; canonical updates and streaming text continue without buffering or remounting. Existing visible prose, active calls, inspected groups, historical mounts, navigation and reduced motion do not wait. Title arrivals finish first. Whole-turn settlement follows the sequence transition. Only the outer shared viewport animates; nested members retain geometry and inert semantics. Manual reversal keeps pending prose hidden until the new motion settles; inspection without motion, disposal and reduced motion release it immediately.

Closed groups mount shells/summary only. First expansion mounts details; later folding makes retained bodies inert. New members of manually closed groups wait. Whole-turn closure retains inspected bodies after motion. Existing owners lend DOM to the first node viewport and restore it on disposal, retaining focus/selection/nested state. Growth retains group/member identity; only changed membership/status/disclosure/order replaces its projection.

Thinking hydration observes its displayed movable node, not the vacated shell. Sealed pending thinking admits demand only when explicitly expanded and visible through nested clipping; live thinking keeps its policy. The shared two-slot queue gives interactive priority to explicit demand; fold/offscreen/navigation cancels obsolete reads. Completed text is reusable; loading reflects actual demand. Unopened tools neither read nor mount detail bodies.

## Geometry and input

The group control shares the first activity line; singletons and leading thinking never reserve a blank title row. Reserve only a 1.5rem disclosure column (2.75rem on coarse pointers) and the native scrollbar gutter from the first candidate. Later calls reveal the control without moving or narrowing existing content. Expanded groups show the arrow beside activity titles and their independent detail controls; the localized summary remains accessible. Folded groups show that summary across the same first line. The control stays reachable while the shared body scrolls. Rows remain 2rem desktop, 2.75rem coarse pointer. Sequence viewport: ten rows, ≤65% transcript height; details share it, short content keeps natural height. Thinking: 20rem, ≤45% window and transcript limit. Both have thin scrollbars, keyboard focus, localized names and reachable controls.

Thinking, sequences and read-only terminal/file/diff/excerpt/code regions chain native scrolling; consume only locally scrollable input, forwarding short/edge input to ancestors. Transcript wheel/touch/keyboard upward intent pauses following; actual bottom return resumes. Explicit containment, cancelled events and zoom stay local; interactive terminals/editors keep ownership.

The upper clipping edge suppresses a connector only after its source icon leaves the viewport; visible adjacent icons retain their connection. The existing scroll/layout callback hit-tests one boundary row and its predecessor, with at most three geometry reads, no whole-list scan, new observer, timer or reactive scroll state. Unchanged boundaries do not write attributes. Closing/navigation clears the ephemeral marker.

Inner content/transcript use the same input-aware controller; wheel/touch/keyboard/scrollbar reading pauses following, while programmatic events, geometry, images and row placement create no intent. Each open sequence observes mounted children through that owner, retaining nested input and anchors. Explicit opening positions latest tool before paint, including calls received while folded. Navigation waits for row placement and both destinations. Restored details have no preparation-time opening motion. Manual folds stay closed; complete counts may include the canonical latest-tool label without body reads. Collapse focuses its button. Thinking retains completion state and saved offset. [Activity motion](flower-activity-interaction.md#visual-motion) coordinates placement/arrival scrolling.

Controls expose viewport IDs/localized counts; closed members leave no gaps and candidate control slots remain inaccessible until eligible. Auto-fold uses [turn disclosure](flower-turn-process-disclosure.md) offset policy; manual toggles retain trigger anchors. Both catalogs share narrow/touch/focus/reduced-motion/forced-color behavior.

# Boundaries

Sequence state is ephemeral presentation. It cannot authorize tools, summarize
context, infer effects or persist lifecycle state. Published upstream components
and the canonical timeline own behavior. See [activity interaction](flower-activity-interaction.md)
and [whole-turn disclosure](flower-turn-process-disclosure.md).

# Evidence

- `redeven:internal/flower_ui/src/flowerToolSequences.test.ts` - Classification, counts, boundaries, collapse and stable identity.
- `redeven:internal/flower_ui/src/flowerToolSequenceLayout.ts` - Stable row placement inside a shared bounded viewport.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.toolSequences.browser.test.tsx` - First-line geometry, native disclosure, retained reading state and bounded scrolling.
