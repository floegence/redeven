---
type: UI Contract
title: File preview viewport and rendering
tags: [ui, files, preview, viewport, rendering]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Redeven owns preview modes/identity; Floe owns sizing, PDF layers and static PPTX. Initial automatic fit may enlarge; resize preserves manual zoom. One owner renders each page and stale work cannot replace current content. Errors stay local, cancellation neutral, and incomplete HTML never executes.

# Contract

## Window boundary
[Floating layers](env-app-floating-layer-order.md) own placement/clamps. Title/close/toolbar remain reachable; documents scroll locally.

## Reading area and zoom
Fit uses local CSS pixels excluding padding/scrollbars, independent of Workbench transforms. Initial fit may enlarge; resize preserves manual zoom. Attachments keep native PDF controls/contained images/shrinkable containers.

## Rendering ownership
Lazy published Floe PDF owns layers/scoped CSS. Each PDF/PPTX page has one renderer. Identity fences image callbacks/stale work; cancellation is neutral and errors local/retryable.

## Office and delimited files
Shared task-file/attachment adapters serve Desktop/Env App. Attachments retain native image/PDF/text; Env App retains file actions/Monaco/selected-Workbench wheel ownership. Never feed unsupported XLS/DOC/PPT to OOXML.

XLSX/CSV/TSV lazily use unmodified exact published @silurus/ooxml@0.89.7 XLSX. Send original copied bytes without flattening. Public XlsxWorkbook.load, visible-sheet metadata, getWorksheet, XlsxSheetViewer.fromWorkbook and explicit activation own rendering; worksheet reads surface parse errors before activation. Select every visible worksheet, skip hidden ones. Engine owns styles/merges/cached formulas/comments. Remove ExcelJS and its 200-row/50-column cap everywhere.

One toolbar row: sheet, optional cell value, search, zoom, information. Search opens explicitly/Ctrl-Cmd+F and returns focus on close. Cell/fidelity panels use published SurfaceFloatingLayer/useOverlayMask for narrow placement/input isolation; Escape closes them before parent windows. CSV/TSV retain table/source/encoding and literal cells (zeros, long IDs, formula-like text); editing/truncation forces source. Encoding changes only table, not source-editor decoding.

Limits: input 20 MiB, 100,000 rows, 1,000,000 cells, 64 MiB owned UTF-8, 128 MiB JSON. Disable Google Fonts/hyperlinks; comments only XLSX. Engine observer owns canvas resize, ignoring host transforms. Replace/unmount fences work and destroys viewer before workbook. Parse/render/search errors stay retryable; promise success cannot erase errors. Distinguish unsupported legacy from failed supported previews.

DOCX keeps docx-preview and off-DOM identity-checked commit; PPTX keeps published Floe document/page ownership, navigation and incomplete/external-content notice. Rich previews share 20 MiB/local retry. Never rewrite originals.

Only original-author releases: no forks, vendoring, patches, model rewrites or silent fallback. XLSX indentation/views/malformed fidelity may differ from Office. DOCX/PPTX migration awaits upstream fixes and Word-equivalent math/layout evidence. Lazy renderer/worker/WASM assets include licenses/notices. Build size is not installer size.

## HTML pages
[HTML preview](file-preview-html.md) owns page-first opening, explicit editing, bounds/isolation and rejection of incomplete HTML.

## Markdown enhancements
Mermaid skips diagramless work, caches themes and fences stale results. Contents starts closed in published right-drawer Dialog, preserving width/nodes/scroll; headings scroll then close it. File changes reset it; headingless files disable it. Main preview keeps its sidebar.

Floe semantic roles: headings/links interaction/info, lower headings/quotes tip, emphasis note, dedicated code ink; dark headings retain hue/lightness floor, tables/metadata subtle tints, GFM alerts semantic roles. Text/inset titles require 4.5:1 across presets/materials/floating windows. Keep underline/focus/readable selection/system forced colors. Theme changes preserve geometry/DOM/selection/focus/scroll.

# Boundaries

The [window actions contract](file-preview-window-actions.md) owns actions, drafts, and dismissal. Rendering preserves unselected-widget wheel ownership, authorization, editability, and native attachment PDF behavior.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/file-markdown/FileMarkdown.themes.browser.test.tsx` - All-theme roles/contrast, floating continuity and forced colors.

- `redeven:internal/envapp/ui_src/src/ui/widgets/createPreviewZoom.ts` - Zoom policy.

- `redeven:internal/envapp/ui_src/src/ui/widgets/OfficePreview.browser.test.tsx` - Published parsing, identity, encoding, zoom/search, responsive controls and Workbench wheel.
- `redeven:internal/envapp/ui_src/src/ui/widgets/DelimitedTextPreview.test.tsx` and `SpreadsheetPreview.test.tsx` - Exact bytes, stale loads, retry/edit lifecycle, XLSX limits and corruption.
- `redeven:desktop/scripts/check-office-preview.mjs` (`pnpm test:office-preview` in `desktop/`) - Production-built shared components under Electron `file://`, offline worker/assets, task/attachment routes, Escape, DOCX/PPTX, styled multi-sheet XLSX, native PDF and supervised cleanup. It does not certify a packaged installer or Microsoft Office visual equivalence.
- The reported four-visible-sheet workbook (SHA-256 `bed4a8aa26d0ddf254f41da4b792da957122759b382bca85eda8470c5581c22f`) reproduced the ExcelJS 4.4.0 comments reconciliation crash. Its unchanged bytes render through the official OOXML engine in Env and production-built Electron acceptance. `REDEVEN_ACCEPTANCE_XLSX` supplies this optional local input without committing user data. The generated fixture covers an absolute nested comments relationship, a hidden sheet, styles, merged cells, literal identifiers, cached formulas and BA301 content beyond the removed cap.
