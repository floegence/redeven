---
type: UI Contract
title: Flower received output progress
tags: [flower, streaming, progress, tools]
lifecycle: contract
reviewed_at: "2026-10-29"
---
# Summary

Flower presents dispatched-request waiting/output and provisional edit line counts, then confirmed results. Published Floret v7.42.0 owns in-memory progress/preview lifecycle; Redeven interprets safe product-tool JSON. Presentation adds no journal records or schema changes.

# Contract

## Model request
Each logical request and attempt has its own start, first-output time, last semantic-progress time and estimated received output tokens. Local tools, approvals and user input never use this model-pause presentation.

Only phase text is a live region; numerical updates are readable without repeated automatic announcements.

## Indicator geometry
A live run indicator holds one width while it reports. Inside a host that gives it a bounded track, the mark and phase label keep a constant start inset, the token-and-clock metric keeps a constant end inset, and digits grow only in the free space between them. Reveal dots reserve their full width instead of animating it, so no tick resizes or recenters the indicator. The [subagent detail window](flower-subagent-detail-window.md) supplies that track in its footer rail.

## Progress symbol
The shared Flower mark retains its five-petal geometry.

The symbol is decorative beside the existing localized status text and does not create another live announcement or execution state.

## Edit arguments
The frozen tool definition supplies one optional argument preview parser per call. Their input budget is 1 MiB per call, with bounded JSON depth and field counts.

[Confirmed file Activity](flower-file-activity.md) remains the durable outcome.

# Boundaries

Floret owns request accounting and ephemeral thread snapshots. Redeven's pure argument parsers supply only display names and optional counts; they cannot authorize or execute edits. Canonical tool results remain the only durable change facts, and supersede every provisional count.

# Evidence

- `redeven:internal/flower_ui/src/icons/FlowerIcon.tsx`
- `redeven:internal/flower_ui/src/styles/flower.css`
