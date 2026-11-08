---
type: UI Contract
title: Flower parent event timeline
tags: [ai, flower, subagent_manage, ui]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Floret owns canonical child reports/events and admission; UI owns pages/bodies/disclosure only. Reading wakes neither task. Every full read rechecks recipient authority and canonical fixed-range paging. The parent transcript merges messages, anchored decorations and events by published canonical_ordinal on the queried Path; received time is display-only.

# Contract

Published Floret v7.61.0 supplies optional parent_turn_id from canonical receipt order.

Event headers keep the received time directly after the source/status in one compact row. Long source names truncate within the available width, including narrow companion surfaces. Below 16rem of available inline space, headers reflow to preserve readable status and time with enlarged text. The source-name button is the only child-navigation action; report expansion stays independent. Preserve the default header row height for disclosure anchoring. Layout uses CSS without measurement listeners, polling or extra reads.

Explicit group expansion completes only its finite canonical receipt interval. Source notifications coalesce into the existing reader. A one-record frozen-leaf read validates ancestry before reusing settled non-interaction admission facts; unadmitted and all interaction receipts require status pages. A rejected old path triggers canonical interval replacement. Authorization and transport errors never establish ancestry. This avoids retransmitting an expanded settled archive on every source notification, without adding polling, subscriptions or a durable projection.

An isolated Service/SQLite/scripted-provider browser qualification exercises actual fork, detail and report JSON through the production adapter and FlowerSurface, including read failures and restart.

# Boundaries

[Subagent runtime](../ai/subagent-runtime.md#child-runtime) owns delivery, tool authorization and complete report reads. The timeline must not add an inbox, model-read receipt, transcript, lifecycle cache, or periodic refresh. It does not copy reports into model context; the canonical admission path does that at the next natural provider boundary.

# Evidence

- The parent-event browser suite covers inline timestamp geometry at 292/420/960 px, long names, unavailable sources, mouse/keyboard name navigation, report expansion/scroll anchoring, themes and localized disclosure controls. The prior layout fails all three new geometry cases. Existing ResizeObserver delivery diagnostics also reproduce on the unmodified baseline.
- `redeven:internal/flower_ui/src/parentEvents.tsx` - Source.
