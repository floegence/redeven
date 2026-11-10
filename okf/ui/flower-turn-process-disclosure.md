---
type: UI Contract
title: Flower turn status and process disclosure
tags: [ui, flower, turns, disclosure, accessibility]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Floret owns exact TurnID/RunID, optional control kind, lifecycle/timing, intermediate/final IDs and complete-final boundary. Typed structure alone permits folding; prompts/summaries/time heuristics do not.

# Contract

## Facts and eligibility
[Published turn kinds](../ai/flower-upgrade-compatibility.md#turn-kind-consumer-contract) distinguish host-work completion from user turns. Retain its answer/identity/timing through paging/observation. Diagnostics expose safe field/reason only. Unknown prose stays visible.

Headers show total elapsed including waits; terminal descriptions retain work/wait durations, <=two nonzero units and subsecond copy. Thinking-only work has its own disclosure, not whole-turn toggle. Interleaved answers default open. Settled questions/answers fold with process rows, preserving choices and viewport-contained decoration without rails/gaps. Counts require complete membership/events/boundaries; otherwise omit. [Sequences](flower-tool-sequences.md) fold independently on each side.

Historical failed/interrupted turns retain an inline details control after the
outcome label. It defaults closed and opens a keyboard-accessible dialog with
the localized summary, literal technical details and copy action. Opening or
closing it does not change timeline geometry. Diagnostics remain available
after continuation, navigation and restart. Current failure actions remain on
the current error card only; historical errors do not retry another turn. Turn metadata contains only failure availability; diagnostics load on explicit
opening with freshly authorized exact execution identity. Hosts
project Floret-owned failures through the same authorized presentation as the
current error and never persist a second error history.

## Ownership
Canonical admission shows a noninteractive header for preparing/running/retrying/finalizing/waiting before provider output. Politely announce status, never ticks. Exact terminal outcome/end permits toggle and one automatic process/intermediate fold, including latest failed/canceled/interrupted turns; final/trailing partial output stays.

Focus/selection/gestures/details/open thinking/away-tail reading permanently protect inspected work from automatic folding. Capture an unaffected anchor at fold start. Explicit choices survive paging/reconnect/regrouping; newly classified inspected rows remain until explicit toggle without opening siblings. Only disclosure/navigation reopens. Retained folded bodies are inert with offsets/choices intact. Main/embedded/child views share rendering, never scroll owners.

## Placement and motion
Place header after loaded request or before first loaded response independently of membership; retain both during arrival. Engine owns cross-run intermediate supersession; Goals are turn-owned, finals run-scoped. Confirmed prefix facts survive; overlapping windows replace classification. Partial presentation never fetches history. Prepending request moves header but preserves focus/choice.

One-line status/time/detail slots retain geometry, tabular digits and narrow overflow. Followed folds align actual bottom before paint without stale offsets/synthetic tail/competing motion; long-to-short ends at zero with final visible. Finals remain mounted during260ms fold; reduced motion is immediate. Paused/manual reading keeps anchors/insertion room excluded from Latest distance. User input cancels follow; settlement cannot reclaim it.

Fresh visible labels fade0.68→1/180ms, later labels0.88→1/160ms. Keep full label readable without clipping/blank/overlap/character queue. Fast completion joins current transition; one JSX text owner and at most one opacity animation survive wrapper→button. Accessibility/control/geometry update immediately; ticks never replay motion. History/restoration/reconnect/urgent/reduced-motion states are immediate. Hide/interaction settles motion.

Terminal outer folds own pending prose release/nested geometry, adopting interrupted inner painted opacity/transform. Manual reversal preserves preferences. Canonical Path, never timestamps, orders dialogue/receipts; retain final segments/redaction.

## Elapsed time
Current server samples establish monotonic browser anchors across waits/continuations. Without a sample show status only; wall/queue clocks grant no timing. New samples reanchor after sleep/reconnect without moving live time backward; canonical terminal time wins. Store only in bounded detail cache, not summaries/wire/storage/events.

Only visible active headers subscribe to existing one-second clock. Hidden/offscreen/disconnected/terminal headers unsubscribe. Ticks change time only, never projection/counts/folds/network. Reconnect waits for transport confirmation, without extra polling.

## Outcome
Use13px/20px labels and decorative16px Floe warning/circled-stop/circled-alert, quiet color and wrapped-first-row alignment. Keep localized accessibility; do not duplicate outcome in diagnostics/recovery.

# Boundaries

Disclosure is ephemeral. User/final rows keep order/mounts; settled answers retain ownership across runs and reopen fully. Summaries/events cannot hide pending controls.

# Evidence

flower_current_projection_test.go verifies facts. FlowerSurface.turnProcess.browser.test.tsx covers pre-output/waits/reconnect/offscreen clock,320/390/1280px timing, real-tail/final visibility, folds/motion/growth/paging/focus/choices/continuations and header identity. Historical-copy checks retain one opening read, no idle traversal and complete explicit expansion. FlowerTurnHeader.tsx, flowerTurnClock.test.ts and FlowerTurnHeader.browser.test.tsx verify bounded geometry/subscriptions, the prior blank-text restart, one readable fast-completion node, cleanup and static history.
