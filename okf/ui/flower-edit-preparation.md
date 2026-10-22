---
type: UI Contract
title: Flower file edit preparation
description: Show candidate filenames while tool arguments stream without authorizing or executing edits.
tags: [ui, flower, tools, streaming]
timestamp: 2026-10-19T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Flower shows candidate filenames while file-editing arguments are being prepared.
The existing Floret argument preview is display-only; actual tool results remain
the authority for completed changes. Progressive names keep long preparations
understandable while one stable activity row continues through approval and
execution.

# Contract

Tool schemas are the single declaration-order authority. For `apply_patch`, Redeven observes complete canonical Add/Update/Delete headers and optional Move headers before the body finishes.

Actual result names and counts replace previews on settlement.

# Boundaries

Candidate names never create file actions, authorize paths, admit tool execution, or become durable conversation state. Current views use the existing [Flower live timeline](flower-live-timeline.md) transport and publication owner.

# Evidence

- `redeven:internal/ai/flower_argument_preview.go` - Incremental bounded filename extraction from canonical patch headers.

- `redeven:internal/ai/flower_argument_preview_test.go` - Partial paths, chunk boundaries, rename/delete, Unicode, body isolation, and display bounds.

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.streamingStability.browser.test.tsx` - Retained rows, progressive names, narrow viewports, approval, execution, and actual-result takeover.
