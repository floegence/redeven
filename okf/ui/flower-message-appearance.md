---
type: UI Contract
title: Flower message appearance
tags: [flower, themes, accessibility, selection]
lifecycle: contract
reviewed_at: "2026-10-29"
---
# Summary

Shared Flower uses published Floe colors for compact assistant/user reading and contrasting sent-message selection. Theme changes affect paint while preserving DOM, geometry and selection. Queued input stays quieter; forced colors use system roles. Media and resource cards retain canonical identity and never require an empty text bubble.

# Contract

## Transcript reading scale
Assistant/user text uses `0.875rem` and unitless `1.75` line height. Composer controls retain published control scale.

## Assistant reading roles
Body/headings retain the chat foreground. Presentation does not rewrite Markdown or infer metadata from authored bold text, dates, identifiers or citations. [Citations](flower-citations.md) own destinations/copy.

## Filled messages and content
Sent text/answered-question receipts mix 4% theme foreground into the published `floe-well-on-plane` fill for clearer separation from the content canvas, with `floe-radius-group` corners and 16px horizontal padding. Reading ink derives from the theme foreground with stronger light/dark luminance; ordinary text, full questions and answers share that ink and the transcript reading scale. Across published presets and both materials, body ink clears 7:1 and is no weaker than assistant ink on the same capsule surface. Only status/redacted metadata is secondary. Queued input retains its separate paint and spacing.

Answered receipts retain every complete question followed by its answer in canonical order, without disclosure or choices. Questions use regular weight, answers medium weight, and a quiet check accompanies the localized status. Spacing and thin neutral separators distinguish multiple responses. Short receipts fit their content without a minimum-width panel.

Text, placeholders and actions share the right edge; the full-row history wrapper makes the 78% desktop bubble limit relative to the transcript. Short text fits intrinsically; narrow views retain the full-column limit. Error/code insets use readable foreground and selection roles over their own backgrounds.

## User media and resources
Order is image thumbnails, wrapping resource cards, text bubble, then timestamp/copy. Resource/image-only messages omit empty bubbles. Canonical previews use exact thread/turn/reference identity; queued actions retain their separate authority/click guard.

## Native text selection
Filled text, including transparent table headers, reverses capsule ink and fill for visible native selection; code and queued insets retain their own selection roles. Selection never changes parsing, copying or transport. Browser checks require 4.5:1 supporting/selected text and a visible selection surface across all presets/materials. Copying answered receipts retains complete ordered questions/answers and the localized hidden-answer placeholder. [Highlighting](flower-code-highlighting.md) retains its own stable-content contract.

# Boundaries

Forced colors map sent bubbles to `Highlight` / `HighlightText`, pending input and insets to native reading surfaces, and selection to contrasting system roles. Palette and material ownership remain with [Desktop shell theme state](../desktop/desktop-shell-theme-state.md) and [shared surface material](surface-material.md).

# Evidence

- [Theme/material contrast, native selection and forced colors](../../internal/envapp/ui_src/src/styles/flowerMessageContrast.browser.test.tsx)
- [Full-context receipts, ordered copy, hidden answers and narrow-screen theme changes](../../internal/envapp/ui_src/src/ui/FlowerSurface.inputResponse.browser.test.tsx)
- [User-message alignment, intrinsic widths and responsive wrapping](../../internal/envapp/ui_src/src/ui/FlowerSurface.userMessageLayout.browser.test.tsx)

- [Image/file previews and attachment-only messages](../../internal/envapp/ui_src/src/ui/FlowerSurface.attachmentPreview.browser.test.tsx)
