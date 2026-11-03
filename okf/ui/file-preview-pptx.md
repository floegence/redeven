---
type: UI Contract
title: Static PPTX file preview
tags: [ui, files, preview, pptx]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Floe parses/renders static PPTX; Redeven authorizes bytes and presents the reading surface. Local windowed slides retain text selection and zoom, with external resources disabled. Stale work cannot replace current source. Errors expose bounded recovery, and redistribution retains licenses and corresponding MPL source.

# Contract

PPTX uses the lazy published `@floegence/floe-webapp-core/pptx` entrypoint. Opening another file type must not load the PPTX engine.

Preview opens directly to the slides without a generic PowerPoint compatibility notice or an empty notice bar. Document-specific guidance appears only when external resources are disabled or some content cannot be rendered.

The renderer's original licenses, ECMA geometry notice, bundled dependency notices, and MPL corresponding source are verified and retained in the distributed third-party notice.

# Boundaries

The [preview viewport contract](file-preview-viewport-and-rendering.md) owns shared fit, controls, and local coordinate policy. This surface must not grant unselected widgets local wheel authority or change file permissions or editability.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/PptxPreviewPane.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/widgets/PptxPreviewPane.test.tsx` - Tests.
