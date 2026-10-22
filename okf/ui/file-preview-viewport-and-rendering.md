---
type: UI Contract
title: File preview viewport and rendering
description: Fit documents and images to their actual reading area and isolate asynchronous renderer work.
tags: [ui, files, preview, viewport, rendering]
timestamp: 2026-10-01T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns preview modes, file identity, and renderer lifetimes. Published Floe
Webapp owns measurement, fit scales, synchronized PDF layers, and static PPTX rendering. PDF, PPTX, DOCX, and
images initially fit the reading area, including enlargement; resizing updates
automatic fit but preserves manual zoom. Each PDF or PPTX page has one rendering owner.
Stale work cannot replace the current document; cancellation is neutral, and real
page failures remain local and retryable. Markdown without Mermaid skips diagram
theme sampling. HTML opens as an isolated page through published Floe document
isolation; source editing is explicit, and incomplete HTML never executes.

# Contract

## Window boundary
The [floating layer contract](env-app-floating-layer-order.md) owns window placement and visible viewport constraints. The preview title, close action and document toolbar remain reachable while the document scrolls in its own reading area.

## Reading area and zoom
Sizing uses local CSS pixels, excluding padding and scrollbars. Ancestor CSS transforms, including Workbench projection, must not change intrinsic document size.

Flower attachment windows retain native browser PDF controls and image containment; their document containers must shrink with the window.

## Rendering ownership
PDF uses the lazy published `@floegence/floe-webapp-core/pdf` entrypoint. Its scoped CSS must not affect unrelated surfaces.

Image load and error callbacks must match the currently displayed resource.

## HTML pages
The [HTML file preview contract](file-preview-html.md) owns page-first opening, source editing, bounded content, and isolated document interaction.

## Markdown enhancements
Mermaid processing checks for diagram elements before resolving theme colors or allocating a rendering sandbox. Diagram rendering retains theme-specific caching and rejects stale document work.

# Boundaries

The [window actions contract](file-preview-window-actions.md) owns title-bar file actions, drafts, and dismissal. Fit and renderer fixes must not grant an unselected widget local wheel ownership or alter file authorization, editability, or native attachment PDF behavior.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/createPreviewZoom.ts` - Shared product zoom policy over published Floe geometry.

- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewZoomControls.tsx` - Compact floating controls shared by sized preview renderers.

- `redeven:internal/envapp/ui_src/src/ui/widgets/PdfPreviewPane.tsx` - Product virtualization and controls over the published layered PDF surface.
