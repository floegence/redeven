---
type: UI Contract
title: File preview rendering, formats and viewport
tags: [ui, files, preview, viewport, rendering]
lifecycle: contract
reviewed_at: "2026-11-06"
---
# Summary

Redeven owns source/authority/modes; released renderers own parsing/layout. Existing More or compact headerless trigger opens a bounded absolute overlay without viewport movement. Menu/keyboard/content share owner and restore origin focus; no dedicated row/header icon.

# Contract

## Viewport and formats
### Viewport
[Floating layers](env-app-floating-layer-order.md) owns clamps. Keep title/close/toolbar reachable with local scroll. Fit uses local CSS pixels minus padding/scrollbar, not Workbench transform. Attachments keep nativePDF/contained images/shrinkable wrappers. Lazy Floe PDF owns layers/CSS; one PDF/PPTX renderer/page fences identity/cancel, local errors/Retry.

### Text search and retained overlays
Text/code/Markdown/PDF/DOCX/PPTX/HTML/spreadsheet/delimited previews share localized More/Mod+F Find; media-only has none. Published createTextSearch/TextSearchBar owns literal case-insensitive rendered matches, counts, previous/next, Enter/Shift+Enter/Escape. CSS highlights preserve nodes/selection and scroll only owner, excluding hidden controls/line numbers. Header targets active document; Desktop shares Floe theme instance. Queries reset on replacement, inactive/unselected views have no authority. Escape closes Find before window, including mobile.

Markdown controls hide without reflow; Monaco uses native overlay. PDF/spreadsheet use renderer search; PPTX searches all slides without mounting them and reveals result bounds; HTML uses private sandbox channel, DOCX ranges. CSV mode changes rebind same action; sheet panel floats. Floe owns Monaco hover and inactive paint suppression with retained model/draft/geometry/scroll; no host patch.

### Office/delimited
Adapters preserve attachment image/PDF/text and Env edit/selected Workbench wheel authority. Legacy XLS/DOC/PPT never enter OOXML. Exact official @silurus/ooxml@0.89.7 lazily renders copied XLSX/CSV/TSV bytes via XlsxWorkbook.load/metadata/getWorksheet/XlsxSheetViewer.fromWorkbook/activation. Read before activate for errors, enumerate all visible sheets only. Engine owns styles/merges/cached formulas/comments; no ExcelJS or200row/50column cap.

One toolbar owns sheet/optional value/zoom/info; Find stays More. Published floating layer/mask owns narrow isolation and Escape focus before parent. findNext activates first result, setSelection selects, matchIndex/total reflect engine. Current blue outline/fill differs from readable amber matches. Serialize search, fence query/sheet/file. CSV keeps table/source/encoding and literal zero/longID/formula-like cells; edit/truncation requires source, encoding affects table only.

Bounds20MiB/100000rows/1000000cells/64MiBUTF8/128MiBJSON. No GoogleFonts/hyperlinks, XLSX-only comments. Resize ignores transforms. Fence replacement/unmount and destroy viewer before workbook; resolved promises cannot erase error. Distinguish unsupported legacy from render failure.

DOCX commits off-DOM after identity check; published PPTX owns navigation/external-content warnings. Rich previews keep20MiB/localRetry/original bytes. Use original-author releases, no fork/vendor/patch/model rewrite/fallback. Office fidelity may differ; migration requires upstream repair/Word math proof. Verify licenses and graph-router/XLSX WASM hashes against installed bytes; unknown/altered fails. Build size is not installer size.

### HTML/Markdown
[HTML](#html) owns isolation; [diagrams](markdown-diagrams.md) owns Floe/Pele theme/lifetime. Contents starts closed in retained right drawer, heading jump closes/file change resets/no headings disables; main sidebar stays. Semantic colors ensure text/inset-title>=4.5contrast, dark hue floor, selection/focus/forced colors. Theme changes no DOM/geometry/scroll/focus.

## HTML
### Page rendering
Case-insensitive HTML/HTM/XHTML renders in floating/mobile/Workbench/attachments using opaque allow-scripts/no-referrer frame, never shell DOM/authenticated navigation. Existing Activity/same-file reuse owns placement.

### Placement and interaction
Fill reading area with internal scroll; unselected frame is inert to pointer/keyboard/wheel. Unrelated updates retain document. Revision-fenced load/render opportunities prove presentation, not idle. Shared localized pending presentation delays feedback only, never content. Loaded tab switches do not reload; replacement fences callbacks/messages/link failures. Inactive media pauses, no autoplay on return or forced script/canvas suspension. Preserve CSP/size; attachment snapshots keep2MiB and no editor authority.

### Source editing and snapshots
Existing source editor requires write. Attachments stay on attached bytes/read-only, never live reread.

## PPTX
Lazy published Floe/pptx loads only for slides. Open directly; warn only actual incomplete/disabled resources. Verify/distribute original licenses, ECMA geometry/dependency notices and MPL source.

# Boundaries

[Window actions](file-preview-window-actions.md#window-actions) owns drafts/actions/dismissal. Forged/sibling/synthetic/retired messages grant no host actions; navigation grants no adjacent assets/editor lifecycle. Preserve wheel/edit/attachment permissions.

# Evidence

Electron check-office-preview.mjs covers offline assets/attachments/Escape/formats/multisheet/nativePDF/cleanup, not Office/installer parity. Private workbook bed4a8aa26d0ddf254f41da4b792da957122759b382bca85eda8470c5581c22f reproduces ExcelJS4.4.0 comment crash but renders unchanged four visible sheets with OOXML. Private acceptance bytes stay outside Git. Generated fixture covers nested absolute comments/hidden sheet/styles/merges/literalIDs/cache/BA301. Browser suites cover More/search/narrow/headerless/selection/geometry; built continuity covers native header/overlays/hover/HTML.
