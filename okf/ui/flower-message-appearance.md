---
type: UI Contract
title: Flower message appearance
description: Recognize sent user messages and keep their text, references and native selections readable in every shell theme.
tags: [flower, themes, accessibility, selection]
timestamp: 2026-10-16T00:00:00Z
---

# Summary

Flower owns transcript message presentation in the shared Env App and Desktop
UI. Published Floe theme tokens own the palette. Sent user messages use the
theme's text-selection accent with readable foreground text. Native selection
must remain visible within a filled bubble and its insets. Theme changes alter
paint only, preserving message DOM, geometry and active selection. Queued input
keeps its quieter pending presentation; forced colors use system roles.
Transcript reading typography has its own scale; composer controls retain the
published compact scale. Source destinations and copy follow
[Flower citations](flower-citations.md), including safe authored bibliographies.

# Contract

## Transcript reading scale

Message bubbles use a `0.875rem` body size and unitless `1.75` line height
(14px and 24.5px at the standard 16px root). Markdown follows that message
scale; headings use proportional sizes and line heights, paragraphs have
`0.8em` separation, and list items have `0.4em` separation. The first rendered
block keeps its top margin reset, including while streaming. Assistant prose
retains its 58rem maximum reading width. Code and tables use a smaller relative
reading size and keep their own constrained horizontal scrolling.

This scale belongs to transcript message bubbles, not a root theme token or
whole-Flower zoom setting. Permission mode, model and reasoning controls retain
their existing compact typography. Desktop composer text and password editors
use `0.875rem` with `1.6` line height; textarea minimum height and autosizing
follow the editor line height. Existing touch-input rules retain the 16px
minimum that prevents iOS Safari focus zoom. Theme changes remain paint-only;
they do not alter reading geometry or remount Markdown content.

Answered-question receipts inherit the message body size for both questions
and answers, including redacted answers. Their `1.6` line height keeps wrapped
content readable, while the status label uses `0.75rem` with `1.4` line height.

## Filled messages and content

Sent user text and answered-question receipts use
`selection-bg` and `selection-fg`. Classic Light's bright selection accent uses
dark ink derived from the theme foreground to meet body-text contrast without
changing the accent. Queued bubbles retain their soft theme-derived background
and ordinary foreground.

Failed user messages retain the error surface with its icon and heading. Their
text and selection use the inset reading roles so the error background cannot
leave selection-colored message text unreadable.

Links retain underlines and use the bubble foreground in idle, hover and focus
states. Keyboard focus has a visible outline. Quotes and receipt labels inherit the bubble foreground. Tables sit directly on the message surface with
one header rule and quieter separators between body rows. They have no outer
frame, vertical rules, or header fill. Column alignment and local horizontal
scrolling remain intact. Code retains theme-colored insets; its text derives
from the theme foreground with bounded lightness.

## User media and resources

Each submitted user message presents image thumbnails first, then one wrapping
row of resource cards, then its text bubble and existing timestamp/copy actions.
Files, directories, selected text/code, terminal output, process snapshots,
conversation references and page facts share the same card surface; there is no
separate context header, count, disclosure, or nested context group. Resource-only
and image-only messages never create an empty text bubble. The same composition
is used for queued transcript entries; the compact composer queue retains its
own ordering and take-back interaction.

Cards align to the right, use three columns when space permits, two on narrow
surfaces, and one below 19rem of available width. This follows the actual
conversation container, including companion and Workbench placements. Names
and details truncate visually with accessible full labels; the truncated-content
notice remains visible. Images keep their aspect ratio inside bounded thumbnails
and use the authorized attachment preview. Content blocks and references retain
their canonical order within each presentation group, with stable keys so live
updates do not reload media or replace focused controls.

Published Floe file and folder icons supply type-specific identity at 24px;
selected code, terminals, processes and threads use the corresponding existing
icon components. The host recognizes its frozen Activity-page JSON facts only
for a page glyph; this does not change the canonical text kind, preview bytes,
or navigation authority. Unrecognized text remains a selected-text reference.
Resource cards use theme card/foreground roles with visible hover and keyboard
focus. Theme changes do not animate the card background independently of text.
Canonical reference previews retain exact thread, turn and reference identity;
queued context actions retain their distinct authority and pending-click guard.

## Native text selection

Filled bubble text, including transparent table headers, uses Floe's
contrasting `selection-on-primary` pair. Code insets and queued input use the
theme's dark/light reading roles in reverse, keeping selection distinct from
their own faces. Selecting text never changes parsing, content, copy behavior
or transport state.

# Boundaries

Forced colors map sent bubbles to `Highlight` / `HighlightText`, pending input
and insets to native reading surfaces, and selection to contrasting system
roles. Palette and material ownership remain with
[Desktop shell theme state](../desktop/desktop-shell-theme-state.md) and
[shared surface material](surface-material.md).

# Acceptance

Browser coverage measures actual rendered colors across all 26 published
presets and both surface materials. Ordinary and selected message text must
reach 4.5:1. Selection faces must remain visibly distinct from their containing
face, including receipts, quotes, tables and code. Resource labels and details
meet the same ordinary-text contrast requirement. Tests also cover
link hover/focus, native selection preservation during theme changes, narrow
layout, failed messages and forced colors. Code highlighting retains its independent
[stable-content contract](flower-code-highlighting.md).

# Evidence

- [Resource placement, responsive cards and canonical preview identity](../../internal/envapp/ui_src/src/ui/FlowerSurface.canonicalReferences.browser.test.tsx)
- [Image/file previews and attachment-only messages](../../internal/envapp/ui_src/src/ui/FlowerSurface.attachmentPreview.browser.test.tsx)
- [Stable resource nodes and empty-body handling](../../internal/envapp/ui_src/src/ui/flower/FlowerUserMessageBody.test.tsx)
- [Shared message styles](../../internal/flower_ui/src/styles/flower.css)
- [Shared transcript rendering](../../internal/flower_ui/src/FlowerSurface.tsx)
- [Theme, contrast and selection acceptance](../../internal/envapp/ui_src/src/styles/flowerMessageContrast.browser.test.tsx)
- [Rendered text scale and compact composer controls](../../internal/envapp/ui_src/src/ui/FlowerMarkdown.citations.browser.test.tsx)
- [Horizontal table rules, alignment and narrow scrolling](../../internal/envapp/ui_src/src/ui/FlowerMarkdown.tables.browser.test.tsx)
- [Answered-question receipt and composer acceptance](../../internal/envapp/ui_src/src/ui/FlowerSurface.inputResponse.browser.test.tsx)
