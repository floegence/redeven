---
type: UI Contract
title: Flower consecutive tool sequences
description: Compact tools and bounded thinking without hiding dialogue or taking over active reading.
tags: [ui, flower, activity, thinking, disclosure, accessibility]
timestamp: 2026-10-21T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Flower groups consecutive tool calls in the shared Desktop and Env App timeline.
Thinking after the first tool becomes an inline node in that sequence, including
thinking after the final tool. Older settled sequences collapse while the newest
sequence and active tools remain expanded.
When an answered input falls between work segments in a settled turn, each
settled tool sequence remains independently collapsed, including the newest
sequence. Active tools retain their existing disclosure behavior.
This is product presentation over existing published Floret facts; it introduces
no upstream contract, canonical summary or backend migration.

# Contract

## Boundaries and identity

A sequence needs at least two nodes from the same thread, turn and run, including
a tool call. One tool plus following thinking qualifies. Successful, active and
failed calls and argument previews qualify. Running attention does not break a
sequence; waiting and approval do. Leading thinking stays standalone; thinking
from the first tool onward joins. Counts report calls, thinking segments and
failures without generating summaries. A newer single-call segment can make an
older untouched sequence eligible for collapse.

Prose, user messages, interactions, parent events, compaction, Goal state updates,
SubAgent operations, approvals, uncertain effects and non-tool errors break
sequences. Goal calls and Web Search remain tool nodes. Failed calls retain their
errors; summaries show the failure count and existing warning treatment. Whole-turn
disclosure stays separate, and grouping preserves source order and final output.
An answered input receipt is a turn-sequence boundary. When one splits a settled
turn's work, settled sequence groups on both sides default to collapsed; explicit
user choices and active calls continue to use the existing disclosure store.

Empty assistant text placeholders between tool messages are transparent; non-empty
text remains a boundary. Canonical tool identity owns row lifetime, the first call
anchors the sequence through updates, and thinking changes presentation in place.
Existing actions and details remain intact. Adjacent tool icons connect; theme
tokens own active, completed and failure states.

## Disclosure and reading

Choices live for the interface session by runtime, thread and tool. Automatic
collapse settles once; explicit choices persist through updates, reconnects and
navigation, then reset on refresh. Focus, selection, gestures, open details or
thinking, and reading away from the tail protect expansion.

Collapsed groups stay mounted and inert so nested detail state survives. Whole-turn
closure releases its body after motion. The timeline remains the sole scroll owner;
manual collapse restores focus to the group button, while automatic collapse above
the reader preserves position and user scrolling takes precedence.

Controls expose viewport IDs, localized counts and labels. Hidden nodes create no
gaps. Focus, reduced motion, forced colors, narrow layouts and pointer targets
follow shared Flower rules; both product catalogs translate all copy.

# Boundaries

Sequence state is ephemeral presentation. It cannot authorize tools, summarize
context, infer effects or persist lifecycle state. Published upstream components
and the canonical timeline own behavior. See [activity interaction](flower-activity-interaction.md)
and [whole-turn disclosure](flower-turn-process-disclosure.md).

# Evidence

- `redeven:internal/flower_ui/src/flowerToolSequences.test.ts` - Classification, counts, boundaries, collapse and stable identity.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.toolSequences.browser.test.tsx` - Running and completed row layout, updates, interaction state, details, navigation, theme and reading anchors.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.turnProcess.browser.test.tsx` - Whole-turn disclosure and interleaved user-response checkpoints.
