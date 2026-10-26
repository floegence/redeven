---
type: Qualification Evidence
title: Flower conversation switch performance qualification
description: Reproduce point-read scaling, bounded read recovery and actual sidebar presentation with synthetic data.
tags: [flower, performance, qualification, navigation]
timestamp: 2026-10-19T00:00:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-26"
---
# Summary

Published Floret v7.87.3 owns windows, bounded item-text reads, View and Summary. Redeven owns
bounded reads and presentation through the [sidebar](../ui/flower-thread-sidebar.md)
and [Desktop bridge](../desktop/desktop-runtime-bridge.md). Local qualification
targets >=70% lower short-detail P95, warm synchronous P95 <8 ms, and feedback
before commit. Fixtures never continue real user tasks.

# Contract

Use the same machine, published dependencies, synthetic data and build mode.
Point-read scaling requires ≥70% short-target P95 reduction; warm synchronous P95
is <8 ms and visible feedback precedes commit. Keep raw source identities/results
locally; never commit user databases/credentials or continue real tasks.

Root detail uses Floret window subscriptions. GET/PATCH and root observation share
public projection; send acknowledgments carry exact identities without a current
view. Child reads own an independent bounded interest.
Initial windows and explicit body requests bound transport, excluding metadata and
pending controls. Cold send admission reads bounded current facts but still scans
historical metadata; complete execution preparation follows admission. Explicitly
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

Deep-scroll qualification must cross the product HTTP decoder.
`TestServerFlowerHistoryScrollQualification` serves only an owned isolated copy with
execution deferred. `qualify_flower_thread_open.mjs --history-scroll-steps=80` checks
both directions, canonical progress, successful membership requests above 8 KiB,
and idle request stability after each ten gestures. The service-only fixture cannot
qualify HTTP request-size limits. Never commit its raw history or database.

# Boundaries

These local sequential diagnostics identify specific costs, not population latency
or smooth-frame guarantees. Cold point reads exclude remote rendering. Retain baseline
failures and report their scope; passing focused suites cannot recertify other known
failing fixtures. Canonical history remains complete.

# Evidence

## Immediate send and history continuity, 2026-10-26

The eight browser suites for transport delivery, continuous history, disclosure,
tool sequences, send feedback, streaming, composer attachments and canonical
references passed 168 cases together. An additional thousand-retained-row case
then passed with the 33-case transport suite: pending text appears by the next
animation frame within 100 ms while storage generation and HTTP remain blocked;
all historical message nodes retain identity. These are local browser acceptance
thresholds, not a production latency distribution.

Receipt-first and live-first tests preserve the user row through canonical
admission and history prepend. Image handoff retains the image lane and text DOM
with at most 1 px height change and loads the admitted image. Tool qualification
includes a complete 680-call turn, exact disclosed content, wheel/keyboard
interaction, disclosure ownership and settled first-frame history publication.
Failure/retry/reload cases retain immutable submissions and newer editor drafts.

Two fresh isolated copies of a 5.6 GiB historical store used the exact checksummed
v7.87.3 release, public APIs and a blocking factory: Open 9.0/13.3 ms, initial
24-item window 265.0/358.7 ms, cold SendAck 4099.6/4203.5 ms, and subsequent
queued Ack 59.6/47.9 ms. Cold Ack serialized to 207 bytes with about 475 MB
cumulative allocation; this is internal command JSON, not HTTP payload or RSS.
The earlier v7.87.1 cold-Ack diagnostic was 6329 ms and 1.10 GB cumulative
allocation. Samples identify costs, not p95 or identical-load guarantees. Restart
replay returned in 0.49 ms without a new active execution. Both samples and replay
closed cleanly with zero provider/tool calls. No source database was modified.

Cold admission remains proportional to historical metadata; immediate UI feedback
does not imply immediate provider dispatch. The optimization adds no storage schema
or index and removes duplicated post-admission product reads/writes. Floret
qualification includes the complete Go suite, repeated shutdown/admission race
tests, released-writer history and blank-module candidate/published adoption.

Product backend tests, 155 focused draft/navigation/attachment/adapter unit tests,
typechecking, lint and initial bundle budgets passed. Full UI qualification has
17 pre-existing unit failures: the clean main baseline and feature each reproduce
the identical 17 names across seven files. Both also fail the existing semantic
theme-color source guard. They are not passing evidence and were not suppressed.

## Deep history scrolling, 2026-10-25

