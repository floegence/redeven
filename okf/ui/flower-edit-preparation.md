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

File edit/write instructions ask the model to emit `file_path` before body fields.
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
