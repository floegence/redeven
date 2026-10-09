---
type: UI Contract
title: Tessiven Flower replies
description: Read canonical Flower output in a quiet movable canvas window.
tags: [ui, tessiven, flower]
timestamp: 2026-10-09T00:00:00Z
---
# Summary

Redeven presents canvas replies in a compact, themed floating reading window.
Flower owns the conversation, actions and live feedback; Floe owns window
geometry, pointer interaction and floating-layer projection. Hiding the window
keeps the composer and conversation alive. Errors, approvals and retry retain
their canonical Flower behavior rather than a canvas-specific recovery path.

# Contract

## Reading surface

The window uses the theme's main reading surface continuously across its
titlebar, transcript and composer surroundings. Only the rounded input has a
distinct fill. A subtle border and shadow frame compact readable message
spacing; canvas nodes must not bleed through reply text.
Live response feedback has no divider above it and uses compact spacing to
leave the height budget to transcript content and the rounded input.
The default size is 356 by 440 pixels, clamped to the available safe boundary.
The composer belongs to the same window as the transcript, questions, approvals
and retry controls. Dragging, resizing, hiding and restoring move or affect that
single conversation surface.

The titlebar contains the decorative Flower identity, a More menu and native
maximize/restore and close controls. Its accessible title remains plain text.
Pointer controls expand for coarse input. Reply text remains selectable;
dragging and resizing belong to Floe and keep the transcript and composer in
the same bounded window.

The conversation host owns a single height budget. The transcript yields space
to the composer, while long questions, approvals, and multiline drafts scroll
inside their own content region. The composer keeps the canonical rounded input
surface and its action controls remain inside the window at short heights.
Very short hosts reduce inner spacing while retaining usable controls and a
scrollable reading region; long drafts yield editor height to their footer.
Questions fade softly at the lower scroll edge instead of using a divider above
the action row. End padding keeps the final choice fully readable when scrolled
to the bottom; the action controls remain outside the fade.

## Actions and continuity

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

Closing the window restores it through a small canvas control; sending also
reopens it. Hidden conversations never acknowledge unread output. Drafts, exact
canvas context and in-flight delivery follow the
[canvas contract](tessiven-canvas.md) and
[composer reference contract](flower-composer-references.md).

An empty new canvas starts with only the canonical Flower composer at the canvas
bottom. The transcript window appears after the first send, and the same
conversation surface then owns both transcript and composer. Existing canvases
open the combined window directly. Reduced-motion settings disable the entry
motion without changing placement or state.

# Boundaries

## Product verification

Component rendering and an HTTP 200 from a frontend development server do not
qualify a connected Env App. Workbench requires its Runtime layout snapshot,
initial persistence and reload; canvas updates and Flower require the acquired
session transport. A standalone Vite server supplies none of these endpoints.
Do not hide a layout-load error to make an unconnected preview appear healthy.

The focused `test:canvas-runtime` qualification starts an isolated Runtime from
the built bundle with its published plugin sidecars and a fresh state root.
It loads the full Env App, verifies Workbench persistence and reload, opens the
standalone canvas through its Dock action, and opens the Activity canvas through
the Activity Bar with its navigation rail visible. Both surfaces send a Flower turn,
display the canonical streamed reply and exercise the reply menu in the compact
window. Light and dark screenshots and a machine-readable report provide
reviewable evidence. Short, narrow Activity and standalone windows also receive
a real `ask_user` interaction, scroll to its last choice and submit it through
the canonical Runtime boundary. Only the model response is scripted; this does not qualify
model reasoning, generation quality, or a real provider's availability.

Run it after building the Env App assets and Runtime bundle:

```sh
pnpm test:canvas-runtime --binary /path/to/bundle/redeven --output /path/to/evidence
```

This focused local qualification is not added to ordinary source CI or the
bounded push gate. It never attaches to an existing user browser or Runtime.

# Evidence

- `internal/tessiven_ui/src/TessivenFlowerPanel.tsx`: placement, More menu and restore behavior.
- `internal/tessiven_ui/src/tessiven.css`: scoped reading material and touch sizing.
- `internal/flower_ui/src/FlowerSurface.tsx`: canonical header action definitions and live conversation.
- `internal/envapp/ui_src/src/styles/tessiven-flower.browser.test.tsx`: themes, geometry, native disclosure, menu focus and projected owners.
- `internal/envapp/ui_src/src/ui/FlowerSurface.sendFeedback.browser.test.tsx`: continuous delivery and run feedback.
- `internal/envapp/ui_src/scripts/checkCanvasRuntime.mjs`: complete product entry, Runtime layout, session transport and reply-window evidence.
