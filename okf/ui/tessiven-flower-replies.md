---
type: UI Contract
title: Tessiven Flower replies
description: Read canonical Flower output in a quiet movable canvas window.
tags: [ui, tessiven, flower]
timestamp: 2026-10-08T00:00:00Z
---
# Summary

Redeven presents canvas replies in a compact, themed floating reading window.
Flower owns the conversation, actions and live feedback; Floe owns window
geometry, pointer interaction and floating-layer projection. Hiding the window
keeps the composer and conversation alive. Errors, approvals and retry retain
their canonical Flower behavior rather than a canvas-specific recovery path.

# Reading surface

The window uses a continuous opaque material across its titlebar and transcript,
a subtle border and shadow, and compact readable message spacing. It derives
colors from the selected theme; canvas nodes must not bleed through reply text.
The default size is 356 by 440 pixels, clamped to the available safe boundary.
The bottom composer remains outside that boundary.

The titlebar contains the decorative Flower identity, a More menu and native
maximize/restore and close controls. Its accessible title remains plain text.
Pointer controls expand for coarse input. Reply text remains selectable;
dragging and resizing belong to Floe and never move the composer.

# Actions and continuity

Less frequent actions live in the More menu: new conversation, settings,
subagents, available Computer actions and opening the full conversation. Flower
supplies the same action definitions used by its normal conversation header.
The canvas changes placement, not the operation or its eligibility.

The published Dropdown owns menu keyboard navigation, dismissal and focus
return. Nested surfaces use the actual trigger as their floating owner so
menus, subagents and Computer controls stay in the projected canvas scope.
There is no product-side coordinate scaling or replacement window controller.

Messages, tool disclosures, questions, approvals and errors remain canonical.
The refinement does not aggregate or hide tool activity. Pending delivery and
run feedback remain visible at the window bottom under the
[live timeline contract](flower-live-timeline.md).

Closing replies restores them through a small canvas control; sending also
reopens them. Hidden replies never acknowledge unread output. Drafts, exact
canvas context and in-flight delivery follow the
[canvas contract](tessiven-canvas.md) and
[composer reference contract](flower-composer-references.md).

# Evidence

- `internal/tessiven_ui/src/TessivenFlowerPanel.tsx`: placement, More menu and restore behavior.
- `internal/tessiven_ui/src/tessiven.css`: scoped reading material and touch sizing.
- `internal/flower_ui/src/FlowerSurface.tsx`: canonical header action definitions and live conversation.
- `internal/envapp/ui_src/src/styles/tessiven-flower.browser.test.tsx`: themes, geometry, native disclosure, menu focus and projected owners.
- `internal/envapp/ui_src/src/ui/FlowerSurface.sendFeedback.browser.test.tsx`: continuous delivery and run feedback.
