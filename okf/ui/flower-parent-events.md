---
type: UI Contract
title: Flower parent event timeline
description: Important child reports and automatic events in the parent conversation with canonical avatars and compact source navigation.
tags: [ai, flower, subagents, ui]
timestamp: 2026-10-18T00:00:00Z
---
# Summary

- Authority: Floret owns received events and their canonical context admission; the UI holds only presentation pages, report bodies and disclosure state.
- Outcome: important child reports and automatic events appear directly in the selected parent conversation without opening the subagent dropdown.
- Invariants: every event uses the canonical child avatar; receipt, admission and preservation notices do not appear in the timeline. Reading never wakes either task.
- Failure boundary: recipient authorization and canonical fixed-range paging apply to every full read.

# Contract

The parent transcript interleaves canonical events by received time without reordering existing messages or their decorations. Event identity supplies a stable row key, so body hydration and admission updates preserve an open report. Published Floret v7.57.0 supplies optional parent_turn_id from canonical receipt order. The most recently started ordinary parent turn owns each event, including late receipts after its end; context compaction does not advance ownership. Flower never infers ownership from time, delegation, admission or current child membership. Ordinary reports and terminal notifications follow their owning [turn-process disclosure](flower-turn-process-disclosure.md). Unowned events, unresolved input/approval and effect_outcome_unknown safety blockers remain visible even when admitted. The summary counts foldable child dynamics; late updates honor the current choice without opening the group or duplicating rows. The [subagent dropdown](flower-subagent-detail.md) remains a task inventory and navigation surface; it does not repeat reports. Ordinary progress remains in the child view rather than producing event rows.

Each report displays the canonical child avatar, source task, received time and one selectable content region, clipped to two lines while collapsed. Disclosure expands that same region in place without repeating a preview; expansion anchors its start, while collapse anchors the action through the existing transcript viewport controller. The full-report disclosure and source navigation share one action row below the content. Automatic completion, failure, cancellation, interruption, timeout, input and approval events use the same avatar with a compact localized status and inline source action. Complete handoffs and failure details remain in the original child detail and management results. If current membership no longer includes the source, its identity is plain selectable text and navigation is unavailable. The existing parent-scoped child-detail selection owns navigation; nested child-detail transcripts do not introduce another event reader or navigation scope.

The subagent_events list/read tools use localized static Activity rows with the
unique avatars of sources returned by that invocation. Title, tool icon and
avatars share a vertically centered line in the existing Flower style. These
rows have no counts, summaries, disclosure, result panels or navigation; actual
errors remain visible inline. Report text and source navigation stay in the
canonical parent timeline. Source refs are persisted presentation facts, never
read authority or membership. Historical missing refs are enriched through the
existing authorized canonical tool-result reader using exact thread, turn, run
and call identity; neither current child inventory nor current event pages
reconstruct invocation membership, and canonical records remain immutable.

The child report_to_parent tool uses a localized submission title and shows
acceptance only with a confirmed canonical receipt. Its existing disclosure
contains the recorded receipt notice and submitted text. When the accepted
event is already available in the selected parent timeline, the existing child
detail surface can close and locate that original report, expanding its owning
process through the shared disclosure store before focusing the report. No additional event
reader, receipt store or navigation authority is introduced.

The current view contains bounded metadata without report text. When reports are present, the UI reads the canonical fixed first/last range through the existing authorized read operation to supply real previews and complete bodies. More events use an explicit cursor. A changed range invalidates extra pages and prunes bodies no longer represented in the current metadata; late responses cannot overwrite another selected thread or range. Admission-only updates preserve pages, report bodies and expansion without another request. One shared page validator rejects malformed arrays, identities, duplicate events, fixed-boundary drift and cursor loops before canonical publication or explicit-read installation. An absent page means the capability is disabled; a successful empty page contains an array, never null. Canonical failures retain the last accepted view and use workspace resynchronization. Explicit-read failures stay local to reports and never set conversation errors or Stop uncertainty.

One reader owns request state, body hydration, fixed-range pagination and retry. The shared 15-second read deadline releases busy state without claiming transport cancellation; the independent 120-second mutation deadline never retries commands. A failed page retains loaded bodies and its exact cursor for an explicit retry. Thread, range, connection-epoch and disposal changes invalidate old waits and clear timers; late responses cannot overwrite recovery. Admission-only updates keep mounted rows, body content and paging progress. Error and retry remain reachable outside the nonempty transcript branch, with localized report-specific copy. Navigation, drafts, source viewing and canonical Stop confirmation retain their existing owners.

Both Env App and Desktop call the authorized POST recipient route with a strict request body. Reads do not answer input or approval, change admission, start execution, or infer authority from an event identifier. Expanded reports preserve complete Unicode and native text selection inside the parent transcript. Compact controls stay on one line and fit narrow light/dark surfaces.

Parent event pages carry the queried canonical thread in required page-level
thread_id, supplied by published Floret v7.56.0. Individual parent_thread_id
values remain immutable original recipients across forks. Empty wait-result pages
also identify the current parent when the optional capability supplies no page. The shared validator
checks page scope, shape and cursor boundaries; readers and timeline projection
never infer scope from event recipients. Inherited reports remain readable, but
do not grant membership or source navigation. Detail retry keeps the created
fork and never repeats creation. An isolated Service/SQLite/scripted-provider
browser qualification exercises actual fork, detail and report JSON through the
production adapter and FlowerSurface, including read failures and restart.

# Boundaries

[Subagent runtime](../ai/subagent-runtime.md) owns delivery, tool authorization and complete report reads. Floret remains the only durable owner. The timeline must not add an inbox, model-read receipt, transcript, lifecycle cache, or periodic refresh. It does not copy reports into model context; the canonical admission path does that at the next natural provider boundary.

# Evidence

- `redeven:internal/flower_ui/src/parentEvents.tsx` - Canonical avatars, inline disclosure, fixed-range reads and stale-response isolation.
- `redeven:internal/flower_ui/src/flowerTimelineProjection.ts` - Chronological parent event insertion and stable event keys.
- `redeven:internal/ai/parent_events.go` - Recipient authorization and canonical event reads.
- `redeven:internal/ai/flower_runtime_current_publisher.go` - Receipt, admission and resolution boundaries.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.parentEvents.browser.test.tsx` - Full Unicode reading, navigation, pagination and narrow themed surfaces.
- `redeven:internal/ai/parent_event_fork_ui_test.go` - Published runtime scope and real product/browser fork regression.
