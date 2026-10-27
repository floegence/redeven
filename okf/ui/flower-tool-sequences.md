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

Flower groups consecutive tools in Desktop and Env App.
Adjacent thinking becomes an inline node in that sequence, including leading and final thoughts. Active sequences default open. Settled sequences fold when following assistant output completes or the canonical turn ends; temporary gaps between calls and unfinished prose do not trigger a fold. Explicit choices and active inspection survive those boundaries.
When an answered input falls between work segments in a settled turn, each
settled tool sequence remains independently collapsed, including the newest
sequence. Active tools retain their existing disclosure behavior.
This is product presentation over existing published Floret facts; it introduces
no upstream contract, canonical summary or backend migration.

# Contract

## Boundaries and identity
A sequence contains at least two nodes in one thread/turn/run, including a tool; one call plus following thinking qualifies. Calls, failures and argument previews qualify. Adjacent leading and trailing thinking joins the group; thinking alone stays standalone. Complete counts report calls, thinking, failures and subtask updates without synthesizing summaries. A newer single-call segment can settle an older sequence without changing its explicit disclosure choice.

Prose, user messages, interactions, compaction, Goal updates, approvals and non-tool errors break groups. SubAgent tools and canonically scoped report/completion events join the sequence; unresolvable parent-event ownership remains a boundary. Returned uncertain tool errors stay in their exact thread/turn/run sequence and show a localized unconfirmed-result count when coverage is complete, including when collapsed; invalid success-with-uncertainty facts and uncertain parent lifecycle events remain boundaries. Goal calls and Web Search remain tools; running attention and SubAgent waits remain in the sequence; other waiting states and approvals break it. Empty live assistant placeholders are transparent; text whose body remains unknown is not evidence of continuity. An answered input splits work in a settled turn: sequences on both sides default closed, including the newest, while explicit choices and active calls retain disclosure policy. Whole-turn disclosure remains independent.

Canonical call identity retains row lifetime; the first loaded node anchors a group and thinking moves in place. Pagination retains an existing anchor while the canonical first node becomes the DOM owner; both share the same disclosure choice for subsequent navigation. Preserve source order, final output, actions and errors. Adjacent icons connect with theme-owned active/completed/failure states.

## Count completeness
A group needs both known boundaries and no missing items or parent events inside its interval. A partial history window can contain complete groups; a running turn can already have complete counts. Unknown coverage shows only the localized “Consecutive tool calls” label, including its accessible name. Do not show partial totals, running counts, latest-tool previews or count-loading messages. Known failures retain attention styling and their original detail behavior. Normal pagination may reveal exact statistics in place, preserving disclosure, focus and selection. Statistics never request additional history, whole turns, receipt pages or unopened bodies.

## Disclosure and reading
Session-local choices are keyed by runtime, thread and tool. Defaults settle on first observation and once when an open active group becomes eligible for automatic collapse. Explicit choices survive completion, consecutive calls, updates, reconnects and navigation until refresh; later observations cannot reopen closed groups. Focus, selection, gestures, open details/thinking and reading away from the tail protect expansion.
Each choice owns its reactive subscription; changing one group cannot notify every historical group. Inspection can retain an already open group but cannot reopen a closed one. Only a direct disclosure or explicit navigation action can reveal it.

Closed groups initially mount only row shells and summary. Details mount on first expansion and remain mounted but inert after folding; new members of manually closed groups wait. Whole-turn closure likewise retains previously inspected bodies after motion. Existing row owners lend DOM to the first node's viewport and restore it on disposal, preserving focus, selection and nested detail state. Unchanged groups/members retain identity during content growth; membership, status, disclosure and order changes replace only affected immutable projections.

Historical thinking reads observe the displayed thinking node, which moves with its sequence, rather than the vacated message shell. Pending sealed thinking registers visibility demand only while explicitly expanded; nested viewport clipping still gates reads. Visible live thinking retains its existing read policy. One shared two-slot queue owns reads, cancellation and retries; explicit thinking demand receives interactive priority. Folding, leaving the viewport and navigation cancel obsolete demand. Completed text stays reusable, and loading status reflects an actual queued/in-flight request. Closed tools never acquire body reads or mount their detail content.

Reserve the sequence header and native scrollbar gutter from the first candidate, including leading thinking. A later call reveals the control without moving or narrowing existing content. Header, singleton and grouped tool rows share 2rem desktop height and 2.75rem coarse-pointer targets. The viewport fits ten rows, capped at 65% of transcript height on short windows. Expanded details share this bounded viewport; short content retains natural height without canonical truncation. Thinking uses 20rem, 45% of the window and the transcript limit. Both expose thin scrollbars, keyboard focus, localized names and reachable summary controls.

Thinking, sequences and read-only terminal/file/diff/excerpt/code details use native ancestor scroll chaining. Inner regions consume only input they can scroll; short regions and outward edge input reach the next ancestor. The transcript controller uses the same wheel/touch/keyboard chain: upward input reaching it pauses following; an actual return to bottom resumes it. Explicit CSS containment, cancelled events and zoom remain local. Interactive terminals/editors retain their input owners.

Inner active content and the transcript use the same input-aware scroll controller. Explicit wheel, touch, keyboard or scrollbar reading pauses following; geometry changes, programmatic scroll events, image loading and row placement cannot create reading intent. Each open sequence observes its mounted children through that owner, preserving native nested input chaining and reading anchors. Every explicit opening positions the latest tool before paint, including reopening after calls arrived while closed. Navigation waits for row placement and the latest active sequence destination as well as the transcript. Restored activity details settle without opening motion during preparation. Manually folded groups remain folded and, when counts are complete, show the latest canonical tool label beside their counts; this preview never requests unopened bodies. Manual collapse focuses the group button. Thinking remains in the user-selected state on completion and restores its saved inner offset on reopening. [Activity motion](flower-activity-interaction.md#visual-motion) coordinates placement and bounded arrival scrolling with both viewport owners.

Controls expose viewport IDs and localized counts; closed members leave no gaps. Reserved headers are inaccessible until eligible. Automatic folding uses the transcript offset policy in the [turn disclosure contract](flower-turn-process-disclosure.md); manual toggles retain their trigger anchor. Shared narrow-layout, pointer, focus, reduced-motion and forced-color rules apply in both product catalogs.

# Boundaries

Sequence state is ephemeral presentation. It cannot authorize tools, summarize
context, infer effects or persist lifecycle state. Published upstream components
and the canonical timeline own behavior. See [activity interaction](flower-activity-interaction.md)
and [whole-turn disclosure](flower-turn-process-disclosure.md).

# Evidence

- `redeven:internal/flower_ui/src/flowerToolSequences.test.ts` - Classification, counts, boundaries, collapse and stable identity.
- `redeven:internal/flower_ui/src/flowerToolSequenceLayout.ts` - Stable row placement inside a shared bounded viewport.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.toolSequences.browser.test.tsx` - Running and completed row layout, updates, interaction state, details, navigation, theme and reading anchors.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.thinkingHydration.browser.test.tsx` - Moved thinking hydration, nested visibility, cancellation, observer cleanup and unopened-detail read bounds.
- `redeven:scripts/check_flower_streaming_performance.mjs` - Built browser/Desktop qualification; `--disclosures=closed` measures streaming, scrolling and composer clicks with hidden detail reads and mounts forbidden.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.turnProcess.browser.test.tsx` - Whole-turn disclosure and interleaved user-response checkpoints.
