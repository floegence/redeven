---
type: UI Contract
title: Flower activity disclosure interaction
description: Keep native tool activation, disclosure state, viewport following, and floating controls consistent during live updates.
tags: [ai, flower, activity, interaction, accessibility]
timestamp: 2026-09-17T00:00:00Z
---
# Summary

Flower owns activity interaction in its shared UI. Canonical Floret identity and
presentation remain the only execution facts. Each transcript has one viewport
controller for follow intent, user input, temporary anchoring, and position
writes. A live update must not move a pressed tool trigger or introduce a
floating hit target before its native click completes. Canceled gestures never
activate tools. All transient ownership ends when its view is disposed.

# Contract

## Stable disclosure and safe content

Activity identity uses thread, run, turn, and canonical item ID. Status, payload,
renderer objects, and list positions cannot own component lifetime. Every tool
call has a stable native disclosure button from its first visible current,
including file reads and calls whose detail has not arrived. Structured details distinguish waiting, saved empty output, truncated output,
and historical records that did not save details. Missing scripts and screenshots
are stated explicitly; older records are neither rewritten nor reconstructed. Unknown tools remain neutral; no arbitrary payload, stdin, or
private path becomes an inspector fallback. File preview stays a separate
secondary action.

The existing manual-open map is the only disclosure authority. All tool details
start closed, including pending, waiting, running, completed, and failed calls.
Status and attention facts never open a panel. Running tools show the existing
title sweep while collapsed; settlement stops the sweep without changing the
user's choice. Failures keep their lifecycle indicator and an actionable error in the expanded details. Current replacements
and navigation within the same Flower surface preserve manual choices. This
state does not require a backend migration or survive a browser restart.

Triggers expose a pointer cursor, focus indication, `aria-expanded`, and
`aria-controls`. Enter and Space retain native activation. Before closing a
panel containing focus, the trigger receives focus with `preventScroll`.

## Intent, inputs and results

The collapsed title describes the invocation intent. Dynamic scripts retain the
required natural-language description through completion and private-input
pauses. Simple tools use localized action/object titles. Target names remain
secondary, while opaque identifiers, execution-platform codes and operation
counters do not become primary reading content.

Published Floret v7.14.0 owns structured `inputs`, result `rows`, `rows_provided`,
row `language` and `truncated` facts. Input rows are recorded at call time and
survive result-only updates. Redeven maps actual bounded tool data once, then
uses the same sanitizer and wire mapper for live and historical views. Searches,
multi-file reads, skills and saved sources retain meaningful content. Computer
and browser activities use this common path, with authorized target/frame refs
as supplemental controls. Text is never an attachment capability.

Expanded inputs and results preserve literal whitespace. Floe Webapp v0.56.9's
public `CodeBlock` owns highlighting, clipboard writes and accessible copy
feedback; Flower owns bounded layout and stable disclosure. Scripts start as one
compact command-style preview with a copy action; clicking expands the complete
code. Output follows without redundant section or language headers, and an
actionable failure suppresses the duplicate partial-output notice. English and
all shipped locales provide action labels, missing-data notices and copy feedback. Model descriptions, filenames, scripts and actual output remain
literal. Stable section keys and row slots retain DOM selection and expansion
through result updates. Presentation is never execution or authorization input.

## Viewport and gesture ownership

The existing per-viewport scroll controller owns all transcript position writes.
Physical near-bottom distance is measured independently from follow intent.
Layout scroll events, focus changes, animation, and content growth cannot resume
following. Return-to-latest and a verified user scroll toward the bottom may
resume it; opening a task and sending new work retain their explicit positioning
behavior. Wheel, touch, scrollbar, and scrolling-key inputs belong to the nearest
actual viewport. Nested terminal and detail scrolling cannot resume the outer
transcript. A gesture with changed layout dimensions cannot classify layout
clamping as a user return to the bottom.

