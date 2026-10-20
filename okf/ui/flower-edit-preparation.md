---
type: UI Contract
title: Flower file edit preparation
description: Show candidate filenames while tool arguments stream without authorizing or executing edits.
tags: [ui, flower, tools, streaming]
timestamp: 2026-10-19T00:00:00Z
---
# Summary

Flower shows candidate filenames while file-editing arguments are being prepared.
The existing Floret argument preview is display-only; actual tool results remain
the authority for completed changes. Progressive names keep long preparations
understandable while one stable activity row continues through approval and
execution.

# Contract

Tool schemas are the single declaration-order authority. Published Floret v7.69.0
renders root properties in existing required-array order, then remaining names
alphabetically. Redeven strict conversion preserves that order while retaining
nullable and omitted-argument restoration. Final SDK encoding, aliases and
namespaces complete before the shared upstream renderer orders and freezes
the request for estimation, fingerprinting, dispatch and transport retries.
The generic prompt asks the model to follow schema declaration order. For
file.write the path precedes content; for file.edit it precedes old_string,
new_string and optional replace_all. Models may still emit another valid order;
body-first calls keep updating counts and acquire their names when paths arrive.
Flower shows the name as soon as that complete JSON string arrives, without
guessing from an unfinished path. For `apply_patch`, Redeven observes complete
canonical Add/Update/Delete headers and optional Move headers before the body
finishes. Names accumulate in patch order with duplicates removed; rename names
show both endpoints. The bounded display name uses an explicit ellipsis for
omitted names. Long names truncate inside the responsive title and remain
available in its tooltip.

New names are immediate publication boundaries; growing line counts still
coalesce. Preparation retains the existing row identity through approval and
execution, where a patch without result details keeps its candidate name.
Actual result names and counts replace previews on settlement.

# Boundaries

Candidate names never create file actions, authorize paths, admit tool execution,
or become durable conversation state. Invalid previews follow Floret's existing
discard boundary without changing tool validation or effects. Current views use
the existing [Flower live timeline](flower-live-timeline.md) transport and
publication owner.

# Evidence

- `redeven:internal/ai/flower_argument_preview.go` - Incremental bounded filename extraction from canonical patch headers.
- `redeven:internal/ai/flower_argument_preview_test.go` - Partial paths, chunk boundaries, rename/delete, Unicode, body isolation, and display bounds.
- `redeven:internal/ai/flower_runtime_current_publisher_test.go` - Immediate name publication while numeric previews coalesce.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.streamingStability.browser.test.tsx` - Retained rows, progressive names, narrow viewports, approval, execution, and actual-result takeover.
