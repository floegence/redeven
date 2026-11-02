---
type: UI Contract
title: Flower turn status and process disclosure
tags: [ui, flower, turns, disclosure, accessibility]
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

Floret owns turn outcome/timing. Terminal ordinary turns fold eligible process rows once, while pending controls, uncertain effects and inspected work stay visible. Explicit choices persist; user messages/finals remain mounted. Settled question/answer receipts fold with the process and reopen with complete content.

# Contract

## Facts and eligibility
Validated turn facts carry exact TurnID/RunID, optional control kind, start/end/outcome, work/wait/elapsed time, ordered intermediate/final IDs and complete-final boundary. Summaries cannot author these facts or trigger folds; unknown prose stays visible. Typed structure determines eligibility, never prompt/time heuristics.

The turn header shows lifecycle status and total elapsed time, including user/approval waits; the terminal timing description retains canonical processing/waiting durations. A thinking-only process keeps its own disclosure and never acquires a whole-turn toggle. Durations show at most two nonzero units and subsecond copy. Interleaved answers default open with a whole-turn toggle; settled question/answer receipts fold with process rows and retain nested choices. Receipt decoration lives inside the viewport, leaving no folded gap/rail. Counts require complete boundaries, membership and event coverage; otherwise omit counts. [Sequences](flower-tool-sequences.md) fold settled work independently on either side.

## Disclosure ownership
Running/preparing/retrying/finalizing/waiting turns show a non-interactive status header from canonical admission, before provider output. Status text announces changes politely; elapsed seconds do not enter a live region. Exact outcome/end enables the toggle and one automatic fold of confirmed intermediate/process rows, including latest failed/canceled/interrupted turns. Final/trailing partial output stays visible.

Focus, selection, gestures, open details/thinking and away-from-tail reading protect inspected work; later observations cannot undo protection. Capture an unaffected visible anchor only when automatic folding begins. Explicit choices survive paging/reconnect/regrouping; newly classified inspected rows remain until the next explicit toggle without reopening siblings. Only disclosure/navigation opens a closed group. Retained folded bodies are inert and preserve offsets/choices. Main/embedded/child views share rendering with independent scroll owners.

## Placement and motion
The header anchors after the initiating request when loaded, otherwise before the first loaded response, independent of fold membership. The request and its header remain mounted as responses arrive. Canonical intermediate membership spans same-turn executions; engine owns supersession. In-turn Goals retain ownership; final boundaries stay run-scoped. Retained prefixes preserve confirmed intermediate facts; incoming windows replace overlapping classification. Partial windows never fetch earlier history just for presentation. Prepending the actual beginning moves header while preserving choice/focus; disclosure state is independent of anchor visibility.

Keep identical header geometry before and after eligibility so the toggle adds no space or width change. One-line status/time/detail slots use tabular digits, bounded width and overflow handling at narrow widths. Following folds align the real bottom before paint; no stale absolute offset, synthetic trailing space or competing growth animation. Long-to-short content settles at zero with final visible. Existing finals stay mounted during 260 ms fold; reduced motion settles immediately. Paused reading/manual actions retain anchors and necessary temporary insertion room, excluded from distance-to-latest. Input immediately cancels following; motion settlement cannot reclaim it.

Fresh visible live headers and observed completion reveal their full text through a bounded stepped clip (at most 360 ms), matching activity-title cadence. Complete text, accessible labels, controls and geometry exist immediately; no character queue delays facts or answers. Elapsed ticks never restart motion. Historical/restored headers, reconnect, urgent states and reduced motion remain immediate. Hiding the surface, reducing motion or interacting with the header settles the reveal. Changing the terminal disclosure wrapper retains the same reveal timing.

If prose waits for a sequence when the turn ends, the outer row owns motion and releases prose afterward. Nested geometry stays intact; interrupted inner folds transfer painted opacity/transform. Manual reversal retains choice and motion preference. Canonical Path, not timestamps, orders dialogue/receipts; preserve final segments and secret redaction.

## Elapsed presentation
Existing current-view server samples establish a browser-only monotonic anchor, retained across same-turn waits and continuation runs. No sample means status-only; queue time is never counted and browser wall time is not a source of authority. Newer samples reanchor after sleep/reconnect; delayed samples cannot move the live clock backward. Canonical terminal elapsed time always wins. The sample stays in the bounded detail cache and is stripped from thread summaries; it never becomes a wire field, stored lifecycle, or new event.

Only visible active headers subscribe to the existing Surface one-second clock. Offscreen, hidden, disconnected and terminal headers unsubscribe. Clock ticks update only the time label, never history projections, counts, folding or network demand. Reconnecting shows a status and pauses ticking until existing transport confirmation; no new poll, request, payload or server write is permitted for this presentation.

## Outcome presentation
Terminal labels use 13px/20px text and decorative 16px Floe warning, circled-stop or circled-alert icons for failure, cancellation or interruption. Quiet label color, first-row wrap alignment and localized status retain accessibility. Existing current-run diagnostics/recovery do not acquire duplicate outcome labels.

# Boundaries

Disclosure is ephemeral UI state. Ordinary user messages and final content stay mounted and ordered. Settled question/answer receipts retain canonical turn ownership across continuation runs and become inert while folded; expansion restores their full content. Summaries and network events cannot hide pending controls.

# Evidence

Browser regressions cover pre-output visible headers, local elapsed updates without extra reads, waits, reconnect/offscreen subscription bounds, minute/hour transitions at 320/390/1280px, frame-by-frame real-tail alignment and answer visibility, large and repeated folds, narrow viewports, reduced motion, subsequent growth, explicit navigation, short-history pagination, focus, selection and nested choices in main/child views. Continuation cases retain old-run prose and Goal; history prepends retain header focus and disclosure state. Existing isolated historical-copy qualification covers one opening read, no idle traversal, and complete statistics after explicit sequence expansion and progressive paging.

- `redeven:go.mod` - Published Floret dependency.

- `redeven:internal/ai/flower_current_projection_test.go` - Canonical historical turn facts preserved.

- `redeven:internal/flower_ui/src/runtimeCurrentView.ts` - Validates and maps current turn facts.
- `redeven:internal/flower_ui/src/flowerTurnPresentation.test.ts` - Settled input folds across continuations; active/pending state and defaults persist.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.turnProcess.browser.test.tsx` - Folded receipts, restored answers/choices/checkpoints and thinking/turn motion.

- [Header](../../internal/flower_ui/src/FlowerTurnHeader.tsx) and [clock tests](../../internal/flower_ui/src/flowerTurnClock.test.ts): isolated visible subscriptions and server-sampled elapsed time.
- [Header browser acceptance](../../internal/envapp/ui_src/src/ui/FlowerTurnHeader.browser.test.tsx): bounded subscriptions and responsive geometry.
- Header motion tests retain complete text and geometry at 320/390/1280px, bound animation to phase changes, cancel on interaction/preferences, and keep restored history static. The full Surface test covers fresh admission through a subsecond answer without delaying final content.
