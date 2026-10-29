---
type: UI Contract
title: Flower received output progress
tags: [flower, streaming, progress, tools]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Flower shows how long a dispatched model request has waited and how much output
has arrived. Edit rows show line counts while their arguments are generated,
then use the confirmed tool result. Published Floret v7.42.0 owns the generic
in-memory progress and preview lifecycle; Redeven interprets its own tool JSON
and presents the safe observations. No new journal records or schema changes
are required.

# Contract

## Model request
Each logical request and attempt has its own start, first-output time, last semantic-progress time and estimated received output tokens. Local tools, approvals and user input never use this model-pause presentation.

Only phase text is a live region; numerical updates are readable without repeated automatic announcements.

## Progress symbol
The shared Flower mark retains its five-petal geometry.

The symbol is decorative beside the existing localized status text and does not create another live announcement or execution state.

## Edit arguments
The frozen tool definition supplies one optional argument preview parser per call. Their input budget is 1 MiB per call, with bounded JSON depth and field counts.

[Confirmed file Activity](flower-file-activity.md) remains the durable outcome.

# Boundaries

Floret owns request accounting and ephemeral thread snapshots. Redeven's pure argument parsers supply only display names and optional counts; they cannot authorize or execute edits. Canonical tool results remain the only durable change facts, and supersede every provisional count.

# Evidence

- `redeven:internal/flower_ui/src/icons/FlowerIcon.tsx` — Shared petal geometry, light outline and original dark gradient artwork.

- `redeven:internal/flower_ui/src/styles/flower.css` — Compact progress sizing, whole-bloom rotation and reduced-motion suppression.
