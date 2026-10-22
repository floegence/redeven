---
type: UI Contract
title: File preview window actions
description: Read files in Activity and Workbench with one set of product actions in the existing title bar.
tags: [ui, files, preview, floating-windows, selection]
timestamp: 2026-10-16T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns file-preview actions and document state; published Floe Webapp owns
the floating window and Workbench widget title-bar action slots. Activity previews
on desktop and Workbench previews show the file name on the left and compact file
actions on the right, before the trailing window controls. The separate path row is absent. Moving actions must preserve file
permissions, the current draft, preview-local text selection, download behavior,
and the existing unsaved-change confirmation boundary. Closing immediately
invalidates pending work while keeping the current document and title intact
until the published window or mobile dialog retires its content.

# Contract

## Title bar and reading space
The desktop preview passes its actions through `FloatingWindow.headerActions` using the product's `PreviewWindow` and `PersistentFloatingWindow` adapters.

Copying still copies the complete path and briefly confirms success even though the path is no longer displayed in the floating window.

## Workbench reading space and narrow widgets
Workbench shows the file name in its existing header and exposes the full path through the title tooltip and copy action. Its body starts directly below the header, except when an existing pending-sync notice is present.

Keyboard navigation, Escape/Tab dismissal, and focus restoration must not activate canvas gestures or reclaim focus through the widget shell.

## One action implementation
`FilePreviewActions` owns action presentation and temporary copy feedback.

Header button input must preserve the selected reading text. Downloads keep the current file and draft mapping owned by the product download command builder.

## PDF drafts and persistence
Writable PDFs expose the existing Edit file action. PDF.js saves full Unicode field values, but when the original field font cannot encode them, it sets `NeedAppearances` instead of embedding a replacement form font.

No browser-only blob download bypasses the product download manager.

## Unavailable targets and recovery
Navigation opens the current filesystem object, while historical tool results, diffs, and image snapshots retain their original content. A target that fails after opening uses a compact panel with Retry and Open parent folder.

Preview dismissal and resource lifetime follow the [file preview dismissal contract](file-preview-dismissal.md).

# Boundaries

Preview loading and error presentation remain in the body. A title-bar layout change must not add a second close policy or bypass discard confirmation.

Preview scale, content bounds, and asynchronous renderer ownership follow the [viewport and rendering contract](file-preview-viewport-and-rendering.md).

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewSurface.tsx` - Chooses title-bar actions for desktop and the inline header for mobile.

- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewActions.tsx` - Shares action availability, copy feedback, and preview-local selection mapping.

- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewPanel.tsx` - Retains the body and unsaved-change confirmation boundary.
