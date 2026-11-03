---
type: UI Contract
title: File preview viewport and rendering
tags: [ui, files, preview, viewport, rendering]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Redeven owns preview identity/modes; Floe sizing, PDF layers and static PPTX. Initial fit may enlarge, resize keeps manual zoom. One owner renders each page, fencing stale work. Errors stay local/retryable, cancellation neutral, and incomplete HTML never executes.

# Contract

## Viewport
[Floating layers](env-app-floating-layer-order.md) owns placement/clamps. Keep title/close/toolbar reachable with local scrolling. Fit uses local CSS pixels excluding padding/scrollbars, independent of Workbench transforms. Attachments keep native PDF controls/contained images/shrinkable containers.

Lazy Floe PDF owns layers/scoped CSS. One PDF/PPTX renderer/page; identity fences callbacks/stale work. Cancellation neutral, faults local/retryable.

## Office/delimited
Shared task/attachment adapters serve both hosts. Attachments retain native image/PDF/text; Env App file actions/Monaco/selected-Workbench wheel. Never pass legacy XLS/DOC/PPT to OOXML.

XLSX/CSV/TSV lazily consume exact unmodified @silurus/ooxml@0.89.7 XLSX with copied original bytes, no flattening. XlsxWorkbook.load, visible metadata/getWorksheet/XlsxSheetViewer.fromWorkbook/activation own rendering. Read sheet before activation to expose parse errors; select every visible sheet,skip hidden. Engine owns styles/merges/cached formulas/comments. Remove ExcelJS/200-row50-column caps everywhere.

One toolbar:sheet,optional value,search,zoom,info. Explicit/Ctrl-Cmd+F search returns focus on close. Published SurfaceFloatingLayer/useOverlayMask isolates cell/fidelity panels on narrow screens; Escape closes before parent. CSV/TSV keeps table/source/encoding and literal zero/long-ID/formula-like cells. Editing/truncation forces source; encoding affects table only.

Limits20MiB input/100000rows/1000000cells/64MiB UTF8/128MiB JSON. Disable Google Fonts/hyperlinks; comments XLSX-only. Engine resize ignores host transforms. Replacement/unmount fences work,destroys viewer before workbook. Parse/render/search errors stay Retry; resolved Promise cannot erase failure. Distinguish unsupported legacy/supported failure.

DOCX keeps docx-preview with off-DOM identity-checked commit. Floe PPTX owns pages/navigation/incomplete-external warning. All rich previews20MiB/local Retry; originals unchanged. Original-author releases only,no fork/vendor/patch/model rewrite/fallback. XLSX indentation/views/malformed fidelity may differ from Office; DOCX/PPTX migration needs upstream fixes/Word math-layout evidence. Lazy assets include licenses; production admits only hashed graph-router/XLSX WASM matching installed package bytes. Unknown/altered assets reject. Build size≠installer size.

## HTML/Markdown
[HTML](file-preview-html.md) owns page-first/edit/bounds/isolation/incomplete rejection. [Diagrams](markdown-diagrams.md) use Floe/Pele with theme and identity-fenced cleanup. Contents defaults closed in right-drawer Dialog,retaining width/nodes/scroll; heading scroll closes it. File change resets,headingless disables; main sidebar remains.

Floe roles: headings/links interaction-info; lower headings/quotes tip; emphasis note; code ink. Dark headings keep hue/lightness floor; tables/metadata subtle, GFM alerts semantic. Text/inset titles>=4.5:1 across presets/materials/windows. Preserve underline/focus/selection/forced colors; theme never changes geometry/DOM/selection/focus/scroll.

# Boundaries

[Window actions](file-preview-window-actions.md) owns drafts/actions/dismissal. Preserve unselected-widget wheel ownership,permission/editability/native attachment PDF.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/file-markdown/FileMarkdown.themes.browser.test.tsx` - Tests.
- `redeven:internal/envapp/ui_src/src/ui/widgets/createPreviewZoom.ts` - Source.
- `redeven:internal/envapp/ui_src/src/ui/widgets/OfficePreview.browser.test.tsx` - Tests.
- `redeven:internal/envapp/ui_src/src/ui/widgets/DelimitedTextPreview.test.tsx`, `SpreadsheetPreview.test.tsx`
- `redeven:desktop/scripts/check-office-preview.mjs` (desktop pnpm test:office-preview): production-built Electron file://,offline assets/task-attachment/Escape/DOCX/PPTX/multisheet/native PDF/cleanup; no installer/Office-equivalence claim.
- Workbook SHA256 bed4a8aa26d0ddf254f41da4b792da957122759b382bca85eda8470c5581c22f reproduces ExcelJS4.4.0 comment crash; unchanged four-visible-sheet bytes render in Env/production Electron via official OOXML. Optional REDEVEN_ACCEPTANCE_XLSX keeps user data outside Git. Generated fixture: absolute nested comments relation,hidden sheet,styles/merges/literal IDs/cached formulas/BA301 beyond old cap.
- `redeven:internal/envapp/ui_src/scripts/initialBuildGraphPolicy.node-test.mjs` - Tests.
