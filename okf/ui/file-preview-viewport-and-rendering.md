---
type: UI Contract
title: File preview rendering, formats and viewport
tags: [ui, files, preview, viewport, rendering]
lifecycle: contract
reviewed_at: "2026-11-06"
---
# Summary

Redeven owns source identity, authorization and preview modes; published renderers own layout and parsing. Each page has one asynchronous owner, stale work is fenced and failures remain local/retryable. HTML stays isolated, rich formats retain original bytes and unselected widgets gain no input authority.

# Contract

## Viewport and formats
### Viewport
[Floating layers](env-app-floating-layer-order.md) owns placement/clamps. Keep title/close/toolbar reachable with local scrolling. Fit uses local CSS pixels excluding padding/scrollbars, independent of Workbench transforms. Attachments keep native PDF controls/contained images/shrinkable containers.

Lazy Floe PDF owns layers/scoped CSS. One PDF/PPTX renderer/page; identity fences callbacks/stale work. Cancellation neutral, faults local/retryable.

### Text search and retained overlays
Markdown, text/code, PDF, DOCX, PPTX, HTML and spreadsheet/delimited previews expose the same localized Find action in More and scoped Ctrl/Cmd+F. Image/audio/video previews do not advertise text search. Rendered-text search uses Floe `createTextSearch`/`TextSearchBar`: literal case-insensitive matches across inline markup, match counts, previous/next, Enter/Shift+Enter and Escape. CSS highlights preserve rendered nodes and native selection; navigation scrolls only the owning preview. Hidden controls and line numbers are excluded. Window-header shortcuts route to the active document; Desktop resolves the editor entry from the same published Floe instance as its theme provider. Queries stay with retained documents; replacement resets them. Inactive/unselected previews have no search input authority. Escape closes search before its preview window, including mobile dialogs.

Find never reserves a dedicated row or a separate window-header icon: its entry belongs to the existing file/window/Workbench More menu; headerless previews keep a compact floating trigger. Rendered search uses a bounded absolute overlay inside its owning preview, including narrow screens; opening, navigating and closing it preserve the document viewport geometry. The menu, keyboard and content share one per-document search owner; closing search restores its originating control. Markdown controls temporarily hide beneath an open search overlay without changing layout. Monaco retains its native overlay. PDF and spreadsheets delegate to their published renderer search; PPTX searches all slides without mounting the whole deck and reveals the matched text bounds. HTML search stays inside its opaque sandbox through Floe’s private document channel. DOCX uses rendered text ranges. CSV/TSV table/source transitions rebind the same action; hosted spreadsheets use a compact floating panel.

Floe owns Monaco control-hover placement/intrinsic sizing and retained-panel paint suppression. Inactive panels retain geometry, scroll, editor model and drafts while suppressing explicitly visible descendants. Redeven consumes published Floe releases rather than patching Monaco or copying overlay mechanics.

### Office/delimited
Shared task/attachment adapters serve both hosts. Attachments retain native image/PDF/text; Env App file actions/Monaco/selected-Workbench wheel. Never pass legacy XLS/DOC/PPT to OOXML.

XLSX/CSV/TSV lazily consume exact unmodified @silurus/ooxml@0.89.7 XLSX with copied original bytes, no flattening. XlsxWorkbook.load, visible metadata/getWorksheet/XlsxSheetViewer.fromWorkbook/activation own rendering. Read sheet before activation to expose parse errors; select every visible sheet,skip hidden. Engine owns styles/merges/cached formulas/comments. Remove ExcelJS/200-row50-column caps everywhere.

One toolbar:sheet,optional value,zoom,info; hosted Find stays in More. Published SurfaceFloatingLayer/useOverlayMask isolates panels on narrow screens; Escape restores focus before parent dismissal. Search activates the first result via findNext, selects its cell via setSelection, and displays the renderer's matchIndex/total. Blue current fill/selection outline differs from pale amber matches; text stays readable. Enter/Shift+Enter navigate; in-flight actions serialize and query/worksheet/file changes fence stale results. CSV/TSV keeps table/source/encoding and literal zero/long-ID/formula-like cells. Editing/truncation forces source; encoding affects table only.

Limits20MiB input/100000rows/1000000cells/64MiB UTF8/128MiB JSON. Disable Google Fonts/hyperlinks; comments XLSX-only. Engine resize ignores host transforms. Replacement/unmount fences work,destroys viewer before workbook. Parse/render/search errors stay Retry; resolved Promise cannot erase failure. Distinguish unsupported legacy/supported failure.

DOCX keeps docx-preview with off-DOM identity-checked commit. Floe PPTX owns pages/navigation/incomplete-external warning. All rich previews20MiB/local Retry; originals unchanged. Original-author releases only,no fork/vendor/patch/model rewrite/fallback. XLSX indentation/views/malformed fidelity may differ from Office; DOCX/PPTX migration needs upstream fixes/Word math-layout evidence. Lazy assets include licenses; production admits only hashed graph-router/XLSX WASM matching installed package bytes. Unknown/altered assets reject. Build size≠installer size.

