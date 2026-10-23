---
type: UI Contract
title: File preview viewport and rendering
description: Preview fit, renderer ownership, and Markdown reading colors.
tags: [ui, files, preview, viewport, rendering]
timestamp: 2026-10-01T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-23"
---
# Summary

Redeven owns preview modes, identity, and renderer lifetimes; published Floe owns sizing, PDF layers, and static PPTX. Documents/images initially fit, including enlargement. Resize updates automatic fit, preserving manual zoom. PDF/PPTX pages have one rendering owner. Stale work cannot replace current content; cancellation is neutral and failures stay local/retryable. HTML uses published isolation; source editing is explicit and incomplete HTML never executes.

# Contract

## Window boundary
The [floating layer contract](env-app-floating-layer-order.md) owns placement and viewport constraints. Title, close, and toolbar stay reachable while documents scroll locally.

## Reading area and zoom
Sizing excludes padding/scrollbars in local CSS pixels. Ancestor transforms, including Workbench projection, cannot change intrinsic size.

Flower attachments retain native PDF controls and contained images; containers shrink with the window.

## Rendering ownership
PDF uses the lazy published `@floegence/floe-webapp-core/pdf` entrypoint. Its scoped CSS must not affect unrelated surfaces.

Image load and error callbacks must match the currently displayed resource.

## HTML pages
The [HTML contract](file-preview-html.md) owns page-first opening, source editing, bounds, and isolation.

## Markdown enhancements
Mermaid skips theme sampling/sandbox allocation without diagrams, retains theme caching, and rejects stale work.

Floating Contents starts closed. A published Floe Dialog right drawer preserves document width, nodes, and scroll without reserving a sidebar. It fits narrow windows with published focus/dismissal/motion. Escape, close, or backdrop dismisses only Contents; heading selection scrolls only Markdown and closes it. File changes reset it; headingless documents disable it. Main previews keep their sidebar.

Both reading modes use published Floe colors: headings use interaction/info accents, lower headings and quotes use tip, emphasis uses note, links use info, and inline code uses its dedicated foreground. Dark headings retain hue with a lightness floor for raised windows. Tables and metadata use subtle tints; GFM alerts distinguish info, success, note, warning, and error.

Text and inset titles meet 4.5:1 contrast against actual backgrounds in every preset and both materials, including floating windows. Links retain underlines/focus; selection stays readable. Forced colors use system text, links, and boundaries. Theme changes preserve nodes, geometry, selection, focus, and scroll; theme state and syntax-highlighting ownership stay shared.

# Boundaries

The [window actions contract](file-preview-window-actions.md) owns actions, drafts, and dismissal. Rendering preserves unselected-widget wheel ownership, authorization, editability, and native attachment PDF behavior.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/file-markdown/FileMarkdown.themes.browser.test.tsx` - All-theme contrast, distinct roles, floating windows, continuity, and forced colors.

- `redeven:internal/envapp/ui_src/src/ui/widgets/createPreviewZoom.ts` - Zoom policy.

- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewZoomControls.tsx` - Shared zoom controls.

- `redeven:internal/envapp/ui_src/src/ui/widgets/PdfPreviewPane.tsx` - PDF virtualization over published layers.

- `redeven:internal/envapp/ui_src/src/ui/widgets/MarkdownPreviewPane.tsx` - Contained Contents drawer.
- `redeven:internal/envapp/ui_src/src/ui/widgets/MarkdownPreviewPane.browser.test.tsx` - Drawer geometry, focus, dismissal, and local navigation at three widths in both modes.
