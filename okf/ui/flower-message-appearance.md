---
type: UI Contract
title: Flower message appearance
description: Keep assistant reading and sent user messages readable in every shell theme without changing content or interaction.
tags: [flower, themes, accessibility, selection]
timestamp: 2026-10-18T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Flower owns transcript message presentation in the shared Env App and Desktop
UI. Published Floe theme tokens own the palette. Sent user messages use the
theme's text-selection accent with readable foreground text. Native selection
must remain visible within a filled bubble and its insets. Theme changes alter
paint only, preserving message DOM, geometry and active selection. Queued input
keeps its quieter pending presentation; forced colors use system roles.
Transcript messages retain their original compact reading scale; composer
controls retain the published control scale. Source destinations and copy follow
[Flower citations](flower-citations.md), including safe authored bibliographies.

# Contract

## Transcript reading scale
Assistant and user bubbles share the original `0.875rem` body size and unitless `1.75` line height (14px and 24.5px at the standard 16px root).

Their `1.6` line height keeps wrapped content readable, while the status label uses `0.75rem` with `1.4` line height.

## Assistant reading roles
Assistant body and headings retain the published foreground on the chat surface.

Authored bold text, dates, identifiers, source labels and destinations remain unchanged; presentation does not infer metadata from prose or rewrite admitted Markdown.

## Filled messages and content
Sent user text and answered-question receipts use `selection-bg` and `selection-fg`.

Their text and selection use the inset reading roles so the error background cannot leave selection-colored message text unreadable.

Code retains theme-colored insets; its text derives from the theme foreground with bounded lightness.

## User media and resources
Each submitted user message presents image thumbnails first, then one wrapping row of resource cards, then its text bubble and existing timestamp/copy actions. Resource-only and image-only messages never create an empty text bubble.

Canonical reference previews retain exact thread, turn and reference identity; queued context actions retain their distinct authority and pending-click guard.

## Native text selection
Filled bubble text, including transparent table headers, uses Floe's contrasting `selection-on-primary` pair. Selecting text never changes parsing, content, copy behavior or transport state.

Browser coverage measures actual rendered colors across all 26 published presets and both surface materials. Ordinary and selected message text must reach 4.5:1. Code highlighting retains its independent [stable-content contract](flower-code-highlighting.md).

# Boundaries

Forced colors map sent bubbles to `Highlight` / `HighlightText`, pending input and insets to native reading surfaces, and selection to contrasting system roles. Palette and material ownership remain with [Desktop shell theme state](../desktop/desktop-shell-theme-state.md) and [shared surface material](surface-material.md).

# Evidence

- [Resource placement, responsive cards and canonical preview identity](../../internal/envapp/ui_src/src/ui/FlowerSurface.canonicalReferences.browser.test.tsx)

- [Image/file previews and attachment-only messages](../../internal/envapp/ui_src/src/ui/FlowerSurface.attachmentPreview.browser.test.tsx)

- [Mixed text/image send, history reload and copy](../../internal/envapp/ui_src/src/ui/FlowerSurface.composerAttachments.browser.test.tsx)
