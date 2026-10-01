---
type: UI Contract
title: HTML file preview
description: Open HTML files as isolated interactive pages while retaining explicit source editing.
tags: [ui, files, preview, html, security]
timestamp: 2026-10-01T00:00:00Z
---
# Summary

Redeven owns file classification, authorized reads, edit state, and preview
placement. Published Floe owns HTML document construction and isolation policy.
Opening an HTML file displays its page by default; source editing requires an
explicit action and write permission. The document cannot access the trusted
shell or authenticated resources. Oversized, truncated, or unreadable content
never executes and retains the existing localized preview error surface.

# Contract

## Page rendering

Files ending in `.html`, `.htm`, or `.xhtml`, regardless of case, open as rendered
pages in floating windows, mobile previews, Workbench, and attachment snapshot
previews. The existing authorized byte stream supplies complete UTF-8 content;
the 2 MiB text limit rejects oversized or truncated HTML instead of executing a
partial document. Loading and read failures retain the existing preview states.

Floe's published `sandboxedMarkdownHtml` owns document construction and CSP.
Redeven places that document in an opaque `allow-scripts`, no-referrer iframe;
it never inserts file HTML into the trusted shell or navigates to an authenticated
file endpoint. As with [Flower inline media](flower-inline-media.md), inline
styles, scripts, and embedded data work; shell DOM/storage access, network
requests, external scripts, sibling assets, nested frames, and forms are blocked.
This is a self-contained page preview, not a local website server.

## Placement and interaction

The page fills the reading area and scrolls internally. An unselected Workbench
iframe is inert and cannot intercept pointer, keyboard, or wheel input. Selecting
the widget enables page interaction without remounting it. File identity changes
replace the document even when two files have identical source. Unrelated shell
updates preserve the live document.

## Source editing and snapshots

Edit opens the existing HTML source editor only when write permission permits.
Save, discard, unsaved-change confirmation, and draft download use the existing
controller. Returning from editing displays the last saved source as a page;
unsaved draft bytes are downloadable as HTML. Attachment snapshots remain
read-only and show the attached bytes rather than re-reading the live file.

# Boundaries

[Window actions](file-preview-window-actions.md) owns shared file actions and
draft dismissal. [Workbench input ownership](workbench-input-ownership.md) owns
selection and wheel routing. HTML placement does not add a document bridge,
credential access, resource proxy, or a separate editor lifecycle.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/HtmlPreviewPane.tsx` - Product page placement over published Floe HTML isolation and explicit source editing.
- `redeven:internal/envapp/ui_src/src/ui/widgets/HtmlPreviewPane.browser.test.tsx` - Real HTML/CSS/script rendering, isolation, editing, mobile sizing, and Workbench wheel ownership.
- `redeven:internal/envapp/ui_src/src/ui/widgets/createFilePreviewController.test.ts` - HTML loading, bounded reads, save, discard, and unsaved-change confirmation.
