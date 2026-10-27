---
type: UI Contract
title: File preview viewport and rendering
description: Preview fit, renderer ownership, and Markdown reading colors.
tags: [ui, files, preview, viewport, rendering]
timestamp: 2026-10-01T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
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
