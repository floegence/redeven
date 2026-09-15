---
type: UI Contract
title: File preview window actions
description: Read files in a compact floating window with one set of product actions in the title bar.
tags: [ui, files, preview, floating-windows, selection]
timestamp: 2026-09-15T00:00:00Z
---
# Summary

Redeven owns file-preview actions and document state; published Floe Webapp owns
the floating window and its title-bar action slot. Desktop previews show the file
name on the left and compact file actions on the right, before the window
controls. The separate path row is absent. Moving actions must preserve file
permissions, the current draft, preview-local text selection, download behavior,
and the existing unsaved-change confirmation boundary.

# Contract

## Title bar and reading space

The desktop preview passes its actions through `FloatingWindow.headerActions`
using the product's `PreviewWindow` and `PersistentFloatingWindow` adapters.
Floe owns the separator, title truncation, window controls, and exclusion of the
action region from title-bar dragging and double-click maximization. Redeven
uses 28px action buttons inside the existing 32px title bar. Document content
begins directly below the title bar without a second path-and-actions row.

The action order is copy path, edit, Ask Flower, and download. While editing,
discard and save replace edit in the same group. Availability follows the
current file, renderer, write permission, loading, dirty, and saving state.
Copying still copies the complete path and briefly confirms success even though
the path is no longer displayed in the floating window.

## One action implementation

`FilePreviewActions` owns action presentation and temporary copy feedback. It
invokes the existing controller and product callbacks without owning another
draft or save lifecycle. The desktop surface renders it once in the title bar
and suppresses the content header. Mobile dialogs and Workbench previews keep
their inline header and use the same action implementation.

Ask Flower prioritizes the controller's editor selection, then reads a DOM
selection contained by the current preview body. A selection in another surface
does not become preview context. Header button input must preserve the selected
reading text. Downloads keep the current file and draft mapping owned by the
product download command builder.

# Boundaries

Preview loading and error presentation remain in the body. Save errors and
unsaved-close confirmation retain their existing controller and local modal
ownership. A title-bar layout change must not add a second close policy or
bypass discard confirmation. The [floating layer contract](env-app-floating-layer-order.md)
owns stacking and modal placement; [Workbench input ownership](workbench-input-ownership.md)
owns reading-surface selection and scrolling.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewSurface.tsx` - Chooses title-bar actions for desktop and the inline header for mobile.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewActions.tsx` - Shares action availability, copy feedback, and preview-local selection mapping.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewPanel.tsx` - Retains the body and unsaved-change confirmation boundary.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewSurface.browser.test.tsx` - Exercises the published window, narrow layouts, native button input, and Markdown selection.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewContent.test.tsx` - Preserves inline action behavior and editing availability.