An isolated 2,945-item historical copy reproduced HTTP 400 at a 9,129-byte
membership request. A published-writer regression produces 10,289 bytes. After
the request/metadata bounds and scroll-demand fixes, Electron 42.11.16 traversed
to ordinal 1 and back to the latest window in 160 wheel gestures. All eighteen
idle checks retained the same history-request count; no page/transport error or
owned process remained. Largest request/response: 11,839/487,446 bytes. Opening
took 352.8 ms on this prepared local copy. This is one diagnostic sample, not P95.

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
backend/Electron process runs after rebasing the field-summary, pending-terminal
and lifecycle fixes onto the latest gateway/startup changes. Trusted click to stable
readable content plus usable composer: 973.9, 260.0 and 240.7 ms, all below the
explicit 1,000 ms gate. Each run retained ninety stable
frames, exact typed drafts, scrolling and disclosure without page/transport errors.
Initial history response was 91,044 bytes versus the earlier 192,218-byte baseline
(52.6% smaller). These are three local samples with prepared historical state,
not a population P95 or an unprepared old-format upgrade bound. Service construction
is measured separately from click-to-interactive and process launch.

After aligning the qualification transport with the published SSE parser, three
additional fresh-process runs on the same isolated prepared copy measured 571.7,
609.2 and 250.0 ms click-to-interactive. All passed the unchanged 1,000 ms gate,
draft/scroll/disclosure checks and ninety stable frames without page or transport
errors. Fixture service startup polling measured 102.6/102.3/102.8 ms separately;
that polling interval is not a precise constructor duration.

The deterministic blocked-migration test proves service availability before global
historical work completes. Large hidden activity details prepare only on explicit
access; cold first disclosure may still parse one complete selected activity.
Inactive cache budgets do not cap active Markdown documents, selected text or a
mounted live terminal. Exact content and explicit ownership remain mandatory.

Published Floret storage regressions measured seven admitted activity-summary
records for both twenty and 180 large structured rows. Explicit disclosure then
prepared 210 and 1,810 field records respectively; reopen and summary reads left
those records unchanged. The independent full-locator byte budget measured
91,073 / 1,160,931 bytes for twenty rows and 798,196 / 10,448,051 bytes for 180 rows
(7.84% / 7.64%). These are metadata record bytes, not physical WAL or disk write
amplification. Repeated equal single/batched SQLite puts changed zero rows.


## Stable history and detail qualification, 2026-10-26

The isolated consistent historical copy passes the production HTTP/Electron qualifier
with execution deferred. Two sequential samples measure 586.7 and 343.7 ms from
trusted click to stable readable content and usable composer. The latter covers
25 upward plus 25 downward wheel gestures, exact canonical identity at every position,
no HTTP/page errors, ninety stationary opening frames, and no additional history
requests after each settled reading interval. Tool inspection in the final deep-scroll run matches the complete 703-character
command returned by the authorized reader. An earlier full-scroll run also matches
a 783-character command and 346-character output;
all fourteen tool rows and manual disclosure survive repeated scrolling and reopening.
No source text is committed as evidence. A fresh backend restart measures 534.0 ms
under the same one-second gate. The nested full-command disclosure exposes the
exact authorized command and retains all fourteen members through repeated scroll.
One visibility-cancelled body read is recorded separately; there are no page or
non-cancellation transport errors. A read-only opaque-record digest before and
after qualification matches across 2,828,261 records (3,471,867,039 bytes), including
metadata. Qualification does not alter canonical conversation records.
After integrating published Floret v7.87.1 and the patch-title changes, the same
qualifier passes in 675.8 ms with fifty upward and fifty downward wheel gestures,
reaching ordinal one and returning to the latest content. Ninety stable opening
frames, twelve unchanged idle-request checks and exact full-command disclosure pass.
No page or transport errors occur. Opening includes one 58 ms long task; this
evidence establishes stable presentation, not a claim of zero opening CPU stalls.

An earlier candidate fails the one-second opening gate at 1,580.1 ms because turn
boundary completion reads 150 items to discover nine missing members. The final
adaptive boundary read starts at sixteen and grows to 150 only as needed. Its first
extra page is 40,076 bytes rather than 238,048 bytes. The same 150-item summary
comparison is 459,662 versus 236,228 bytes before adding canonical cost metadata.
The optional window_bytes field preserves the upstream selection budget; exact
membership no longer overflows after summary compaction.

Browser acceptance additionally covers short collapsed tails, return-to-latest,
thread switching, complete groups, focus/selection and retained manual inspection.
A delayed multichunk historical Markdown test samples twenty displayed frames:
tables, lists, code text, row height and screen position are stable from first reveal.
The real copy's current tail is taller than the viewport, so short-tail coverage is
deterministic browser evidence rather than a claim about that real tail.
These are local prepared-store samples, not a universal latency guarantee or proof
that arbitrary legacy upgrades finish within one second.
