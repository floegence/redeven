---
type: UI Contract
title: Static PPTX file preview
tags: [ui, files, preview, pptx]
lifecycle: contract
reviewed_at: "2026-10-26"
---
# Summary

Published Floe owns static PPTX parsing and rendering; Redeven owns the reading
surface and authorized file bytes. Supported presentations open locally with
windowed slides, selectable text, and stable zoom. External resources stay disabled;
obsolete documents cannot replace the active source. Rendering failures expose
local recovery or incomplete-content guidance. Original licenses and corresponding
MPL source remain available with redistribution.

# Contract

PPTX uses the lazy published `@floegence/floe-webapp-core/pptx` entrypoint. Opening another file type must not load the PPTX engine.

Preview opens directly to the slides without a generic PowerPoint compatibility notice or an empty notice bar. Document-specific guidance appears only when external resources are disabled or some content cannot be rendered.

The renderer's original licenses, ECMA geometry notice, bundled dependency notices, and MPL corresponding source are verified and retained in the distributed third-party notice.

# Boundaries

The [preview viewport contract](file-preview-viewport-and-rendering.md) owns shared fit, controls, and local coordinate policy. This surface must not grant unselected widgets local wheel authority or change file permissions or editability.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/PptxPreviewPane.tsx` - Local page windowing, zoom, notices, and source lifetime.

- `redeven:internal/envapp/ui_src/src/ui/widgets/PptxPreviewPane.test.tsx` - Stale opens, disposal, windowing, and node failure disclosure.
