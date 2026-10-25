---
type: Qualification Evidence
title: Flower conversation switch performance qualification
description: Reproduce point-read scaling, bounded read recovery and actual sidebar presentation with synthetic data.
tags: [flower, performance, qualification, navigation]
timestamp: 2026-10-19T00:00:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-25"
---
# Summary

Published Floret v7.87.0 owns windows, bounded item-text reads, View and Summary. Redeven owns
bounded reads and presentation through the [sidebar](../ui/flower-thread-sidebar.md)
and [Desktop bridge](../desktop/desktop-runtime-bridge.md). Local qualification
targets >=70% lower short-detail P95, warm synchronous P95 <8 ms, and feedback
before commit. Fixtures never continue real user tasks.

# Contract

Use the same machine, published dependencies, synthetic data and build mode.
Point-read scaling requires ≥70% short-target P95 reduction; warm synchronous P95
is <8 ms and visible feedback precedes commit. Keep raw source identities/results
locally; never commit user databases/credentials or continue real tasks.

Root detail uses Floret window subscriptions; GET/PATCH, command receipts and root
observation share public projection. Child reads own an independent bounded interest.
Initial windows and explicit body requests bound transport, excluding metadata and
pending controls. Cold actor initialization may still read complete state; explicitly
expanded activities use selected values and bounded field ranges. Backend read and loopback/render timings are
separate measurements, never additive.

```sh
GOWORK=off go test ./internal/ai -count=1 -timeout=15m
GOWORK=off go test ./internal/ai -run '^$' -bench BenchmarkFlowerThreadDetailPointRead -benchtime=1x -count=1 -timeout=10m
python3 scripts/check_flower_storage_compatibility.py
```

Run focused `TestFlowerHistory`, ThreadCache/runtime record tests, history/streaming/
tool-sequence browser suites, both host typechecks and locale validation. Synthetic
and released-writer qualification stays outside ordinary CI/hooks. Private baseline
frames must validate before shared-frame assertions; do not discard arbitrary frames.

# Boundaries

These local sequential diagnostics identify specific costs, not population latency
or smooth-frame guarantees. Cold point reads exclude remote rendering. Retain baseline
failures and report their scope; passing focused suites cannot recertify other known
failing fixtures. Canonical history remains complete.

# Evidence

## Layout and destination exposure, 2026-10-23

Completed `content-visibility: auto` history above the current tail exposed wrong
geometry: dev `319e7d3b1` revealed height 1156 before expanding to 1703; the mixed-history
regression reproduced 1424 px bottom error. Resize delivery now positions before
paint; reveal/body work stays outside ResizeObserver to avoid loops, and navigation
cancels old arrival motion. Two/24-row browser cases cover cold/cached exposure and
actual tail coordinates; unit cases retain bounded scheduling, readers and cleanup.
Built Electron 42.11.9, three samples: 26.8–38.2 ms exposure, ≤0.5 px bottom error,
<0.15 px tail displacement during skipped-history expansion, no errors/owned leftovers.

Paired Chromium diagnostic: twenty historical items, 220 ms detail and 160 ms body
latency. Baseline `a6f63f972` read bodies 15–19 and showed placeholders at 300.0 ms,
then three height changes; candidate reads 19/18 first and reveals the completed
viewport. Body requests fall five → two; readable destination 799.7 → 437.3 ms.
Warm long/body presentation changes 72.0/93.3 → 38.5/51.4 ms without more reads.
This establishes premature reveal/hydration, not universal baseline top flash;
both variants are bottom-aligned in after-frame samples. Built Electron cached
navigation: 21.1–32.1 ms first destination frame, no preparing frame, ≤0.5 px bottom
distance, no page errors or owned processes.

Browser cases cover stale/delayed detail/bodies, empty/failing detail, local Retry,
explicit versus programmatic input, warm reuse and bounded requests. Scroll units
retain 300 notifications in one pass and idle stop. Legacy disclosure fixtures fail
initial readiness on both baseline/candidate; identical temporary ready envelopes
retain eight failures/six passes. Those edits were removed and are not passing
qualification; current streaming passes independently.

## Unopened tool content

A browser fixture starts 300 historical calls plus two active calls: only the two
activity rows mount. A folded arrival then expands to all 303; fold/reopen retains
inspected DOM identity. Streaming cases explicitly open outer sequences and retain
selection, focus, readers and observers.

Production Chromium, 355 sidebar rows, 2,000 calls in twenty prose-separated groups,
eight selections per variant: report cold separately. Seven warm medians change
511.8 → 379.3 ms, activity rows 2,000 → 100, DOM elements 57,320 → 30,720 and longest
task 277 → 142 ms. These sequential samples include scheduling/rendering but exclude
backend/network. Row shells and canonical contents remain complete.

## Bounded transport

A deterministic 180-call fixture with large UTF-8 tool output/final answer reduces
initial response 2,015,243 → 136,355 bytes (-93.2%). All 182 items remain reachable;
expansion reconstructs exact Unicode. The fixture rejects full View calls during
page/body reads. Regressions cover authorization, cancellation, superseded interests,
pressure recovery, append revision, background facts and retained disclosure/Retry.

An isolated consistent historical copy was inspected read-only through the published
runtime: full detail 11,058,337 bytes; first page 183,597 (-98.34%); twenty pages cover
2,945 items exactly once. Cold initialization/read is 5.159 s; warm bounded read
4.939 ms. Only aggregates are retained. Navigation tests reject stale completion;
existing disclosure/scroll failures reproduced on baseline remain separately recorded.

- [History contract tests](../../internal/ai/flower_history_test.go)
- [Streaming regressions](../../internal/envapp/ui_src/src/ui/FlowerSurface.streamingStability.browser.test.tsx)
- [Sidebar ownership](../ui/flower-thread-sidebar.md)
- [Desktop bridge](../desktop/desktop-runtime-bridge.md)

## Responsive runtime qualification, 2026-10-25

A consistent isolated historical copy, with execution deferred, passed three fresh
backend/Electron process runs after field-summary, pending-terminal and lifecycle fixes.
Trusted click to stable readable content plus usable composer: 626.2, 261.4 and
239.1 ms, all below the explicit 1,000 ms gate. Each run retained ninety stable
frames, exact typed drafts, scrolling and disclosure without page/transport errors.
Initial history response was 91,044 bytes versus the earlier 192,218-byte baseline
(52.6% smaller). These are three local samples with prepared historical state,
not a population P95 or an unprepared old-format upgrade bound. Service construction
is measured separately from click-to-interactive and process launch.

The deterministic blocked-migration test proves service availability before global
historical work completes. Large hidden activity details prepare only on explicit
access; cold first disclosure may still parse one complete selected activity.
Inactive cache budgets do not cap active Markdown documents, selected text or a
mounted live terminal. Exact content and explicit ownership remain mandatory.
