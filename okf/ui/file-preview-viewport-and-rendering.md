---
type: UI Contract
title: File preview rendering, formats and viewport
tags: [ui, files, preview, viewport, rendering]
lifecycle: contract
reviewed_at: "2026-11-06"
---
# Summary

Redeven owns source identity, authorization and modes; released renderers own parsing/layout. No dedicated row/header icon: existing More or compact headerless floating trigger. Bounded absolute overlay preserves viewport on open/navigation/close; menu/keyboard/content share owner and restore origin focus.

# Contract

## Viewport and formats
### Viewport
[Floating layers](env-app-floating-layer-order.md) owns placement/clamps. Keep title/close/toolbar reachable with local scroll. Fit uses local CSS pixels minus padding/scrollbar, independent of Workbench transforms. Attachments retain native PDF/contained images/shrinkable containers. Lazy Floe PDF owns layers/scoped CSS; one PDF/PPTX renderer/page fences identity, cancellation is neutral, faults local/Retry.

### Text search and retained overlays
Text/code, Markdown, PDF/DOCX/PPTX/HTML and spreadsheets/delimited previews share localized More/Mod+F Find; media-only previews advertise none. Floe createTextSearch/TextSearchBar owns literal case-insensitive rendered-text matching across markup, counts, previous/next, Enter/Shift+Enter/Escape. CSS highlights retain nodes/selection and scroll only owner, excluding hidden controls/line numbers. Header shortcuts target active document; Desktop uses same published Floe instance as themes. Retained queries reset on replacement; inactive/unselected previews have no authority. Escape closes Find before window, also on mobile.

Markdown controls hide without layout changes; Monaco uses native overlay. PDF/spreadsheets use released search; PPTX searches all slides without mounting them and reveals matching bounds. HTML searches over private sandbox channel; DOCX uses rendered ranges. CSV/TSV mode changes rebind same action; hosted spreadsheet panel floats. Floe owns Monaco hover sizing/placement and inactive paint suppression while retaining geometry/model/draft/scroll; no product copy/patch.

### Office/delimited
Shared host/task adapters preserve native attachment image/PDF/text and existing Env App edit/selected-Workbench wheel authority. Legacy XLS/DOC/PPT never enter OOXML. XLSX/CSV/TSV lazily use exact unmodified @silurus/ooxml@0.89.7 with copied original bytes. XlsxWorkbook.load/metadata/getWorksheet/XlsxSheetViewer.fromWorkbook/activation own rendering: read before activation to expose errors, enumerate all visible sheets, skip hidden. Engine owns styles/merges/cached formulas/comments; no ExcelJS or 200-row/50-column caps.

One toolbar owns sheet/optional value/zoom/info; Find stays in More. Published SurfaceFloatingLayer/useOverlayMask handles narrow isolation; Escape restores focus before parent close. findNext activates first result; setSelection selects it; matchIndex/total report renderer state. Current blue outline/fill differs from pale amber matches with readable text. Serialize in-flight search and fence query/sheet/file changes. CSV/TSV retains table/source/encoding and literal zero/long-ID/formula-like cells; edits/truncation require source, encoding affects table only.

Bounds:20MiB input,100000rows,1000000cells,64MiB UTF8,128MiB JSON. Disable Google Fonts/hyperlinks; XLSX-only comments. Resize ignores host transforms. Replacement/unmount fences work, destroys viewer before workbook. Resolved promises cannot erase errors; distinguish unsupported legacy from supported failure.

DOCX uses off-DOM identity-checked docx-preview commit; Floe PPTX owns navigation/pages/external-content warnings. All rich previews keep 20MiB/local Retry/original bytes. Consume original-author releases only, no fork/vendor/patch/model rewrite/fallback. XLSX views/indentation/malformed fidelity may differ from Office; migrations require upstream fixes/Word math-layout proof. Verify licenses and hashed graph-router/XLSX WASM against installed bytes; reject unknown/altered assets. Build size does not establish installer size.

### HTML/Markdown
[HTML](#html) owns rendering/isolation. [Diagrams](markdown-diagrams.md) owns Floe/Pele theme/identity cleanup. Contents defaults closed in retained right drawer; heading jump closes, file change resets, headingless disables; main sidebar stays. Semantic Floe colors retain text/inset-title contrast>=4.5:1, hue floor in dark headings, selection/underline/focus/forced colors. Theme changes cannot alter geometry/DOM/scroll/focus.

## HTML
### Page rendering
Case-insensitive HTML/HTM/XHTML opens rendered across floating/mobile/Workbench/attachments, using opaque allow-scripts/no-referrer iframe, never trusted shell DOM/authenticated file navigation. Existing Activity/same-file reuse owns placement.

### Placement and interaction
Page fills reading area with internal scroll; unselected iframe is inert to pointer/keyboard/wheel. Unrelated updates retain document. Floe revision-fenced load/render opportunities establish presentation, not arbitrary idle. Reading/rendering share stable localized pending surface; delay short feedback, never content. Loaded tab switches do not reload. Replacement fences callbacks/messages/link failures. Inactivity pauses native media without autoplay on return; no forced script/canvas suspension. Preserve CSP and size bounds; attachment snapshots use same2MiB limit without editor authority.

### Source editing and snapshots
Edit uses existing source editor with write permission. Attachments stay read-only on attached bytes, never reread live file.

## PPTX
Lazy published Floe/pptx must not load for other types. Open slides directly; only actual incomplete rendering/disabled resources warrant notices. Retain/verify original licenses, ECMA geometry/dependency notices and MPL source in distribution.

# Boundaries

[Window actions](file-preview-window-actions.md#window-actions) owns drafts/actions/dismissal. Synthetic/forged/sibling/retired messages cannot invoke host actions. Explicit file navigation grants no adjacent assets or new editor lifecycle. Preserve selected-widget wheel and file edit/attachment permissions.

# Evidence

Production Electron `check-office-preview.mjs` covers offline assets, attachments, Escape, formats/multisheet/native PDF/cleanup, not installer/Office parity. Workbook SHA256 bed4a8aa26d0ddf254f41da4b792da957122759b382bca85eda8470c5581c22f reproduced ExcelJS4.4.0 comments crash; unchanged four-visible-sheet bytes render via official OOXML. Private REDEVEN_ACCEPTANCE_XLSX stays outside Git. Generated fixture includes absolute nested comments, hidden sheet/styles/merges/literal IDs/cached formulas/BA301. Preview browser suites cover actual More/search retention, narrow/headerless/Workbench selection and geometry; built continuity runner covers native header/overlays/hover/HTML.
