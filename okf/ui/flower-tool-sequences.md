---
type: UI Contract
title: Flower consecutive tool sequences
description: Compact tools and bounded thinking without hiding dialogue or taking over active reading.
tags: [ui, flower, activity, thinking, disclosure, accessibility]
timestamp: 2026-10-21T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-28"
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

History restoration settles automatic sequence and whole-turn policy without motion before destination exposure; explicit user choices survive. The disclosure choice records whether its transition may animate, so ordinary manual actions restore motion without changing the automatic default. Only admitted live arrivals use the fold-before-prose handoff. Preparation waits for queued row placement even if the latest group is automatic, and skips inner positioning inside folded turns.

Session choices key runtime/thread/tool. Defaults settle initially and once when an active open group becomes eligible to fold. Explicit choices survive updates, completion, reconnect and navigation until refresh. Focus/selection/gestures/open details/thinking/away-from-tail reading protect expansion but cannot reopen a closed group; direct disclosure or explicit navigation can. Choice subscriptions are per-group.

An eligible live sequence closes over 260 ms into the actual shared summary-row height (2rem desktop, 2.75rem coarse pointer), never through zero beneath that row. The summary fades in during the final 100 ms after a 140 ms delay; only one summary layer and the shared viewport animate. Newly arriving prose remains mounted, invisible and inert until geometry settles, then fades in over 160 ms with no translation. Runtime delivery and streaming continue without buffering or remounting. Existing prose, inspected groups, history, navigation and reduced motion do not wait.

Title arrivals finish first. If a terminal snapshot also closes the enclosing turn, that row owns the fold directly; nested sequence geometry stays intact until completion. A terminal snapshot interrupting an existing sequence fold transfers its current opacity/transform so faded tools cannot flash back. The same ephemeral pending-content map identifies the motion owner, including subsequent prose arrivals. Reversal waits for the new motion, while disposal and reduced motion release pending content. No per-tool animation, new observer, timer or per-frame reactive state is introduced; shared-row height is measured once at collapse.

Closed groups mount shells/summary only. First expansion mounts details; later folding makes retained bodies inert. New members of manually closed groups wait. Whole-turn closure retains inspected bodies after motion. Existing owners lend DOM to the first node viewport and restore it on disposal, retaining focus/selection/nested state. Growth retains group/member identity; only changed membership/status/disclosure/order replaces its projection.

Thinking hydration observes its displayed movable node, not the vacated shell. Sealed pending thinking admits demand only when explicitly expanded and visible through nested clipping; live thinking keeps its policy. The shared two-slot queue gives interactive priority to explicit demand; fold/offscreen/navigation cancels obsolete reads. Completed text is reusable; loading reflects actual demand. Unopened tools neither read nor mount detail bodies.

## Geometry and input

Prose, Goal/tool/thinking icons, the folded summary and progress lane share one left edge. A permanent outer gutter is present before any activity arrives; singleton-to-group promotion never changes indentation or inserts a blank title row. The native scrollbar gutter is also stable. Each tool retains its icon and independent detail control. Within the full-width row target, intrinsic text is followed immediately by elapsed time and the detail chevron; only long text shrinks, never those controls. This uses CSS layout without a text-width observer or measurement loop.

Expanded groups have one native button in the left gutter: a downward chevron and a continuous bracket show the bounded group's extent. The whole rail collapses the group; there is no right-side group action. Its hit area is 24px wide, 44px for coarse pointers, outside the tool targets. The same button covers the summary when folded, with an inline chevron after its content. Summary text keeps stable bounds through the crossfade, independent of the rail width. Counts take priority over the optional latest-tool preview on narrow screens. The rail stays outside the scrolling body, follows the existing shared viewport's height and stops before following prose. No per-row connector or scroll-time clipping/hit testing is needed.

Rows remain 2rem desktop, 2.75rem coarse pointer. Sequence viewport: ten rows, ≤65% transcript height; details share it, short content keeps natural height. Thinking: 20rem, ≤45% window and transcript limit. Both have thin scrollbars, keyboard focus, localized names and reachable controls.

Thinking, sequences and read-only terminal/file/diff/excerpt/code regions chain native scrolling; consume only locally scrollable input, forwarding short/edge input to ancestors. Transcript wheel/touch/keyboard upward intent pauses following; actual bottom return resumes. Explicit containment, cancelled events and zoom stay local; interactive terminals/editors keep ownership.

Inner content/transcript use the same input-aware controller; wheel/touch/keyboard/scrollbar reading pauses following, while programmatic events, geometry, images and row placement create no intent. Each open sequence observes mounted children through that owner, retaining nested input and anchors. Explicit opening positions latest tool before paint, including calls received while folded. Navigation waits for row placement and both destinations. Restored details have no preparation-time opening motion. Manual folds stay closed; complete counts may include the canonical latest-tool label without body reads. Collapse focuses its button. Thinking retains completion state and saved offset. [Activity motion](flower-activity-interaction.md#visual-motion) coordinates placement/arrival scrolling.

Controls expose viewport IDs/localized counts; closed members leave no gaps and candidate headers remain inaccessible until eligible. Auto-fold uses [turn disclosure](flower-turn-process-disclosure.md) real-content anchoring policy; manual toggles retain trigger anchors. Both catalogs share narrow/touch/focus/reduced-motion/forced-color behavior.

# Boundaries

Sequence state is ephemeral presentation. It cannot authorize tools, summarize
context, infer effects or persist lifecycle state. Published upstream components
and the canonical timeline own behavior. See [activity interaction](flower-activity-interaction.md)
and [whole-turn disclosure](flower-turn-process-disclosure.md).

# Evidence

- `redeven:internal/flower_ui/src/flowerToolSequences.test.ts` - Classification, counts, boundaries, collapse and stable identity.
- `redeven:internal/flower_ui/src/flowerToolSequenceLayout.ts` - Stable row placement inside a shared bounded viewport.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.toolSequences.browser.test.tsx` - First-line geometry, native disclosure, retained reading state and bounded scrolling.
