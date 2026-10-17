---
type: UI Contract
title: Static PPTX file preview
description: Read bounded presentations through the released Floe renderer without host tools or document uploads.
tags: [ui, files, preview, pptx]
timestamp: 2026-10-17T00:00:00Z
---
# Summary

Published Floe owns static PPTX parsing and rendering; Redeven owns the reading
surface and authorized file bytes. Supported presentations open locally with
windowed slides, selectable text, and stable zoom. External resources stay disabled;
obsolete documents cannot replace the active source. Rendering failures expose
local recovery or incomplete-content guidance. Original licenses and corresponding
MPL source remain available with redistribution.

# Contract

PPTX uses the lazy published `@floegence/floe-webapp-core/pptx` entrypoint. Floe
owns parsing, static shape/text/chart rendering, external-relationship removal,
embedded SVG sanitization, and page resource cleanup. Redeven owns page windowing,
fit, zoom, labels, localized notices, and document lifetime. Opening another file
type must not load the PPTX engine. No host executable, document upload, or Office
installation is required. Only `.pptx` is supported; legacy `.ppt` remains outside
this contract. Inputs are limited to 20 MiB before reading and parsing.

Nearby slides mount at intrinsic dimensions and scale through their local outer
frame, retaining chart and text owners across zoom. Removed pages release their
handles; superseded opens are aborted and completed stale surfaces disposed.
Node failures remain visible as an incomplete-preview warning. Page failures
expose retry and technical details. Static-preview guidance discloses animation
and effect limitations; external relationships are disabled. Local font availability
can change layout. The renderer's original licenses, ECMA geometry notice,
bundled dependency notices, and MPL corresponding source are verified and retained
in the distributed third-party notice.

# Boundaries

The [preview viewport contract](file-preview-viewport-and-rendering.md) owns shared
fit, controls, and local coordinate policy. The [Workbench input contract](workbench-input-ownership.md)
owns selection and wheel routing. This surface must not grant unselected widgets
local wheel authority or change file permissions or editability.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/PptxPreviewPane.tsx` - Local page windowing, zoom, notices, and source lifetime.
- `redeven:internal/envapp/ui_src/src/ui/widgets/PptxPreviewPane.test.tsx` - Stale opens, disposal, windowing, and node failure disclosure.
- `redeven:internal/envapp/ui_src/src/ui/widgets/PptxPreviewPane.browser.test.tsx` - Real renderer fit, projection, selection, stable text owners, and recovery.
- `redeven:internal/envapp/ui_src/src/ui/workbench/WorkbenchFilePreviewWidget.browser.test.tsx` - Native drag selection, copy, and local scrolling in projected Workbench.
- `redeven:internal/envapp/ui_src/src/ui/file-preview/readPlan.test.ts` - Complete bounded input instead of binary sniffing.
- `redeven:scripts/generate_third_party_notices.mjs` - Hash-verified renderer notices, ECMA provenance, and MPL source reference.