Pressing a disclosure cancels queued and smooth following immediately and
anchors its title. Native click alone changes the manual choice. The controller
maintains the title through the press and resulting disclosure motion, within
scroll bounds. New scrolling releases the anchor. Cancellation restores the
previous follow intent only if no user scroll occurred. Pointer release, cancel,
keyboard release, window blur, target removal, and disposal clear short-lived
ownership. No synthetic click, pointerdown toggle, transport pause, or click
retry is used. Only the two controlled transcript viewports disable browser
scroll anchoring; nested output scrolling retains its separate behavior.

Return-to-latest floats above the main composer without reserving vertical
space. The child window uses its lower transcript edge. While content is being
pressed, the float keeps its existing visibility and cannot intercept the
pointer. If the float was the original target, it stays mounted and interactive
through native activation. Visibility changes commit on the frame after release
and click dispatch, not during pointerup. Hidden controls do not enter the focus
or hit-test order.

## Visual motion

The disclosure motion owner uses one current Web Animation: opening takes
180 ms and closing takes 140 ms. During opening, ResizeObserver coalesces content
measurements into one frame and retargets the remaining duration without moving
the original deadline. Once open, height becomes natural and the observer stops;
streaming growth does not start a resize animation. Reversal cancels the prior
animation, and its obsolete completion cannot change presence. Reduced motion
commits presence immediately with the same completion and focus behavior.

Each viewport combines resize, tail following, smooth scrolling, and disclosure
anchoring into one scheduled geometry read/write pass per frame. Only active
gestures, anchors, and smooth transitions schedule another frame. Idle or closed
details have no layout loop. Motion reports completion to that controller without
creating an anchor or changing follow intent. Automatic attention expansion and
content growth do not claim the viewport.

Details remain bounded by `min(42rem, 72vh)` with local overflow. The nearest
disclosure owns dynamic resize; outer timeline motion does not duplicate it.
[Terminal activity](flower-terminal-activity.md) owns terminal facts and the
separate output-scrolling policy. [SubAgent detail](flower-subagent-detail.md)
owns child grouping and projection; its viewport controller cannot affect the
parent transcript.

# Boundaries

This is Flower presentation policy, not a Floret public API or another execution
lifecycle. Host-rendered safe details cannot reconstruct tool input or authorize
file, process, or approval actions. Live transport continues during interaction.

# Evidence

- `redeven:internal/ai/tool_activity_details.go` - Bounded product input/result mapping over the released Floret contract.
- `redeven:internal/flower_ui/src/FlowerActivityRows.tsx` - Published code display, localized copy feedback and stable row expansion.
- `redeven:internal/flower_ui/src/flowerLiveMapper.ts` - Strict input/output row validation without dropping presentation fields.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.computerLifecycle.browser.test.tsx` - Live failure, exact screenshot refs, copy, keyboard, selection and historical absence.

- `redeven:internal/flower_ui/src/flowerScrollTail.ts` - One controller owns viewport intent, input, anchoring, and floating hit protection.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Stable activity triggers, safe empty details, and manual choice mapping.
- `redeven:internal/flower_ui/src/activityDisclosure.ts` - Visual presence, measured height, and animation completion.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.disclosureInteraction.browser.test.tsx` - Native 60/100/160 ms presses, live updates, float competition, and early/file detail transitions.
- `redeven:internal/envapp/ui_src/src/ui/flower/flowerScrollInteraction.test.ts` - Input attribution, cancellation, cleanup, keyboard holds, and nested viewport isolation.
- `redeven:internal/flower_ui/src/flowerScrollTail.test.ts` - Layout events cannot revive paused following.
- [Streaming stability](flower-streaming-stability.md) - Complete identity, side-effect, and performance acceptance inventory.

Desktop and Runtime negotiate compatibility epoch 21 because older strict Activity
decoders reject the new optional fields. The existing minimum v0.13.0 pair is
the unreleased product window; epoch 20 remains an admitted upgrade source.
