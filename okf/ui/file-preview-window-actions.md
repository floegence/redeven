---
type: UI Contract
title: File preview window actions
tags: [ui, files, preview, floating-windows, selection]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Redeven owns file actions/drafts; published Floe supplies titlebar slots and window lifecycle. Desktop Activity and Workbench place compact actions beside the filename before window controls. Actions preserve permissions, text selection, download mapping and discard confirmation. Close fences pending work immediately while retaining visible content through retirement.

# Contract

## Title bar and reading space
Activity uses `FloatingWindow.headerActions` via product preview adapters. No separate path row; Copy still copies the full path with success feedback.

## Workbench reading space and narrow widgets
Workbench exposes the full path through tooltip/Copy and begins content beneath its header, except existing sync notices. Keyboard/Escape/Tab/focus behavior cannot trigger canvas gestures or reclaim focus through the shell.

## One action implementation
`FilePreviewActions` owns availability/feedback. Header actions preserve reading selection; the product download builder keeps current file/draft mapping.

## PDF drafts and persistence
Writable PDFs expose Edit file. PDF.js saves full Unicode values; unsupported original fonts use `NeedAppearances` instead of embedded replacement fonts. Downloads always use the product manager.

## Unavailable targets and recovery
Navigation opens current filesystem objects; historical tool/diff/image snapshots retain original content. Failed targets offer Retry/Open parent. [Dismissal](file-preview-dismissal.md) owns resource lifetime and close semantics.

# Boundaries

Preview loading and error presentation remain in the body. A title-bar layout change must not add a second close policy or bypass discard confirmation.

Preview scale, content bounds, and asynchronous renderer ownership follow the [viewport and rendering contract](file-preview-viewport-and-rendering.md).

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewSurface.tsx` - Chooses title-bar actions for desktop and the inline header for mobile.

- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewPanel.tsx` - Retains the body and unsaved-change confirmation boundary.
