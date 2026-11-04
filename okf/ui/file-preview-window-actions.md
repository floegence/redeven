---
type: UI Contract
title: File preview window actions
tags: [ui, files, preview, floating-windows, selection]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Redeven owns file actions/drafts; Floe titlebar/window lifecycle. Compact actions precede window controls in Activity/Workbench, preserving permission/selection/download/discard policy. Close immediately fences pending work but keeps content visible through retirement.

# Contract

## Title bar and reading space
Activity uses published Floe FloatingWindow.titleContent/WindowTabs for multiple documents and headerActions for the active document. One file keeps the ordinary title; two or more replace only the title area with scrollable, closable tabs. Tab selection never drags or maximizes the window. Arrow/Home/End navigation and Delete close remain local; long names truncate and full paths appear as tooltips. No separate path row; Copy still copies the active full path with success feedback.

The Activity preview workspace owns one controller and retained panel per normalized file path. Every filesystem entry point uses this owner; opening an existing path selects its tab without re-reading or discarding changes. Switching preserves editor drafts, renderer nodes, reading position and preview mode; inactive native audio/video pauses. Each tab retains its own actions, load/retry state and error. Close an inactive tab without changing the active one; closing the active tab selects the adjacent survivor. Last-tab close dismisses the window. Window close confirms all unsaved documents together, and cancellation leaves every draft intact. Saving blocks confirmed discard until it settles. Accepted dismissal fences pending reads and releases retained resources after Floe exit presence.

Flower message/attachment floating previews retain their own source-identity tabs through the same upstream header component in both hosts. Source loaders remain independent, repeated opens select the existing source, and close/retirement aborts reads and releases object URLs. Failed attachment loads expose an independent Retry action. Snapshot inspectors and Workbench canvas widgets retain their separate ownership; modal conversation-file navigation retains its existing back-to-list flow.

## Workbench reading space and narrow widgets
Workbench exposes the full path through tooltip/Copy and begins content beneath its header, except existing sync notices. Keyboard/Escape/Tab/focus behavior cannot trigger canvas gestures or reclaim focus through the shell.

## One action implementation
`FilePreviewActions` owns availability/feedback. Header actions preserve reading selection; the product download builder keeps current file/draft mapping.

## PDF drafts and persistence
Writable PDFs expose Edit file. PDF.js saves full Unicode values; unsupported original fonts use `NeedAppearances` instead of embedded replacement fonts. Downloads always use the product manager, including conversation-file child previews; [conversation file ownership](../ai/flower-task-files.md#downloads) defines background lifetime and toolbar history.

## Unavailable targets and recovery
Navigation opens current filesystem objects; historical tool/diff/image snapshots retain original content. Failed targets offer Retry/Open parent. [Dismissal](file-preview-dismissal.md) owns resource lifetime and close semantics.

# Boundaries

Preview loading and error presentation remain in the body. A title-bar layout change must not add a second close policy or bypass discard confirmation.

Preview scale, content bounds, and asynchronous renderer ownership follow the [viewport and rendering contract](file-preview-viewport-and-rendering.md).

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewWorkspace.browser.test.tsx` - Multi-document state, actions, keyboard, narrow header and CSV-mode acceptance.
- `redeven:internal/envapp/ui_src/src/ui/FlowerAttachmentPreviewTabs.browser.test.tsx` - Attachment identity, retry, cancellation and resource release.
- `redeven:desktop/scripts/check-office-preview.mjs` - Real Electron `file://` acceptance verifies header tabs, retained CSV canvas/zoom/source state, close-to-single and Escape.

- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewSurface.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewPanel.tsx` - Source.
