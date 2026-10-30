---
type: UI Contract
title: File preview viewport and rendering
tags: [ui, files, preview, viewport, rendering]
lifecycle: contract
reviewed_at: "2026-10-30"
---
# Summary

Redeven owns preview modes, identity, and renderer lifetimes; published Floe owns sizing, PDF layers, and static PPTX. Documents/images initially fit, including enlargement. Resize updates automatic fit, preserving manual zoom. PDF/PPTX pages have one rendering owner. Stale work cannot replace current content; cancellation is neutral and failures stay local/retryable. HTML uses published isolation; source editing is explicit and incomplete HTML never executes.

# Contract

## Window boundary
[Floating layers](env-app-floating-layer-order.md) own placement/clamps; title, close and toolbar remain reachable while documents scroll locally.

## Reading area and zoom
Fit uses local CSS pixels excluding padding/scrollbars, unaffected by ancestor/Workbench transforms. Initial fit may enlarge; resize recomputes automatic fit while preserving manual zoom. Attachments retain native PDF controls/contained images and shrinkable containers.

## Rendering ownership
Lazy published `@floegence/floe-webapp-core/pdf` owns PDF layers with scoped CSS. Each PDF/PPTX page has one renderer; stale work cannot replace current resources. Image callbacks match displayed identity. Cancellation is neutral; failures are local/retryable.

## Office and delimited files
Flower task files and attachments share product adapters across Desktop and Env App. Attachments retain native image/PDF/text paths. Env App retains established file actions, Monaco editing, and selected-Workbench wheel ownership. Legacy XLS/DOC/PPT are unsupported, never fed to OOXML parsers.

XLSX, CSV and TSV use one shared product adapter over the unmodified, exact published `@silurus/ooxml@0.89.7` XLSX entry, loaded on demand. Original copied bytes go to the engine; Redeven never flattens or rewrites workbooks. XLSX uses public `XlsxWorkbook.load`, visible-sheet metadata, `getWorksheet` and `XlsxSheetViewer.fromWorkbook`, followed by explicit activation. All visible worksheets are selectable; hidden worksheets are skipped. Public worksheet reads surface parsing errors before viewer activation. Styles, merged cells, cached formula results and comments belong to the engine. The former ExcelJS reader and its 200-row/50-column cap are removed from all preview entries and dependency graphs.

The XLSX toolbar occupies one compact row: worksheet, optional selected-cell value, search, zoom and information. Search opens on demand, including Ctrl/Cmd+F; closing it returns keyboard focus when focus was inside. Cell details and the fidelity explanation open in anchored panels instead of permanently consuming document height. Published Floe `SurfaceFloatingLayer` and `useOverlayMask` own panel placement and keyboard isolation: Escape closes the panel before the task dialog or attachment window. Panels fit narrow windows. CSV/TSV keep table/source and explicit encoding; cells remain literal strings, including leading zeros, long identifiers and formula-like text. Editing or truncated delimited input forces the existing source surface. Encoding changes only the table; source editing retains established decoding.

Input is limited to 20 MiB; parser limits are 100,000 rows, 1,000,000 cells, 64 MiB owned UTF-8 and 128 MiB JSON. Google Fonts and hyperlinks are disabled; comments are enabled only for XLSX. The responsive caller canvas delegates resize to the engine observer; host transforms must not become layout dimensions. Replacement/unmount fences stale work and destroys the viewer before its workbook. Parse/render/search failures remain visible and retryable; successful promise resolution cannot erase an engine error. Unsupported legacy formats remain distinct from failed supported previews.

DOCX retains `docx-preview`; static PPTX retains published Floe, with page navigation and an incomplete/external-content notice. Rich shared previews enforce 20 MiB input and local retryable failure. DOCX renders off-DOM before identity-checked commit; PPTX owns/disposes its document and current page. Original files are never rewritten.

Only original-author published packages are permitted. XLSX uses the official release with its known fidelity limits: workbook indentation/saved views and some partially malformed content are not guaranteed to match Office. DOCX/PPTX migration remains deferred pending upstream fixes and Word-equivalent math/layout evidence. No fork, vendored implementation, dependency patch, model rewrite or silent renderer fallback is permitted. Heavy renderer/worker/WASM assets remain lazy, and distribution includes upstream license and third-party notices. Build asset size is not an installer-size measurement.

## HTML pages
[HTML preview](file-preview-html.md) owns page-first opening, explicit source editing, bounds/isolation and refusal to execute incomplete HTML.

## Markdown enhancements
Mermaid skips theme/sandbox work without diagrams, caches themes and fences stale results. Floating Contents starts closed in the published right-drawer Dialog, preserving width/nodes/scroll. Dismissal affects only Contents; heading activation scrolls Markdown then closes. File changes reset it; headingless files disable it. Main previews retain their sidebar.

Floe roles color headings/links as interaction/info, lower headings/quotes as tip, emphasis as note and code with its dedicated foreground. Raised dark headings retain hue with a lightness floor; tables/metadata use subtle tints and GFM alerts keep semantic roles. Text/inset titles require 4.5:1 contrast across presets/materials, including floating windows. Links retain underline/focus; selection is readable and forced colors use system roles. Theme changes preserve geometry, DOM, selection, focus and scroll.

# Boundaries

The [window actions contract](file-preview-window-actions.md) owns actions, drafts, and dismissal. Rendering preserves unselected-widget wheel ownership, authorization, editability, and native attachment PDF behavior.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/file-markdown/FileMarkdown.themes.browser.test.tsx` - All-theme contrast, distinct roles, floating windows, continuity, and forced colors.

- `redeven:internal/envapp/ui_src/src/ui/widgets/createPreviewZoom.ts` - Zoom policy.

- `redeven:internal/envapp/ui_src/src/ui/widgets/OfficePreview.browser.test.tsx` - Real published-engine parsing, literal identity, encoding, resize, source, search/zoom, entry routes, compact toolbar/keyboard/narrow panels and Workbench wheel ownership.
- `redeven:internal/envapp/ui_src/src/ui/widgets/DelimitedTextPreview.test.tsx` and `SpreadsheetPreview.test.tsx` - Exact bytes, stale loads, retry/edit lifecycle, XLSX limits and corruption.
- `redeven:desktop/scripts/check-office-preview.mjs` (`pnpm test:office-preview` in `desktop/`) - Production-built shared components under Electron `file://`, offline worker/assets, task/attachment routes, Escape, DOCX/PPTX, styled multi-sheet XLSX, native PDF and supervised cleanup. It does not certify a packaged installer or Microsoft Office visual equivalence.
- The reported four-visible-sheet workbook (SHA-256 `bed4a8aa26d0ddf254f41da4b792da957122759b382bca85eda8470c5581c22f`) reproduced the ExcelJS 4.4.0 comments reconciliation crash. Its unchanged bytes render through the official OOXML engine in Env and production-built Electron acceptance. `REDEVEN_ACCEPTANCE_XLSX` supplies this optional local input without committing user data. The generated fixture covers an absolute nested comments relationship, a hidden sheet, styles, merged cells, literal identifiers, cached formulas and BA301 content beyond the removed cap.
