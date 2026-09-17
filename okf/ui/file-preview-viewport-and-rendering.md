---
type: UI Contract
title: File preview viewport and rendering
description: Fit documents and images to their actual reading area and isolate asynchronous renderer work.
tags: [ui, files, preview, viewport, rendering]
timestamp: 2026-09-17T00:00:00Z
---
# Summary

Redeven owns preview modes, file identity, and renderer lifetimes. Published Floe
Webapp owns local content-box measurement and pure fit-scale calculation. Opening
a PDF, DOCX, or image fits a complete page or image to the available reading area,
including enlargement above 100%. Container changes update automatic fit modes;
manual zoom keeps its chosen scale. Each PDF canvas has one rendering owner and
old document work cannot replace the current document. Normal cancellation is not
an error. A genuine PDF page failure stays local to that page and can be retried.

# Contract

## Reading area and zoom

Sizing uses local CSS pixels, excluding padding and scrollbars. Ancestor CSS
transforms, including Workbench projection, must not change intrinsic document
size. Toolbars occupy normal layout space above the scroll viewport, wrap in
narrow windows, and never cover document content. Fixed minimum media heights must
not push controls beyond a small preview surface.

The initial mode is fit-to-window. PDF and DOCX also offer fit-to-width and actual
size; images offer actual size. Automatic fit may enlarge or shrink beyond the
manual zoom range. Invalid or zero measurements mean not ready, not a zero-scale
render. Percentage presentation must not report a positive tiny scale as zero.
Manual zoom buttons must be monotonic even when starting outside their ordinary
range. Zoom preserves the content around the reading viewport center where scroll
bounds permit. Large content must remain reachable on every edge.

Multi-page documents retain one stable scale derived from maximum individual page
width and height. Fit-to-window must never shrink the entire document stack into
one viewport or change scale merely because another page becomes visible. PDF
page labels consume unscaled reading space. DOCX measures native section layout
and uses the document stack height only for scrolling.

Text, Markdown, and spreadsheets retain their reading layout and scrolling; they
are not scaled into one screen. Video contains the complete frame. Audio controls
remain reachable. Flower attachment windows retain native browser PDF controls
and image containment; their document containers must shrink with the window.

## Rendering ownership

PDF page instances are stable by page number within a document. Each page owns a
single worker from page acquisition through render promise settlement. New scales
replace pending work, cancel the active render, and wait for settlement before
reusing its canvas. Document replacement and page removal invalidate pending
results, errors, and resource cleanup. PDF.js receives a copy of controller-owned
bytes because worker loading may transfer the buffer.

Only nearby PDF pages are mounted. Rasterization respects both the six-million
pixel budget and the 16,384-pixel dimension bound, independently of CSS display
scale and manual zoom limits. Display pixel-density changes refresh the bitmap
without changing the chosen CSS scale. A cancelled or superseded render cannot become a
visible failure. A real failure exposes a localized page message, retry action,
and optional technical details while other pages remain usable.

Each DOCX source owns distinct body and style nodes. A superseded render may finish
only against its detached nodes; it cannot overwrite the current body or install
styles back into the current surface. Layout observers belong to that source and
are disconnected on removal. Image load and error callbacks must match the
currently displayed resource.

# Boundaries

The [window actions contract](file-preview-window-actions.md) owns title-bar file
actions, drafts, and dismissal. The [Workbench input contract](workbench-input-ownership.md)
owns wheel and selection routing. Fit and renderer fixes must not grant an
unselected widget local wheel ownership or alter file authorization, editability,
or native attachment PDF behavior.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/createPreviewZoom.ts` - Shared product zoom policy over published Floe geometry.
- `redeven:internal/envapp/ui_src/src/ui/widgets/PdfPreviewPane.tsx` - Stable page instances, serialized render lifetime and raster limits.
- `redeven:internal/envapp/ui_src/src/ui/widgets/DocxPreviewPane.tsx` - Source-owned DOM and intrinsic section measurement.
- `redeven:internal/envapp/ui_src/src/ui/widgets/ImagePreviewPane.tsx` - Container-responsive image geometry and resource guards.
- `redeven:internal/envapp/ui_src/src/ui/widgets/PdfPreviewPane.test.tsx` - Pending acquisition, cancellation settlement, replacement, budget and retry regression tests.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewSizing.browser.test.tsx` - Real-renderer fit, projection, small-container and host integration checks.