### HTML/Markdown
[HTML](#html) owns page-first/edit/bounds/isolation/incomplete rejection. [Diagrams](markdown-diagrams.md) use Floe/Pele with theme and identity-fenced cleanup. Contents defaults closed in right-drawer Dialog,retaining width/nodes/scroll; heading scroll closes it. File change resets,headingless disables; main sidebar remains.

Floe roles: headings/links interaction-info; lower headings/quotes tip; emphasis note; code ink. Dark headings keep hue/lightness floor; tables/metadata subtle, GFM alerts semantic. Text/inset titles>=4.5:1 across presets/materials/windows. Preserve underline/focus/selection/forced colors; theme never changes geometry/DOM/selection/focus/scroll.

## HTML
### Page rendering
Files ending in `.html`, `.htm`, or `.xhtml`, regardless of case, open as rendered pages in floating windows, mobile previews, Workbench, and attachment snapshot previews.

It renders an opaque `allow-scripts`, no-referrer iframe; it never inserts file HTML into the trusted shell or navigates to an authenticated file endpoint.

The current Activity file preview and Workbench same-file reuse rules still own placement.

### Placement and interaction
The page fills the reading area and scrolls internally. An unselected Workbench iframe is inert and cannot intercept pointer, keyboard, or wheel input. Unrelated shell updates preserve the live document. Floe owns revision-fenced HTML presentation: private document-load completion plus rendering opportunities, not arbitrary application idle. Reading and rendering retain one stable localized pending surface; short feedback is delayed without delaying content. Loaded tab switches never reenter loading. Source replacement fences earlier messages, pending callbacks and link errors. Inactive HTML pauses native media and never autoplays on return; scripts/canvases are not forcibly suspended. Keep the opaque sandbox/CSP and file-size limits. Attachments render snapshot HTML/HTM/XHTML with the same 2 MiB bound and no editor permission.

### Source editing and snapshots
Edit opens the existing HTML source editor only when write permission permits. Attachment snapshots remain read-only and show the attached bytes rather than re-reading the live file.

## PPTX
PPTX uses the lazy published `@floegence/floe-webapp-core/pptx` entrypoint. Opening another file type must not load the PPTX engine.

Preview opens directly to the slides without a generic PowerPoint compatibility notice or an empty notice bar. Document-specific guidance appears only when external resources are disabled or some content cannot be rendered.

The renderer's original licenses, ECMA geometry notice, bundled dependency notices, and MPL corresponding source are verified and retained in the distributed third-party notice.

# Boundaries

[Window actions](file-preview-window-actions.md#window-actions) owns drafts/actions/dismissal. Preserve unselected-widget wheel ownership,permission/editability/native attachment PDF.

[Window actions](file-preview-window-actions.md#window-actions) owns shared file actions and draft dismissal. Synthetic clicks, forged messages, sibling iframes, and retired documents cannot invoke its host handler. User-activated file navigation does not authorize automatic loading of neighboring assets or add a separate editor lifecycle.

The [preview viewport contract](#viewport-and-formats) owns shared fit, controls, and local coordinate policy. This surface must not grant unselected widgets local wheel authority or change file permissions or editability.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/file-markdown/FileMarkdown.themes.browser.test.tsx` - Tests.
- `redeven:internal/envapp/ui_src/src/ui/widgets/createPreviewZoom.ts` - Source.
- `redeven:internal/envapp/ui_src/src/ui/widgets/OfficePreview.browser.test.tsx` - Tests.
- `redeven:internal/envapp/ui_src/src/ui/widgets/DelimitedTextPreview.test.tsx`, `SpreadsheetPreview.test.tsx`
- `redeven:desktop/scripts/check-office-preview.mjs` (desktop pnpm test:office-preview): production-built Electron file://,offline assets/task-attachment/Escape/DOCX/PPTX/multisheet/native PDF/cleanup; no installer/Office-equivalence claim.
- Workbook SHA256 bed4a8aa26d0ddf254f41da4b792da957122759b382bca85eda8470c5581c22f reproduces ExcelJS4.4.0 comment crash; unchanged four-visible-sheet bytes render in Env/production Electron via official OOXML. Optional REDEVEN_ACCEPTANCE_XLSX keeps user data outside Git. Generated fixture: absolute nested comments relation,hidden sheet,styles/merges/literal IDs/cached formulas/BA301 beyond old cap.
- `redeven:internal/envapp/ui_src/scripts/initialBuildGraphPolicy.node-test.mjs` - Tests.

- `redeven:internal/envapp/ui_src/src/ui/widgets/HtmlPreviewPane.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/widgets/HtmlPreviewPane.browser.test.tsx` - Tests.

- `redeven:internal/envapp/ui_src/src/ui/widgets/PptxPreviewPane.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/widgets/PptxPreviewPane.test.tsx` - Tests.

- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewWorkspace.browser.test.tsx` - More-only search across text, Markdown, HTML, PDF, DOCX, PPTX and spreadsheet formats; retained queries and mobile dismissal.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewSearch.browser.test.tsx`, `WorkbenchFilePreviewWidget.browser.test.tsx` - Headerless/narrow-screen and selected-widget search; unchanged content geometry.
- `redeven:desktop/scripts/check-file-preview-continuity.mjs` - Production Electron header actions, compact overlays, unchanged viewports, hover hit testing and HTML continuity.
