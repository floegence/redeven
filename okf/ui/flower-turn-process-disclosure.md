---
type: UI Contract
title: Flower terminal turn process disclosure
tags: [ui, flower, turns, disclosure, accessibility]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Floret owns turn outcome/timing. Terminal ordinary turns fold eligible process rows once, while pending controls, uncertain effects and inspected work stay visible. Explicit choices persist; user messages/finals remain mounted. Settled question/answer receipts fold with the process and reopen with complete content.

# Contract

## Facts and eligibility
Validated turn facts carry exact TurnID/RunID, optional control kind, start/end/outcome, work/wait/elapsed time, ordered intermediate/final IDs and complete-final boundary. Summaries cannot author these facts or trigger folds; unknown prose stays visible. Typed structure determines eligibility, never prompt/time heuristics.

A thinking-only process retains its disclosure/timing without a second duration summary/divider. Other summaries show at most two nonzero units and subsecond copy. Interleaved answers default open with a whole-turn toggle; settled question/answer receipts fold with process rows and retain nested choices. Receipt decoration lives inside the viewport, leaving no folded gap/rail. Counts require complete boundaries, membership and event coverage; otherwise show canonical work duration only. [Sequences](flower-tool-sequences.md) fold settled work independently on either side.

## Disclosure ownership
Running/preparing/retrying/finalizing/waiting turns reserve inaccessible header space. Exact outcome/end enables the toggle and one automatic fold of confirmed intermediate/process rows, including latest failed/canceled/interrupted turns. Final/trailing partial output stays visible.

Focus, selection, gestures, open details/thinking and away-from-tail reading protect inspected work; later observations cannot undo protection. Capture an unaffected visible anchor only when automatic folding begins. Explicit choices survive paging/reconnect/regrouping; newly classified inspected rows remain until the next explicit toggle without reopening siblings. Only disclosure/navigation opens a closed group. Retained folded bodies are inert and preserve offsets/choices. Main/embedded/child views share rendering with independent scroll owners.

## Placement and motion
The header precedes the first loaded response after the request, independent of fold membership. Canonical intermediate membership spans same-turn executions; engine owns supersession. In-turn Goals retain ownership; final boundaries stay run-scoped. Retained prefixes preserve confirmed intermediate facts; incoming windows replace overlapping classification. Partial windows never fetch earlier history just for presentation. Prepending the actual beginning moves header while preserving choice/focus; disclosure state is independent of anchor visibility.

Reserve header geometry before eligibility so the toggle adds no space or width change. Following folds align the real bottom before paint; no stale absolute offset, synthetic trailing space or competing growth animation. Long-to-short content settles at zero with final visible. Existing finals stay mounted during 260 ms fold; reduced motion settles immediately. Paused reading/manual actions retain anchors and necessary temporary insertion room, excluded from distance-to-latest. Input immediately cancels following; motion settlement cannot reclaim it.

If prose waits for a sequence when the turn ends, the outer row owns motion and releases prose afterward. Nested geometry stays intact; interrupted inner folds transfer painted opacity/transform. Manual reversal retains choice and motion preference. Canonical Path, not timestamps, orders dialogue/receipts; preserve final segments and secret redaction.

## Outcome presentation
Terminal labels use 13px/20px text and decorative 16px Floe warning, circled-stop or circled-alert icons for failure, cancellation or interruption. Quiet label color, first-row wrap alignment and localized status retain accessibility. Existing current-run diagnostics/recovery do not acquire duplicate outcome labels.

# Boundaries

Disclosure is ephemeral UI state. Ordinary user messages and final content stay mounted and ordered. Settled question/answer receipts retain canonical turn ownership across continuation runs and become inert while folded; expansion restores their full content. Summaries and network events cannot hide pending controls.

# Evidence

Browser regressions cover reserved running headers, frame-by-frame real-tail alignment and answer visibility, large and repeated folds, narrow viewports, reduced motion, subsequent growth, explicit navigation, short-history pagination, focus, selection and nested choices in main/child views. Continuation cases retain old-run prose and Goal; history prepends retain header focus and disclosure state. Existing isolated historical-copy qualification covers one opening read, no idle traversal, and complete statistics after explicit sequence expansion and progressive paging.

- `redeven:go.mod` - Published Floret dependency.

- `redeven:internal/ai/flower_current_projection_test.go` - Canonical historical turn facts preserved.

- `redeven:internal/flower_ui/src/runtimeCurrentView.ts` - Validates and maps current turn facts.
- `redeven:internal/flower_ui/src/flowerTurnPresentation.test.ts` - Settled input folds across continuations; active/pending state and defaults persist.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.turnProcess.browser.test.tsx` - Folded receipts, restored answers/choices/checkpoints and thinking/turn motion.
