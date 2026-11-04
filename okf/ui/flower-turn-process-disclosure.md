---
type: UI Contract
title: Flower turn status and process disclosure
tags: [ui, flower, turns, disclosure, accessibility]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Floret owns turn outcome and timing. Terminal turns fold eligible process rows once; pending controls, uncertain effects and inspected work remain visible. Explicit choices persist, user messages/finals stay mounted, and settled question/answer receipts reopen with complete content.

# Contract

## Facts and eligibility
Turn kind uses the [published-module consumer contract](../ai/flower-upgrade-compatibility.md#turn-kind-consumer-contract). Host-work completion is a distinct canonical turn with no new user message; preserve its final answer, identity and timing through loading, paging and observation. Detail and live failures record safe field/reason diagnostics without rejected values or content.

Validated facts carry exact TurnID/RunID, optional control kind, start/end/outcome, work/wait/elapsed time, ordered intermediate/final IDs and complete-final boundary. Typed structure determines eligibility; summaries, prompts and time heuristics cannot trigger folds. Unknown prose stays visible.

Headers show lifecycle and total elapsed time including waits; terminal descriptions retain processing/wait durations. Show <=two nonzero units and subsecond copy. Thinking-only work keeps its own disclosure without a whole-turn toggle. Interleaved answers default open; settled question/answer receipts fold with process rows, retaining nested choices and viewport-contained decoration without folded rail/gap. Counts require complete boundaries/membership/events; otherwise omit. [Sequences](flower-tool-sequences.md) fold independently on either side.

## Ownership
From canonical admission, running/preparing/retrying/finalizing/waiting turns show a non-interactive header before provider output. Announce status politely, never elapsed ticks. Exact outcome/end enables the toggle and one automatic fold of confirmed process/intermediate rows, including latest failed/canceled/interrupted turns. Final/trailing partial output remains.

Focus, selection, gestures, open details/thinking and away-from-tail reading protect inspected work permanently against later observations. Capture an unaffected visible anchor when automatic folding starts. Explicit choices survive paging/reconnect/regrouping. Newly classified inspected rows stay until the next explicit toggle without opening siblings; only disclosure/navigation reopens groups. Retained folded bodies are inert with offsets/choices intact. Main/embedded/child views share rendering, not scroll owners.

## Placement and motion
Anchor the header after its loaded request or before the first loaded response, independently of fold membership. Keep request/header mounted during arrival. Intermediate membership spans same-turn runs; Engine owns supersession. Goals keep turn ownership; finals are run-scoped. Retained prefixes preserve confirmed facts; windows replace overlapping classification. Partial windows never fetch history for presentation. Prepending the beginning moves the header while retaining choice/focus; anchor visibility does not own disclosure.

Eligibility changes no header geometry. One-line status/time/detail slots use tabular digits, bounded widths and narrow overflow handling. Following folds align actual bottom before paint, without stale absolute offsets, synthetic trailing space or competing growth motion. Long-to-short content ends at zero with final visible. Finals remain mounted during the 260 ms fold; reduced motion is immediate. Manual/paused reading retains anchors and necessary insertion room, excluded from distance-to-latest. Input cancels follow; settlement cannot reclaim it.

Fresh visible live labels fade 0.68→1 over 180 ms; later changes 0.88→1 over 160 ms. The complete current label stays readable: no clipping, blank frames, overlapping text or character queue. Fast completion joins the active transition. One JSX text owner survives wrapper-to-button changes with node/timing intact; at most one bounded opacity animation. Accessibility, controls and geometry update immediately; ticks never restart motion. History/restoration/reconnect/urgent states/reduced motion are immediate. Hide, interaction or reduced motion settles animation.

When a turn ends while prose waits on an inner sequence, outer motion owns release and preserves nested geometry; interrupted inner folds transfer painted opacity/transform. Manual reversal retains choice/preferences. Canonical Path orders dialogue/receipts, never timestamps; preserve final segments and secret redaction.

## Elapsed time
Current-view server samples establish a browser monotonic anchor across same-turn waits/continuations. Missing sample means status-only: queue/browser wall time is not authority. Newer samples reanchor after sleep/reconnect; delayed samples cannot move live time backward. Canonical terminal time wins. Keep samples in bounded detail cache, out of summaries/wire fields/storage/events.

Only visible active headers subscribe to Surface's existing one-second clock. Offscreen/hidden/disconnected/terminal headers unsubscribe. Ticks change only the time label, never projections/counts/folding/network demand. Reconnect pauses ticking until existing transport confirmation; add no poll/request/payload/write.

## Outcome
Terminal labels use 13px/20px text and decorative 16px Floe warning/circled-stop/circled-alert for failure/cancel/interruption. Quiet color, first-row wrap alignment and localized labels preserve accessibility; diagnostics/recovery receive no duplicate outcome labels.

# Boundaries

Disclosure is ephemeral. User/final rows retain order and mounts. Settled answers retain canonical turn ownership across runs, become inert while folded, and reopen completely. Summaries/network events cannot hide pending controls.

# Evidence

- `redeven:go.mod` - Source.
- `redeven:internal/ai/flower_current_projection_test.go` - Tests.
- `redeven:internal/flower_ui/src/runtimeCurrentView.ts` - Source.
- `redeven:internal/flower_ui/src/flowerTurnPresentation.test.ts` - Tests.
- [Surface regressions](../../internal/envapp/ui_src/src/ui/FlowerSurface.turnProcess.browser.test.tsx): pre-output headers, waits/reconnect/offscreen clock bounds without extra reads; minute/hour transitions at 320/390/1280px; real-tail/answer visibility, repeated folds, reduced motion, growth/navigation/paging, focus/selection/nested choices, continuation Goals/prose and prepended header identity. Historical-copy qualification retains one opening read, no idle traversal and complete statistics after explicit expansion/paging.
- [Header](../../internal/flower_ui/src/FlowerTurnHeader.tsx), [clock tests](../../internal/flower_ui/src/flowerTurnClock.test.ts), [browser tests](../../internal/envapp/ui_src/src/ui/FlowerTurnHeader.browser.test.tsx): bounded subscriptions/geometry; reproduce prior text-node blank restart, retain readable single-node fast completion at all three widths, prevent timer/disclosure replay, clean animations and keep restored history static. Surface tests retain subsecond answers/focus/scroll/disclosure.

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.turnProcess.browser.test.tsx` - Tests.
