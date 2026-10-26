---
type: UI Contract
title: Flower consecutive tool sequences
description: Compact tools and bounded thinking without hiding dialogue or taking over active reading.
tags: [ui, flower, activity, thinking, disclosure, accessibility]
timestamp: 2026-10-21T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Flower groups consecutive tool calls in the shared Desktop and Env App timeline.
Thinking after the first tool becomes an inline node in that sequence, including
thinking after the final tool. On first publication, older settled sequences default closed while the newest
sequence and active tools default open. Later status or grouping updates do not change an already displayed choice.
When an answered input falls between work segments in a settled turn, each
settled tool sequence remains independently collapsed, including the newest
sequence. Active tools retain their existing disclosure behavior.
This is product presentation over existing published Floret facts; it introduces
no upstream contract, canonical summary or backend migration.

# Contract

## Boundaries and identity
A sequence contains at least two nodes in one thread/turn/run, including a tool; one call plus following thinking qualifies. Calls, failures and argument previews qualify. Leading thinking is standalone; thinking after the first tool joins, including after the last call. Counts report calls, thinking and failures without synthesizing summaries. A newer single-call segment can make an older sequence eligible for a disclosure control without changing its current visibility.

Prose, user messages, interactions, parent events, compaction, Goal updates, SubAgent operations, approvals, uncertain effects and non-tool errors break groups. Goal calls and Web Search remain tools; running attention does not break a sequence, waiting/approval does. Empty assistant placeholders are transparent. An answered input splits work in a settled turn: sequences on both sides default closed, including the newest, while explicit choices and active calls retain disclosure policy. Whole-turn disclosure remains independent.

Canonical call identity retains row lifetime; the first call anchors a group and thinking moves in place. Preserve source order, final output, actions and errors. Adjacent icons connect with theme-owned active/completed/failure states.

## Disclosure and reading
Session-local choices are keyed by runtime, thread and tool. Defaults settle only on first observation; both initial visibility and explicit choices survive completion, consecutive calls, updates, reconnects and navigation until refresh. Focus, selection, gestures, open details/thinking and reading away from the tail protect expansion.
Each choice owns its reactive subscription; changing one group cannot notify every historical group. Inspection can retain an already open group but cannot reopen a closed one. Only a direct disclosure or explicit navigation action can reveal it.

Closed groups initially mount only row shells and summary. Details mount on first expansion and remain mounted but inert after folding; new members of manually closed groups wait. Whole-turn closure likewise retains previously inspected bodies after motion. Existing row owners lend DOM to the first node's viewport and restore it on disposal, preserving focus, selection and nested detail state. Unchanged groups/members retain identity during content growth; membership, status, disclosure and order changes replace only affected immutable projections.

Sequence height is bounded by the minimum of 24rem, half the window and 65% of transcript height; thinking uses 20rem, 45% and the same transcript limit. Short content retains natural height, with no canonical truncation. Both expose thin scrollbars, keyboard focus, localized names and reachable summary controls.

Thinking, sequences and read-only terminal/file/diff/excerpt/code details use native ancestor scroll chaining. Inner regions consume only input they can scroll; short regions and outward edge input reach the next ancestor. The transcript controller uses the same wheel/touch/keyboard chain: upward input reaching it pauses following; an actual return to bottom resumes it. Explicit CSS containment, cancelled events and zoom remain local. Interactive terminals/editors retain their input owners.

Inner active content follows until the reader scrolls upward. First opening a sequence positions its latest tool. Reopening restores the saved inner offset and follow choice; calls received while closed cannot reset inspected position. Manual collapse focuses the group button. Thinking remains in the user-selected state on completion and restores its saved inner offset on reopening. [Activity motion](flower-activity-interaction.md#visual-motion) coordinates placement and bounded arrival scrolling with both viewport owners.

Controls expose viewport IDs and localized counts; hidden nodes leave no gaps. Shared narrow-layout, pointer, focus, reduced-motion and forced-color rules apply in both product catalogs.

# Boundaries

Sequence state is ephemeral presentation. It cannot authorize tools, summarize
context, infer effects or persist lifecycle state. Published upstream components
and the canonical timeline own behavior. See [activity interaction](flower-activity-interaction.md)
and [whole-turn disclosure](flower-turn-process-disclosure.md).

# Evidence

- `redeven:internal/flower_ui/src/flowerToolSequences.test.ts` - Classification, counts, boundaries, collapse and stable identity.
- `redeven:internal/flower_ui/src/flowerToolSequenceLayout.ts` - Stable row placement inside a shared bounded viewport.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.toolSequences.browser.test.tsx` - Running and completed row layout, updates, interaction state, details, navigation, theme and reading anchors.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.turnProcess.browser.test.tsx` - Whole-turn disclosure and interleaved user-response checkpoints.
