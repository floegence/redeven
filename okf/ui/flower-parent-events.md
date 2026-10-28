---
type: UI Contract
title: Flower parent event timeline
description: Important child reports and automatic events in the parent conversation with canonical avatars and compact source navigation.
tags: [ai, flower, subagents, ui]
timestamp: 2026-10-18T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-28"
---
# Summary

Floret owns canonical child reports/events and admission; UI owns pages/bodies/disclosure only. Reports appear in the selected parent with canonical child avatars, without receipt/admission/preservation notices. Reading wakes neither task. Every full read rechecks recipient authority and canonical fixed-range paging.

# Contract

The parent transcript merges messages, anchored decorations and events by published canonical_ordinal on the queried Path; received time is display-only. Published Floret v7.61.0 supplies optional parent_turn_id from canonical receipt order.

Event headers keep the received time directly after the source/status in one compact row. Long source names truncate within the available width, including narrow companion surfaces. The source-name button is the only child-navigation action; report expansion stays independent. Preserve the event header row height so removing the duplicate action does not change disclosure anchoring. Layout uses CSS without measurement listeners, polling or extra reads.

An isolated Service/SQLite/scripted-provider browser qualification exercises actual fork, detail and report JSON through the production adapter and FlowerSurface, including read failures and restart.

# Boundaries

[Subagent runtime](../ai/subagent-runtime.md) owns delivery, tool authorization and complete report reads. The timeline must not add an inbox, model-read receipt, transcript, lifecycle cache, or periodic refresh. It does not copy reports into model context; the canonical admission path does that at the next natural provider boundary.

# Evidence

- The parent-event browser suite covers inline timestamp geometry at 292/420/960 px, long names, unavailable sources, mouse/keyboard name navigation, report expansion/scroll anchoring, themes and localized disclosure controls. The prior layout fails all three new geometry cases. Existing ResizeObserver delivery diagnostics also reproduce on the unmodified baseline.

- `redeven:internal/flower_ui/src/parentEvents.tsx` - Canonical avatars, inline disclosure, fixed-range reads and stale-response isolation.

- `redeven:internal/ai/parent_events.go` - Recipient authorization and canonical event reads.
