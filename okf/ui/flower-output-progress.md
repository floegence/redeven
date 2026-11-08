---
type: UI Contract
title: Flower progress and provisional edit presentation
tags: [flower, streaming, progress, tools]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Floret request facts drive output indicators; frozen tool schemas drive bounded provisional names/counts. Actual result names and counts replace previews on settlement. A failed patch shows only confirmed mutation diffs before its error, retaining the error status and stable disclosure row.

# Contract

## Output progress
### Model request
Each logical request and attempt has its own start, first-output time, last semantic-progress time and estimated received output tokens. Local tools, approvals and user input never use this model-pause presentation.

Only phase text is a live region; numerical updates are readable without repeated automatic announcements.

### Indicator geometry
A live run indicator holds one width while it reports. Inside a host that gives it a bounded track, the mark and phase label keep a constant start inset, the token-and-clock metric keeps a constant end inset, and digits grow only in the free space between them. Reveal dots reserve their full width instead of animating it, so no tick resizes or recenters the indicator. The [subagent detail window](flower-subagent-detail.md#detail-window) supplies that track in its footer rail.

### Progress symbol
The shared Flower mark retains its five-petal geometry.

The symbol is decorative beside the existing localized status text and does not create another live announcement or execution state.

### Edit arguments
The frozen tool definition supplies one optional argument preview parser per call. Their input budget is 1 MiB per call, with bounded JSON depth and field counts.

[Confirmed file Activity](#confirmed-file-activity) remains the durable outcome.

## Edit preparation
Tool schemas are the single declaration-order authority. For `file_apply_patch`, Redeven observes complete canonical Add/Update/Delete headers and optional Move headers before the body finishes.

Validation failure shows no completed-edit preview. A partial Move presents the confirmed destination create/update, not a rename. Confirmed local mutation targets support the existing authorized file navigation;
preview paths and unconfirmed operations never acquire file actions.

## Confirmed file activity
[Task files](../ai/flower-task-files.md) add explicit verified delivery results and a
shared Files panel. The structured result links to the confirmed user destination;
intermediates remain in a separate expandable working-file section.

Published Floret v7.30.0 owns the product-neutral file Activity payload. A read carries bounded content and line metadata.

[Preview recovery](file-preview-window-actions.md#window-actions) keeps unavailable targets actionable without changing historical content.

# Boundaries

Floret owns request accounting and ephemeral thread snapshots. Redeven's pure argument parsers supply only display names and optional counts; they cannot authorize or execute edits. Canonical tool results remain the only durable change facts, and supersede every provisional count.

Candidate names never create file actions, authorize paths, admit tool execution, or become durable conversation state. Current views use the existing [Flower live timeline](flower-live-timeline.md) transport and publication owner.

Activity presentation is not a filesystem authority or a second mutation record. The canonical tool result and Floret Activity lifecycle remain the owners of execution and persistence. Display names are not paths, line counts cannot prove current workspace state, and the UI never fetches a file or recomputes a diff merely to populate a historical row.

# Evidence

- `redeven:internal/flower_ui/src/icons/FlowerIcon.tsx`
- `redeven:internal/flower_ui/src/styles/flower.css`

- No-edit validation and confirmed destination diffs remain readable with one error notice at desktop English/light and narrow Chinese/dark sizes.
