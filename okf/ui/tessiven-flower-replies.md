---
type: UI Contract
title: Tessiven Flower replies
tags: [ui, tessiven, flower]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Canvas replies use a compact themed floating reader. Flower owns conversation/actions/feedback; Floe owns geometry/pointer/layers. Hide retains composer/conversation. Errors, approvals and Retry keep canonical Flower behavior without a separate canvas recovery path.

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
