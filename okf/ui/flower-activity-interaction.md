---
type: UI Contract
title: Flower activity disclosure interaction
description: Keep native tool activation, disclosure state, viewport following, and floating controls consistent during live updates.
tags: [ai, flower, activity, interaction, accessibility]
timestamp: 2026-10-19T00:00:00Z
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
renderer objects, and list positions cannot own component lifetime. Tools
retain a stable native disclosure button while details are available or pending,
including file reads. A completed Computer Use call with saved empty results
and no script, frame, or failure is a static row without a disclosure. Structured details distinguish waiting, saved empty output, truncated output,
and historical records that did not save details. Missing scripts and screenshots
are stated explicitly; older records are neither rewritten nor reconstructed. Unknown tools remain neutral; no arbitrary payload, stdin, or
private path becomes an inspector fallback. File preview stays a separate
secondary action.

Single-file edit details start with the diff. The tool title owns the filename,
change counts and file actions, without a repeated toolbar inside the details.
Multi-file edits retain each file's toolbar to identify its diff and actions.

The existing manual-open map is the only disclosure authority. All tool details
start closed, including pending, waiting, running, completed, and failed calls.
Status and attention facts never open a panel. Running tools show the existing
title sweep while collapsed; settlement stops the sweep without changing the
user's choice. Failures keep their status-colored static type icon and accessible status. Expanded details show inputs and available results before one actionable error, without repeating it beside the title or in generic empty-output notices. Terminal exit codes and generic timeouts use their localized result once; distinct failures and recovery suggestions stay visible. Current replacements
and navigation within the same Flower surface preserve manual choices. This
state does not require a backend migration or survive a browser restart.

Triggers expose a pointer cursor, focus indication, `aria-expanded`, and
`aria-controls`. Enter and Space retain native activation. Before closing a
panel containing focus, the trigger receives focus with `preventScroll`.

## Thread query and read details

`Thread Query:` and `Thread Read:` are fixed English technical tool labels; their
suffix preserves the model-authored invocation intent in the user's language.
Historical calls without a description retain neutral titles. Expansion loads
authorized saved results using exact timeline identities, shows key parameters
in two columns and three short result excerpts, and supports local expansion
and retry. See the [thread query contract](../ai/flower-thread-queries.md) for
canonical lookup, privacy, server bounds and failure behavior.

## Web search details

Web operations use one localized action title for visible and accessible labels.
Search uses the actual first query, retaining `site:` syntax, plus the remaining
query count. Open shows the returned URL. Find shows the exact pattern and
`@site:host`. Distinct search, open-page and find icons reflect the operation.
Titles are deterministic provider facts; no additional model request is made.

Expanded details contain only actual per-call results and errors, never the
header's query, URL, pattern or status. Operations without results or errors
have no disclosure, including explicit empty results and historical activities
whose result presentation was not retained. No missing-data placeholder appears.

Sources start with three entries. Titles and snippets are optional; URL-only
sources show their domain and path. Safe links retain their full address and
open in a new tab; unsafe addresses remain selectable plain text. Supplied
snippets remain visible beside the link when space permits and wrap naturally.
Domains sit next to titles, and no repeated Sources heading adds vertical space.
One keyboard-accessible control reveals
the remaining entries while retaining focus. Long links ellipsize and snippets
wrap at narrow widths. No content is generated or fetched to fill gaps; answer
citations never become invented per-call results. Floret v7.44.1 preserves
URL-only sources through validation and canonical restart.

## Semantic tool icons

Collapsed rows retain their compact geometry. Each registered tool, the hosted
web-search activity, source activity, MCP extension, and unknown extension has
an explicit type glyph. Command execution and subsequent output reads share
one terminal glyph and use the existing four-square loader while running.
Other running tools animate the meaningful parts of their type glyph.
File edit, write, patch and Tessiven edit share one pencil-and-stroke glyph.
The pencil lowers, writes left to right with the stroke following its tip,
then lifts and returns while the stroke fades. The 2.2-second cycle stays
inside the existing 16px icon slot. Settled and reduced-motion states retain
the complete pencil and stroke.
Successful and failed calls retain the full static glyph with the
existing status color; no badge obscures it. Canonical status remains available
to assistive technology without repeating it in the expanded content.

