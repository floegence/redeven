---
type: UI Contract
title: Flower file edit preparation
tags: [ui, flower, tools, streaming]
lifecycle: contract
reviewed_at: "2026-10-28"
---
# Summary

Flower shows candidate filenames while file-editing arguments are being prepared.
The existing Floret argument preview is display-only; actual tool results remain
the authority for completed changes. Progressive names keep long preparations
understandable while one stable activity row continues through approval and
execution.

# Contract

Tool schemas are the single declaration-order authority. For `apply_patch`, Redeven observes complete canonical Add/Update/Delete headers and optional Move headers before the body finishes.

Actual result names and counts replace previews on settlement. A failed patch
shows only confirmed mutation diffs before its error, retaining the error status
and stable disclosure row. Validation failure shows no completed-edit preview.
A partial Move presents the confirmed destination create/update, not a rename.
Confirmed local mutation targets support the existing authorized file navigation;
preview paths and unconfirmed operations never acquire file actions.

# Boundaries

Candidate names never create file actions, authorize paths, admit tool execution, or become durable conversation state. Current views use the existing [Flower live timeline](flower-live-timeline.md) transport and publication owner.

# Evidence

- `redeven:internal/ai/flower_argument_preview.go` - Incremental bounded filename extraction from canonical patch headers.

- `redeven:internal/ai/flower_argument_preview_test.go` - Partial paths, chunk boundaries, rename/delete, Unicode, body isolation, and display bounds.

- [Browser acceptance](../../internal/envapp/ui_src/src/ui/FlowerSurface.toolFailures.browser.test.tsx) - No-edit validation and confirmed destination diffs remain readable with one error notice at desktop English/light and narrow Chinese/dark sizes.
