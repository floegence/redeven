---
type: UI Contract
title: HTML file preview
description: Open HTML files as isolated interactive pages while retaining explicit source editing.
tags: [ui, files, preview, html, security]
timestamp: 2026-10-14T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
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
Files ending in `.html`, `.htm`, or `.xhtml`, regardless of case, open as rendered pages in floating windows, mobile previews, Workbench, and attachment snapshot previews.

It renders an opaque `allow-scripts`, no-referrer iframe; it never inserts file HTML into the trusted shell or navigates to an authenticated file endpoint.

The current Activity file preview and Workbench same-file reuse rules still own placement.

## Placement and interaction
The page fills the reading area and scrolls internally. An unselected Workbench iframe is inert and cannot intercept pointer, keyboard, or wheel input. Unrelated shell updates preserve the live document.

## Source editing and snapshots
Edit opens the existing HTML source editor only when write permission permits. Attachment snapshots remain read-only and show the attached bytes rather than re-reading the live file.

# Boundaries

[Window actions](file-preview-window-actions.md) owns shared file actions and draft dismissal. Synthetic clicks, forged messages, sibling iframes, and retired documents cannot invoke its host handler. User-activated file navigation does not authorize automatic loading of neighboring assets or add a separate editor lifecycle.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/HtmlPreviewPane.tsx` - Product page placement over published Floe HTML isolation and explicit source editing.

- `redeven:internal/envapp/ui_src/src/ui/widgets/HtmlPreviewPane.browser.test.tsx` - Real HTML/CSS/script rendering, isolation, editing, mobile sizing, and Workbench wheel ownership.

- `redeven:internal/envapp/ui_src/src/ui/widgets/createFilePreviewController.test.ts` - HTML loading, bounded reads, save, discard, and unsaved-change confirmation.
