---
type: UI Contract
title: Flower parent event disclosure
description: Passive child event metadata, explicit full reading, and canonical admission visibility.
tags: [ai, flower, subagents, ui]
timestamp: 2026-10-16T00:00:00Z
---
# Summary

- Authority: Floret owns received events and their canonical context admission; the UI holds only explicit reading pages and disclosure state.
- Outcome: the parent can inspect important child reports and source references without polling or waking either task.
- Invariants: received and added-to-context are distinct; neither label claims that a model read an event.
- Failure boundary: recipient authorization and canonical fixed-range paging apply to every full read.

# Contract

The [subagent dropdown](flower-subagent-detail.md) includes compact source, event kind, and received versus added-to-context metadata from the canonical current view. Receipt, admission and interaction resolution are live publication boundaries. Ordinary progress remains in the child view rather than producing event rows.

Each row provides an explicit full-read disclosure and source-task navigation through the existing child-detail selection. If membership no longer includes the source, its identity is plain selectable text. A full read preserves the complete Unicode report. Automatic event kinds show their canonical reason, interaction and source-entry references; complete handoffs and failure details remain in the original child detail and management results.

The current view contains bounded metadata. More events are read with the same fixed first/last event range and an explicit cursor. A new canonical page invalidates stale metadata pages; late responses cannot overwrite another selected thread or range. An open full report stays readable while the range remains unchanged. Busy and error states are local to reading and never alter canonical receipt or admission.

Both Env App and Desktop call the authorized POST recipient route with a strict request body. Reads do not answer input or approval, change admission, start execution, or infer authority from an event identifier. Long reports scroll inside the existing surface-local floating layer, preserve native selection, and fit narrow light/dark surfaces.

# Boundaries

[Subagent runtime](../ai/subagent-runtime.md) owns delivery, tool authorization and complete report reads. Floret remains the only durable owner. The panel must not add an inbox, model-read receipt, transcript, lifecycle cache, or periodic refresh. It does not copy reports into model context; the canonical admission path does that at the next natural provider boundary.

# Evidence

- `redeven:internal/flower_ui/src/ParentEventsPanel.tsx` - Explicit disclosure, fixed-range pages and stale-response isolation.
- `redeven:internal/ai/parent_events.go` - Recipient authorization and canonical event reads.
- `redeven:internal/ai/flower_runtime_current_publisher.go` - Receipt, admission and resolution boundaries.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.parentEvents.browser.test.tsx` - Full Unicode reading, navigation, pagination and narrow themed surfaces.
