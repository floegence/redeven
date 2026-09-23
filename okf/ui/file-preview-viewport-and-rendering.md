---
type: UI Contract
title: File preview viewport and rendering
description: Fit documents and images to their actual reading area and isolate asynchronous renderer work.
tags: [ui, files, preview, viewport, rendering]
timestamp: 2026-09-23T00:00:00Z
---
# Summary

Redeven owns preview modes, file identity, and renderer lifetimes. Published Floe
Webapp owns local content-box measurement, pure fit-scale calculation, and the
PDF document engine with synchronized canvas, text, and annotation layers. Opening
a PDF, DOCX, or image fits a complete page or image to the available reading area,
including enlargement above 100%. Container changes update automatic fit modes;
manual zoom keeps its chosen scale. Each PDF page has one rendering owner and
old document work cannot replace the current document. Normal cancellation is not
an error. A genuine PDF page failure stays local to that page and can be retried.
Markdown enhancement work follows document content: previews without Mermaid
skip diagram theme sampling across theme changes.

# Contract

## Window boundary

The [floating layer contract](env-app-floating-layer-order.md) owns window
placement and visible viewport constraints. Mobile previews fill the available
Dialog content region rather than requesting an independent `100dvh` height.
Desktop previews delegate preferred size, minimum size and edge margins to the
published FloatingWindow. The preview title, close action and document toolbar
remain reachable while the document scrolls in its own reading area.

## Reading area and zoom

Sizing uses local CSS pixels, excluding padding and scrollbars. Ancestor CSS
transforms, including Workbench projection, must not change intrinsic document
size. The reading viewport fills the preview surface. Compact zoom controls float
at its upper right without a separate layout row or reserved padding. Their
position stays fixed while content scrolls. Only the visible controls intercept
pointer input; the remaining overlay area passes through to the reading surface.
The strip stays on one line in narrow surfaces: zoom buttons flank a percentage
menu containing fit-to-window, fit-to-width for documents, and actual size. PDF
page counts remain available in that menu. Controls retain keyboard and touch
access and expose localized labels and tooltips. The trigger shows the active
mode icon and actual percentage, with an explicit accessible mode label; the menu
marks the selected mode. Published Floe dropdowns and the existing tooltip adapter
over Floe floating layers preserve Workbench projection, focus, and input routing.
Fixed minimum media heights must not push controls beyond a small preview surface.

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
remain reachable. Native media retains authorized Range requests; the
[Env App session event transport](../architecture/env-event-transport.md)
keeps persistent background event streams from delaying playback. Flower attachment
windows retain native browser PDF controls and image containment; their document
containers must shrink with the window.

## Rendering ownership

PDF uses the lazy published `@floegence/floe-webapp-core/pdf` entrypoint. The
upstream `PdfDocumentSurface` owns official PDF.js text, annotation, editor,
search, and link services; Redeven owns page metrics, viewport policy, controls,
and document lifetime. Its scoped CSS must not affect unrelated surfaces. Opening
another file type must not load the PDF engine. Each document uses a copy of
controller-owned bytes because worker loading may transfer the input buffer.

PDF page instances are stable by page number within a document. Upstream owns
serialized rendering, cancellation, bitmap replacement, and cleanup. Zoom keeps
the page and native annotation owner alive, including focused form values. Page
removal settles outstanding work before disposal; document replacement invalidates
pending results. Only nearby pages are mounted. Rasterization respects the
six-million-pixel and 16,384-pixel dimension bounds independently of CSS scale.
Pixel-density changes refresh the bitmap without changing the chosen CSS scale.
A real page failure exposes a localized message, retry, and technical details;
cancellation is not a visible error.

Native selection and copy work through the text layer, including under Workbench
projection. No forced-copy handler substitutes for browser selection. Selection
context belongs to the current preview. Find searches the document and scrolls
the matching page into the virtualized viewport. Search and annotation controls
float separately from zoom; the annotation history menu uses Floe's local floating
layer. Host catalogs supply labels for PDF controls and native annotation UI.

Worker, CMaps, standard fonts, WASM codecs, ICC profiles, and annotation images
come from the same pinned upstream PDF.js version and are emitted by the upstream
Vite asset plugin beneath the configured application base. They are served locally,
without a public CDN. PDF scripting and XFA are not enabled. The notices generator
verifies the exact engine resource licenses, including the Liberation font
exception, and preserves original notices beside distributed assets. Scanned
image-only PDFs need OCR to gain selectable text; this surface does not add OCR.

Each DOCX source owns distinct body and style nodes. A superseded render may finish
only against its detached nodes; it cannot overwrite the current body or install
styles back into the current surface. Layout observers belong to that source and
are disconnected on removal. Image load and error callbacks must match the
currently displayed resource.

## Markdown enhancements

Mermaid processing checks for diagram elements before resolving theme colors or
allocating a rendering sandbox. Initial rendering, content updates, and theme
changes share this decision. Ordinary Markdown still receives syntax highlighting
and theme updates without diagram-related canvas readback. When diagrams need
theme colors, their sampling canvas declares frequent reads at context creation.
Diagram rendering retains theme-specific caching and rejects stale document work.

# Boundaries

The [window actions contract](file-preview-window-actions.md) owns title-bar file
actions, drafts, and dismissal. The [Workbench input contract](workbench-input-ownership.md)
owns wheel and selection routing. Fit and renderer fixes must not grant an
unselected widget local wheel ownership or alter file authorization, editability,
or native attachment PDF behavior.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/createPreviewZoom.ts` - Shared product zoom policy over published Floe geometry.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewZoomControls.tsx` - Compact floating controls shared by the three sized preview renderers.
- `redeven:internal/envapp/ui_src/src/ui/widgets/PdfPreviewPane.tsx` - Product virtualization and controls over the published layered PDF surface.
- `redeven:internal/envapp/ui_src/src/ui/widgets/DocxPreviewPane.tsx` - Source-owned DOM and intrinsic section measurement.
- `redeven:internal/envapp/ui_src/src/ui/widgets/ImagePreviewPane.tsx` - Container-responsive image geometry and resource guards.
- `redeven:internal/envapp/ui_src/src/ui/widgets/PdfPreviewPane.test.tsx` - Page acquisition, replacement, virtualization, edit binding and retry regression tests.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewSizing.browser.test.tsx` - Real-renderer fit, projection, small-container and host integration checks.
- `redeven:internal/envapp/ui_src/src/ui/file-markdown/mermaidPlugin.ts` - Content-gated theme sampling and serialized, theme-specific diagram rendering.
- `redeven:internal/envapp/ui_src/src/ui/file-markdown/FileMarkdown.browser.test.tsx` - Ordinary Markdown avoids readback across content and theme changes; diagrams retain browser-resolved colors and theme updates.
- `redeven:internal/envapp/ui_src/src/ui/workbench/WorkbenchFilePreviewWidget.browser.test.tsx` - Native PDF selection/copy, persisted edits and 300-page virtualized search in projected Workbench.
- `redeven:scripts/generate_third_party_notices.mjs` - Verified PDF resource license texts and attribution.
