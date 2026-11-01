---
type: UI Contract
title: HTML file preview
tags: [ui, files, preview, html, security]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Redeven classifies files and authorizes reads/edits/placement; Floe constructs isolated HTML pages. Opening renders by default and source editing is explicit/write-authorized. Content cannot reach trusted Shell/resources. Oversized, incomplete or unreadable input never executes and retains localized recovery.

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

- `redeven:internal/envapp/ui_src/src/ui/widgets/HtmlPreviewPane.tsx` - Product placement over published HTML isolation/explicit source edit.

- `redeven:internal/envapp/ui_src/src/ui/widgets/HtmlPreviewPane.browser.test.tsx` - Actual HTML/CSS/script rendering, isolation, edits, mobile/wheel behavior.
