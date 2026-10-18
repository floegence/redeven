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

The parent transcript interleaves canonical events by received time without reordering existing messages or their decorations. Event identity supplies a stable row key, so body hydration and admission updates preserve an open report. Events remain visible outside collapsed turn-process groups. The [subagent dropdown](flower-subagent-detail.md) remains a task inventory and navigation surface; it does not repeat reports. Ordinary progress remains in the child view rather than producing event rows.

Each report displays the canonical child avatar, source task, received time and one selectable content region, clipped to two lines while collapsed. Disclosure expands that same region in place without repeating a preview; expansion anchors its start, while collapse anchors the action through the existing transcript viewport controller. The full-report disclosure and source navigation share one action row below the content. Automatic completion, failure, cancellation, interruption, timeout, input and approval events use the same avatar with a compact localized status and inline source action. Complete handoffs and failure details remain in the original child detail and management results. If current membership no longer includes the source, its identity is plain selectable text and navigation is unavailable. The existing parent-scoped child-detail selection owns navigation; nested child-detail transcripts do not introduce another event reader or navigation scope.

The current view contains bounded metadata without report text. When reports are present, the UI reads the canonical fixed first/last range through the existing authorized read operation to supply real previews and complete bodies. More events use an explicit cursor. A changed range invalidates extra pages and prunes bodies no longer represented in the current metadata; late responses cannot overwrite another selected thread or range. Admission-only updates preserve pages, report bodies and expansion without another request. Failed reads offer an in-place retry. Busy and error states are local to reading and never alter canonical receipt or admission.

Both Env App and Desktop call the authorized POST recipient route with a strict request body. Reads do not answer input or approval, change admission, start execution, or infer authority from an event identifier. Expanded reports preserve complete Unicode and native text selection inside the parent transcript. Compact controls stay on one line and fit narrow light/dark surfaces.

# Boundaries

[Subagent runtime](../ai/subagent-runtime.md) owns delivery, tool authorization and complete report reads. Floret remains the only durable owner. The timeline must not add an inbox, model-read receipt, transcript, lifecycle cache, or periodic refresh. It does not copy reports into model context; the canonical admission path does that at the next natural provider boundary.

# Evidence

- `redeven:internal/flower_ui/src/parentEvents.tsx` - Canonical avatars, inline disclosure, fixed-range reads and stale-response isolation.
- `redeven:internal/flower_ui/src/flowerTimelineProjection.ts` - Chronological parent event insertion and stable event keys.
- `redeven:internal/ai/parent_events.go` - Recipient authorization and canonical event reads.
- `redeven:internal/ai/flower_runtime_current_publisher.go` - Receipt, admission and resolution boundaries.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.parentEvents.browser.test.tsx` - Full Unicode reading, navigation, pagination and narrow themed surfaces.
