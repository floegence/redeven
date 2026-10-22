---
type: UI Contract
title: Tessiven Flower replies
description: Read canonical Flower output in a quiet movable canvas window.
tags: [ui, tessiven, flower]
timestamp: 2026-10-11T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven presents canvas replies in a compact, themed floating reading window.
Flower owns the conversation, actions and live feedback; Floe owns window
geometry, pointer interaction and floating-layer projection. Hiding the window
keeps the composer and conversation alive. Errors, approvals and retry retain
their canonical Flower behavior rather than a canvas-specific recovery path.

# Contract

## Reading surface
The window uses the theme's main reading surface continuously across its titlebar, transcript and composer surroundings. A subtle border and shadow frame compact readable message spacing; canvas nodes must not bleed through reply text.

End padding keeps the final choice fully readable when scrolled to the bottom; the action controls remain outside the fade.

## Actions and continuity
Less frequent actions live in the More menu: new conversation, settings, subagents, available Computer actions and opening the full conversation.

Messages, tool disclosures, questions, approvals and errors remain canonical.

Existing canvases open the combined window directly.

# Boundaries

## Product verification
Component rendering and an HTTP 200 from a frontend development server do not qualify a connected Env App.

Both surfaces send a Flower turn, display the canonical streamed reply and exercise the reply menu in the compact window.

It never attaches to an existing user browser or Runtime.

# Evidence

- `internal/tessiven_ui/src/TessivenFlowerPanel.tsx`: placement, More menu and restore behavior.

- `internal/tessiven_ui/src/tessiven.css`: scoped reading material and touch sizing.

- `internal/flower_ui/src/FlowerSurface.tsx`: canonical header action definitions and live conversation.
