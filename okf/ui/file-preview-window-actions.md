---
type: UI Contract
title: File preview window actions
description: Read files in Activity and Workbench with one set of product actions in the existing title bar.
tags: [ui, files, preview, floating-windows, selection]
timestamp: 2026-09-18T00:00:00Z
---
# Summary

Redeven owns file-preview actions and document state; published Floe Webapp owns
the floating window and Workbench widget title-bar action slots. Activity previews
on desktop and Workbench previews show the file name on the left and compact file
actions on the right, before the trailing window controls. The separate path row is absent. Moving actions must preserve file
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

## Workbench reading space and narrow widgets

Workbench shows the file name in its existing header and exposes the full path
through the title tooltip and copy action. Its body starts directly below the
header, except when an existing pending-sync notice is present. Header actions
retain the current theme height and remain separate from window controls.

At widget layout widths below 480 CSS pixels, file actions use a single More
file actions button. Wider widgets show compact icons. Canvas zoom does not
change that breakpoint. Both presentations use the same action definitions,
permissions, disabled states, and feedback. Resizing across the breakpoint
closes any open menu without remounting the document or losing its draft.

The menu uses the existing local `FloatingContextMenu` and `SurfaceFloatingLayer`
contract. Opening captures the owning preview's selection before menu focus
moves. The snapshot lasts only for that menu session and is cleared on dismissal
or file changes. Clicking the toggle again closes the menu; its pointer and focus
events belong to the menu boundary. Keyboard navigation, Escape/Tab dismissal, and focus restoration
must not activate canvas gestures or reclaim focus through the widget shell.

## One action implementation

`FilePreviewActions` owns action presentation and temporary copy feedback. It
invokes the existing controller and product callbacks without owning another
draft or save lifecycle. The desktop surface renders it once in the title bar
and suppresses the content header. Workbench uses the same actions through
`WorkbenchWidgetHeader`, supplied by its body without moving the controller or
remounting document content. Mobile dialogs keep the inline header.

Ask Flower prioritizes the controller's editor selection, then reads a DOM
selection contained by the current preview body. A selection in another surface
does not become preview context. Header button input must preserve the selected
reading text. The existing Ask Flower intent builder remains authoritative for outbound
context: it sends file paths, without inlining selected file text. Downloads keep
the current file and draft mapping owned by the product download command builder.

# Boundaries

Preview loading and error presentation remain in the body. Save errors and
unsaved-close confirmation retain their existing controller and local modal
ownership. A title-bar layout change must not add a second close policy or
bypass discard confirmation. A Workbench removal request must publish its pending
removal flag and confirmation state together. Confirmed discard must publish
confirmation dismissal and preview closure together, so observers cannot
mistake either transition for cancellation. The [floating layer contract](env-app-floating-layer-order.md)
owns stacking and modal placement; [Workbench input ownership](workbench-input-ownership.md)
owns reading-surface selection and scrolling.

Preview scale, content bounds, and asynchronous renderer ownership follow the
[viewport and rendering contract](file-preview-viewport-and-rendering.md).

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewSurface.tsx` - Chooses title-bar actions for desktop and the inline header for mobile.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewActions.tsx` - Shares action availability, copy feedback, and preview-local selection mapping.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewPanel.tsx` - Retains the body and unsaved-change confirmation boundary.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewSurface.browser.test.tsx` - Exercises the published window, narrow layouts, native button input, and Markdown selection.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewContent.test.tsx` - Preserves inline action behavior and editing availability.
- `redeven:internal/envapp/ui_src/src/ui/workbench/WorkbenchFilePreviewWidget.tsx` - Supplies header actions from the existing controller and suppresses the body toolbar.
- `redeven:internal/envapp/ui_src/src/ui/workbench/WorkbenchFilePreviewWidget.browser.test.tsx` - Verifies reading space, responsive actions, selection, and local menu input on the published Workbench.
