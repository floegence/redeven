---
type: UI Contract
title: Flower message appearance
description: Keep assistant reading and sent user messages readable in every shell theme without changing content or interaction.
tags: [flower, themes, accessibility, selection]
timestamp: 2026-10-18T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Shared Flower uses published Floe colors for compact assistant/user reading and contrasting sent-message selection. Theme changes affect paint while preserving DOM, geometry and selection. Queued input stays quieter; forced colors use system roles. Media and resource cards retain canonical identity and never require an empty text bubble.

# Contract

## Transcript reading scale
Assistant/user text uses `0.875rem` and unitless `1.75` line height. Composer controls retain published control scale.

## Assistant reading roles
Body/headings retain the chat foreground. Presentation does not rewrite Markdown or infer metadata from authored bold text, dates, identifiers or citations. [Citations](flower-citations.md) own destinations/copy.

## Filled messages and content
Sent text/answered-question receipts use `selection-bg`/`selection-fg`. Text, placeholders and actions share the right edge; the full-row history wrapper makes the 78% desktop bubble limit relative to the transcript. Short text fits intrinsically; narrow views retain the full-column limit. Error/code insets use readable foreground and selection roles over their own backgrounds.

## User media and resources
Order is image thumbnails, wrapping resource cards, text bubble, then timestamp/copy. Resource/image-only messages omit empty bubbles. Canonical previews use exact thread/turn/reference identity; queued actions retain their separate authority/click guard.

## Native text selection
Filled text, including transparent table headers, uses contrasting `selection-on-primary` roles. Selection never changes parsing, copying or transport. Browser checks require 4.5:1 ordinary/selected text across all presets/materials. [Highlighting](flower-code-highlighting.md) retains its own stable-content contract.

# Boundaries

Forced colors map sent bubbles to `Highlight` / `HighlightText`, pending input and insets to native reading surfaces, and selection to contrasting system roles. Palette and material ownership remain with [Desktop shell theme state](../desktop/desktop-shell-theme-state.md) and [shared surface material](surface-material.md).

# Evidence

- [User-message alignment, intrinsic widths and responsive wrapping](../../internal/envapp/ui_src/src/ui/FlowerSurface.userMessageLayout.browser.test.tsx)

- [Resource placement, responsive cards and canonical preview identity](../../internal/envapp/ui_src/src/ui/FlowerSurface.canonicalReferences.browser.test.tsx)

- [Image/file previews and attachment-only messages](../../internal/envapp/ui_src/src/ui/FlowerSurface.attachmentPreview.browser.test.tsx)

- [Mixed text/image send, history reload and copy](../../internal/envapp/ui_src/src/ui/FlowerSurface.composerAttachments.browser.test.tsx)
