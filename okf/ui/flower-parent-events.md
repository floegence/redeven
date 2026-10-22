---
type: UI Contract
title: Flower parent event timeline
description: Important child reports and automatic events in the parent conversation with canonical avatars and compact source navigation.
tags: [ai, flower, subagents, ui]
timestamp: 2026-10-18T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

- Authority: Floret owns received events and their canonical context admission; the UI holds only presentation pages, report bodies and disclosure state.
- Outcome: important child reports and automatic events appear directly in the selected parent conversation without opening the subagent dropdown.
- Invariants: every event uses the canonical child avatar; receipt, admission and preservation notices do not appear in the timeline. Reading never wakes either task.
- Failure boundary: recipient authorization and canonical fixed-range paging apply to every full read.

# Contract

The parent transcript merges messages, anchored decorations and events by published canonical_ordinal on the queried Path; received time is display-only. Published Floret v7.61.0 supplies optional parent_turn_id from canonical receipt order.

An isolated Service/SQLite/scripted-provider browser qualification exercises actual fork, detail and report JSON through the production adapter and FlowerSurface, including read failures and restart.

# Boundaries

[Subagent runtime](../ai/subagent-runtime.md) owns delivery, tool authorization and complete report reads. The timeline must not add an inbox, model-read receipt, transcript, lifecycle cache, or periodic refresh. It does not copy reports into model context; the canonical admission path does that at the next natural provider boundary.

# Evidence

- `redeven:internal/flower_ui/src/parentEvents.tsx` - Canonical avatars, inline disclosure, fixed-range reads and stale-response isolation.

- `redeven:internal/flower_ui/src/flowerTimelineProjection.ts` - Chronological parent event insertion and stable event keys.

- `redeven:internal/ai/parent_events.go` - Recipient authorization and canonical event reads.
