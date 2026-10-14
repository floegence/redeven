---
type: UI Contract
title: Flower message appearance
description: Recognize sent user messages and keep their text, references and native selections readable in every shell theme.
tags: [flower, themes, accessibility, selection]
timestamp: 2026-10-14T00:00:00Z
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

Message bubbles use a `0.9375rem` body size and unitless `1.75` line height
(15px and 26.25px at the standard 16px root). Markdown follows that message
scale; headings use proportional sizes and line heights, paragraphs have
`0.8em` separation, and list items have `0.4em` separation. The first rendered
block keeps its top margin reset, including while streaming. Assistant prose
retains its 58rem maximum reading width. Code and tables use a smaller relative
reading size and keep their own constrained horizontal scrolling.

This scale belongs to transcript message bubbles, not a root theme token or
whole-Flower zoom setting. Permission mode, model, reasoning controls and the
composer editor retain their existing typography. Theme changes remain paint-
only; they do not alter reading geometry or remount Markdown content.

## Filled messages and content

Sent user content, context bubbles and answered-question receipts use
`selection-bg` and `selection-fg`. Classic Light's bright selection accent uses
dark ink derived from the theme foreground to meet body-text contrast without
changing the accent. Queued bubbles retain their soft theme-derived background
and ordinary foreground.

Failed user messages retain the error surface with its icon and heading. Their
text and selection use the inset reading roles so the error background cannot
leave selection-colored message text unreadable.

Links retain underlines and use the bubble foreground in idle, hover and focus
states. Keyboard focus has a visible outline. Quotes, receipt labels and
reference labels inherit the bubble foreground. Reference chips retain their
source text and actions with a transparent face, readable detail text and a
foreground-derived boundary. Tables and code retain separate theme-colored
insets; their text derives from the theme foreground with bounded lightness.

## Native text selection

Filled bubble text uses Floe's contrasting `selection-on-primary` pair. Code,
table-header insets and queued input use the theme's dark/light reading roles
in reverse, keeping selection distinct from their own faces. Selecting text
never changes parsing, content, copy behavior or transport state.

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
face, including references, receipts, quotes, tables and code. Tests also cover
link hover/focus, native selection preservation during theme changes, narrow
layout, failed messages and forced colors. Code highlighting retains its independent
[stable-content contract](flower-code-highlighting.md).

# Evidence

- [Shared message styles](../../internal/flower_ui/src/styles/flower.css)
- [Shared transcript rendering](../../internal/flower_ui/src/FlowerSurface.tsx)
- [Theme, contrast and selection acceptance](../../internal/envapp/ui_src/src/styles/flowerMessageContrast.browser.test.tsx)
