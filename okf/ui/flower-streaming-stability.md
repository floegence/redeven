---
type: UI Contract
title: Flower streaming stability
tags: [flower, streaming, performance, interaction]
lifecycle: contract
reviewed_at: "2026-11-05"
---
# Summary

Indexed ThreadCache and published incremental Markdown apply actor-native changes only to affected text/DOM. Preserve history, code color, copy, focus, selection and disclosure. Semantic changes stay visible; malformed updates recover through the single live-state owner without suppressing output or adding lifecycle.

# Contract

## Incremental owners
Indexed records initialize from snapshots. Text/extent updates preserve window/turn/decoration identity;structural changes alone recompute membership. Argument previews touch one block,never completed tools. Validate counters/retire withdrawn attempts. Real removal restores adjacent action/composer focus unless navigation moved it.20appends over100/10000archived items must read zero historical ordinals.

Structural scans use immutable identity without opening retained proxies;rows keep reactive owners,not plain-snapshot getters. Prompt history observes user content/status only;Activity counts follow replaced blocks. Placement touches changed membership/registration,retaining borrowed DOM/focus/selection/prepend anchors. Tail inspection checks blockers without old-row geometry;immediate disclosure avoids unused measurements.

Reuse block classification while final/intermediate/live/outcome stays current;Computer candidates subscribe to relevant targets only. Observed wire window is distinct from retained reading document:wire-only changes cannot rebuild archive/rescan ordinals. Actual ownership/order/coverage/lifecycle publish atomically. Canonical order needs linear check;out-of-order receipts/decorations stable-sort with uncommitted tail intact. Compare unchanged source ranges before copying groups/partitions. Sparse keyed facts visit fewer source keys rather than broadcast absence;updates/removals synchronous. Regressions:2400rows/100partitions,reversed input/decorations,600sparse subscribers,600groups+append.

DOM mutation reads no offsets/extents. Nested-tail/disclosure joins existing before-paint pass;explicit reopen restores follow,transferred anchors retain offset. Capture native input offset before default action. Same-run snapshots retain presentation/equal collections;wire replacement cannot rebind every retained layout controller. New execution gets prefix-validated presentation. Content advances on text owner.

Measure history gaps after accepted membership in same batch while old DOM mounted;only removed interior rows contribute height,preserved/appended rows need no historical geometry. Keep gap/virtual anchors. Running turns cannot fold;inspect protection runs when eligible,retaining terminal focus/selection/manual choices. Row registration cannot enumerate unchanged groups.

Published createIncrementalMarkdownParser owns Marked/CJK/GFM:reset full baseline,append regions,finish complete correction. Changed snapshot resets;reuse only exact token identity/offsets,same-source metadata retains regions. Completion/collapse/replacement retains all authored blocks. [Code](flower-code-highlighting.md),[diagrams](markdown-diagrams.md),[media](flower-inline-media.md) keep separate ownership.

## Text/layout
New prose fades currentColor320ms through20fixed CSS highlights,no node splits/layout/delivery delay. History/corrections immediate,links/code/media keep ink. No stylesheet/computed-style/per-frame inline work. Bound32groups/owner,diff8192chars/128nodes per region;larger immediate. Completion settles;reset/dispose/hidden/reduced-motion/forced-colors clears. Hot drag/resize settles ink while text/selection/DOM stay live;only later arrivals animate. Historical/unsupported APIs schedule nothing.

Both hosts pin Tailwind's Lightning CSS optimizer to 1.33.0 through matching npm/pnpm overrides. Version 1.32.0 warns on valid `::highlight()` selectors. Keep all 20 phase colors through optimization and minification; do not suppress warnings or disable optimization. `scripts/flower_streaming_css.test.mjs` exercises each installed Tailwind plugin's optimizer in both modes; host gates select their own cases.

Cold sealed bodies stage across reconnect then reveal final geometry without height motion;sample table/code/list/text from first frame. Other prose stays incremental. Font completion/error listeners dispose,not detached ready promises. Companion reads latest relevant record/bounded Unicode tail. Measured offscreen sections retain DOM with content-visibility:auto/intrinsic height;near/live/focused/selected explicitly visible. Intersection controls measurement,never paint admission:scrollbar jump must paint before callback,including compositor/native-wheel blank-frame checks. Existing scroll owner corrects before paint.

## Queue/verification
One ordered queue applies reactive batches;cooperative4ms includes reactions,yields between envelopes,never preempts one. Catch inside batch to publish recovery before rethrow. Ready waits drain,other reads pause16frames/1MiB;epoch/failure/dispose releases/fences.

Coalesce contiguous one-item append only with exact thread/item/turn/run/reading revision/same attempt except time/monotonic progress. Keep semantic boundaries/clears,join once preserving UTF8/version;gap rejects pending batch/one sync error. Bounds64frames/4MiB/250ms or75ms hot interaction. Semantic timer may replace stalled rAF,never overtake growth. Accept one32MiB envelope+reserve with backpressure. Diagnostics timing/kind/structural counts only,including slowest envelope;no content. Copy success1.6s,denial never success.

Real-Service qualifier freezes history/cadence,measures Runtime/Electron CPU/allocation/wire/frame/input/click/output then verifies every prose/thinking item via actual disclosure against canonical content. [Long-thread](../operations/flower-long-thread-gate.md) owns sustained/floating acceptance;explicit suites outside unified gates. Synthetic post-timing mutation samples prove no provider/encryption/peak-memory guarantee.

Structured response_validation after response.completed retains arrived content with localized final-verification failure,collapsed copyable safe conflict details. Peer text stays literal,no automatic retry. Accepted source-only hosted-search variation creates no error card. Both hosts retain complete identical catalogs.

# Boundaries

Floret remains the runtime/persistence owner; Floe owns generic parsing; Redeven owns product projection and DOM adapters. Failures keep drafts and visible content usable, with explicit retry and navigation.

# Evidence

- [Indexed records](../../internal/flower_ui/src/runtimeThreadRecord.test.ts)
- [Streaming CSS optimizer regression](../../scripts/flower_streaming_css.test.mjs)
- FlowerSurface.contextErrors shared/browser and i18n tests cover completed-response feedback.
- [Streaming browser qualification](../../internal/envapp/ui_src/src/ui/FlowerSurface.streamingStability.browser.test.tsx) and [current acceptance](../operations/flower-long-thread-gate.md).