The pinned Lucide glyphs, shared writing pencil and tool motion recipes form
one presentation catalog. Status changes cancel every animation and remove running base styles;
command settlement replaces the loader with the terminal glyph. Other tools
retain the same SVG. Unmount cancels all work. The system reduced-motion
preference stops glyph and four-square motion, including when it changes during
execution. Historical running rows animate only after live presentation
is confirmed. Both Desktop and Env App consume the same component.

## Intent, inputs and results

The collapsed title describes the invocation intent. Dynamic scripts retain the
required natural-language description through completion and private-input
pauses. Every Computer Use and Browser Use tool requires that description.
Titles use `ComputerUse: description` or `BrowserUse: description`; the actual
resolved target kind identifies browser execution, including Computer scripts.
Discovery remains Computer Use. Historical calls without descriptions use a
localized action rather than a fabricated intent. Actual outcomes never replace
the invocation intent. Opaque identities and execution-platform codes do not
become primary reading content. Foreground activation warnings remain visible.

Structured `inputs`, result `rows`, `rows_provided`, row `language` and
`truncated` facts were introduced in published Floret v7.14.0 and remain owned by
the published Floret runtime. Input rows are recorded at call time and
survive result-only updates. Redeven maps actual bounded tool data once, then
uses the same sanitizer and wire mapper for live and historical views. Searches,
multi-file reads, skills and saved sources retain meaningful content. Computer
and browser activities use this common path, with authorized target/frame refs
as supplemental controls. Text is never an attachment capability.

Expanded inputs and results preserve whitespace. Floe Webapp's public `CodeBlock`
owns highlighting, clipboard writes and accessible copy feedback; Flower owns
bounded layout and stable disclosure. Scripts start with a compact command-style
preview and copy action. Existing terminal, editing, search and script presenters
retain their layouts and independent scrolling. Missing Computer target and
Tessiven runtime/service presenters start with three entries and two-line previews;
a localized control reveals remaining supplied content. Missing data is distinct
from empty output.

Computer details show readable candidates, safe addresses, page text, fields and
controls using localized semantic roles. Discovery retains its default candidate
in the initial three rows. Page changes are not complete snapshots. Results
precede scripts. Confirmation-only and verified blank-page results add no empty
panel; partial execution, failures, truncation, frames and missing historical
details stay explicit. Actionable failures suppress duplicate partial-output
notices. All locales provide action labels, missing-data and copy feedback; model
descriptions, filenames, scripts and actual output remain literal. Stable section
keys and row slots preserve selection and expansion during result updates.
Presentation never supplies execution input or authorization.

## Viewport and gesture ownership

One controller per viewport owns transcript position. Follow intent is separate
from near-bottom geometry and persists while short content fits, including
no-op scroll input. Overflow starts following without a click. Layout, focus,
animation and growth never resume a reading pause. Return-to-latest,
opening a task and sending work keep explicit positioning. Input belongs to
the nearest real viewport; nested output never resumes the outer transcript.
Verified downward movement resumes at the current or previous bottom when
live growth races its scroll event. Only an unchanged or non-contracting range
proves forward user movement. Shrink clamping, upward input and partial downward
reading stay paused. Whitespace clicks restore prior follow intent.

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
- `redeven:internal/ai/computer_activity.go` - Candidate and semantic page facts without redundant status or platform details.
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

- `redeven:internal/flower_ui/src/FlowerToolIcon.tsx` - Semantic glyph animation lifecycle and reduced-motion cleanup.
- `redeven:internal/flower_ui/src/flowerToolMotion.test.ts` - Coverage of the registered tool catalog.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.toolPresentation.browser.test.tsx` - Real glyphs, stable settlement and compact desktop/mobile disclosure.
