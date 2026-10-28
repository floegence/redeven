---
type: Qualification Evidence
title: Flower conversation switch performance qualification
description: Reproduce point-read scaling, bounded read recovery and actual sidebar presentation with synthetic data.
tags: [flower, performance, qualification, navigation]
timestamp: 2026-10-19T00:00:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-28"
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

## Scope

All timings below are local sequential diagnostics, not population P95, arbitrary-upgrade bounds or universal smooth-frame guarantees. Historical copies are isolated and consistent; execution is deferred, source databases remain untouched, and private text is not committed. Preserve failed samples alongside passing runs. Browser/backend/render timings have separate scopes.

## Stable running-thread entry — 2026-10-28

- Baseline `3108347bf` exposes stale cached rows: a completed sequence shrinks from 64 to 32 px and unseen titles replay. Delayed warm-entry fixtures cover ordinary and observer-bound history, manual disclosure, completed turns, narrow reduced-motion companion, child reopen, reconnect, reselection, stale A/B/A reads, user reading and refresh failure/retry. Forty sampled entry frames retain one exposed height and no restored title/fold animation; post-ready live titles still animate. Each warm fixture uses exactly two bounded reads.
- Current recovery suites pass 88 cases; disclosure/cache/loader/queue/scroll units pass 176. The earlier twelve-suite browser run passes 423/428: three child-loading expectations are updated and pass in the recovery rerun; two companion settings-recovery geometry failures reproduce on the baseline and remain unqualified. Tool sequencing and streaming pass independently. Both host typechecks and lint pass.
- Paired production Chromium/Electron profiles use 72/500 messages, 20/100 tools, 30/60 Hz and toggled disclosure (eight runs per revision). Candidate frame P95 is 16.8–17.6 ms and click P95 29.1–34.0 ms; no streaming long tasks, protected-DOM changes, continuity flashes or detail reads. Paired renderer CPU changes range from -12.7% to +1.1%, layout from -13.2% to +1.5%, sampled allocation from -2.5% to +3.6%. These single-run local samples show no material rendering regression, not population guarantees; baseline's first Electron click sample is 135 ms and is retained. Both owned process cleanups pass.

## Bounded statistics and reading — 2026-10-27

- Production HTTP historical-copy open: 685.2 ms; one 92,602-byte response; 90 opening frames retain the same tail with zero displacement. Sixty bidirectional wheel gestures advance canonical history; eight idle checkpoints add no requests. Exact command/output and disclosure survive scrolling. Opening includes an 85 ms long task.
- Synthetic 680-call turn opens with one bounded request and generic count label. Explicit scrolling completes statistics without losing manual disclosure, focus or selection. Dense parent-event alignment reads one page instead of nineteen; incomplete receipts withhold counts. Statistics never read history/bodies.
- Sixteen production Chromium/Electron profiles: closed/toggled disclosure, 72/500 messages, 20/100 tools, 30/60 Hz. Frame P95 ≤17.7 ms, click P95 ≤33 ms; no streaming long tasks or continuity flashes. Closed groups acquire no details or hidden bodies.

## Immediate send — 2026-10-26

Ten browser suites pass 184 cases: delivery, continuous history, disclosure, tools, feedback, streaming, attachments, references, synchronization recovery and thinking hydration. A 1,000-row blocked-storage/HTTP fixture shows pending input by the next frame within 100 ms with stable historical nodes. Combined history/preparation/recovery tests pass 64 cases after integration.

Receipt-first/live-first admission retains the user row through prepend; image handoff keeps image/text DOM within 1 px and loads the admitted image. A 680-call turn retains exact disclosed content, keyboard/wheel behavior and settled first-frame geometry. Failure/retry/reload preserve immutable submissions and newer drafts.

Two fresh 5.6 GiB copies, checksummed Floret v7.87.3/public APIs/blocking factory:

| Measurement | Copy 1 | Copy 2 |
| --- | ---: | ---: |
| Open, ms | 9.0 | 13.3 |
| Initial 24-item window, ms | 265.0 | 358.7 |
| Cold SendAck, ms | 4099.6 | 4203.5 |
| Queued Ack, ms | 59.6 | 47.9 |

Cold Ack: 207-byte internal command JSON, about 475 MB cumulative allocation (neither HTTP bytes nor RSS). Earlier v7.87.1: 6329 ms/1.10 GB. Restart replay: 0.49 ms, no new active execution. All close cleanly with zero provider/tool calls. Cold admission still scales with historical metadata; immediate feedback is not immediate provider dispatch. No schema/index added; duplicate post-admission product reads/writes removed. Upstream full Go, repeated admission/shutdown race, released-writer and blank-module candidate/published gates pass.

Product backend, 155 focused draft/navigation/attachment/adapter tests, typecheck, lint and initial bundle budgets pass. Full UI retains **17 pre-existing failures across seven files**, reproduced identically on clean main and feature, plus the semantic theme-color guard failure. None is suppressed or counted as passing.

## Deep scrolling — 2026-10-25

A 2,945-item copy reproduces HTTP 400 at 9,129 request bytes; published-writer regression produces 10,289. After repair, Electron 42.11.16 reaches ordinal 1 and returns in 160 wheel gestures; eighteen idle checks add no requests. Largest request/response: 11,839/487,446 bytes. Prepared-copy open: 352.8 ms; no page/transport errors or owned leftovers.

## Destination geometry — 2026-10-23

- Dev 319e7d3b1 reveals height 1156 then expands to 1703; mixed-history regression reproduces 1424 px bottom error. Before-paint resize correction, rAF reveal/body work and cancelled arrival motion resolve the sampled geometry. Two/24-row browser cases cover cold/cached exposure. Electron 42.11.9, three runs: exposure 26.8–38.2 ms, bottom error ≤0.5 px, expansion displacement <0.15 px; no errors/leftovers.
- Paired Chromium: twenty items, detail/body delay 220/160 ms. Baseline a6f63f972 reads bodies 15–19, shows placeholders at 300.0 ms and changes height three times. Candidate prioritizes 19/18 and reveals completed viewport. Requests 5→2; readable destination 799.7→437.3 ms. Warm long/body presentation 72.0/93.3→38.5/51.4 ms without more reads. Both are bottom-aligned in after-frame samples; this does not prove universal baseline top flashes.
- Cached Electron navigation: 21.1–32.1 ms, no preparing frame, ≤0.5 px bottom distance, no errors/owned processes. Browser coverage includes stale/delayed/empty/failing detail, local Retry, explicit input, warm reuse and bounded demand. Scroll units coalesce 300 notifications and stop idle work. Legacy disclosure fixtures fail readiness on baseline and candidate; temporary matching ready envelopes retain eight failures/six passes. Temporary edits were removed; these are not passing evidence. Current streaming passes independently.

## Unopened tools and transport

A 300-history/two-active-call fixture initially mounts only two activity rows; folded arrival expands to all 303, preserving inspected DOM through fold/reopen. Streaming retains selection, focus, readers and observers.

Production Chromium: 355 sidebar rows, 2,000 calls/twenty prose-separated groups, eight selections per variant. Seven warm medians (cold reported separately): 511.8→379.3 ms, activity rows 2,000→100, DOM elements 57,320→30,720, longest task 277→142 ms. Backend/network excluded; row shells and canonical content remain complete.

Synthetic 180-call UTF-8 fixture: response 2,015,243→136,355 bytes (-93.2%); all 182 items reachable with exact Unicode expansion and no full View during page/body reads. Authorization, cancellation, superseded interests, pressure, revisions, background facts, disclosure and Retry are covered. Historical copy: full detail 11,058,337 bytes; first page 183,597 (-98.34%); twenty pages cover 2,945 items once. Cold init/read 5.159 s, warm bounded read 4.939 ms. Baseline disclosure/scroll failures remain recorded separately.

## Responsive runtime — 2026-10-25

Three fresh backend/Electron runs on a prepared copy: click-to-readable/composer 973.9/260.0/240.7 ms, all below 1,000 ms. Ninety stable frames, exact drafts, scrolling/disclosure and no page/transport errors. Initial response 91,044 versus 192,218 bytes (-52.6%). Construction, launch and interaction are separate measurements.

After published SSE parser alignment: 571.7/609.2/250.0 ms under the same gate and checks. Startup polling 102.6/102.3/102.8 ms is not constructor time. Blocked-migration tests prove service availability before global preparation. Hidden activity details prepare on disclosure; cold access can still parse one entire selected activity. Active Markdown, selection and terminals are not capped by inactive-cache budgets.

Floret metadata tests: seven summary records for either twenty or 180 large structured rows; disclosure prepares 210/1,810 fields, unchanged by reopen/summary reads. Full-locator byte budgets: 91,073/1,160,931 and 798,196/10,448,051 (7.84%/7.64%). These are metadata bytes, not WAL/disk amplification. Equal repeated single/batched SQLite puts change zero rows.

## Stable detail — 2026-10-26

- HTTP/Electron prepared-copy runs: 586.7/343.7 ms. The latter uses 25 up/25 down gestures, exact identities, ninety stationary opening frames and no added idle requests or HTTP/page errors. Final full-command check matches 703 authorized characters; an earlier run matches command/output 783/346 characters. All fourteen tools and manual disclosure survive scroll/reopen.
- Fresh backend restart: 534.0 ms under the same one-second gate, exact full command/fourteen members. One visibility-cancelled body read is separate; no other transport/page errors. Opaque digests match over 2,828,261 records/3,471,867,039 bytes including metadata.
- With Floret v7.87.1/patch titles: 675.8 ms, fifty up/fifty down gestures to ordinal one and back, ninety stable frames, twelve unchanged idle checks, exact disclosure, no page/transport errors. One 58 ms opening long task remains.
- Earlier candidate **fails** at 1,580.1 ms: 150-item completion discovers nine missing members. Adaptive reads start at sixteen and grow to 150 only as needed; first extra page 40,076 versus 238,048 bytes. Equal 150-item summaries: 459,662 versus 236,228 before canonical cost metadata. window_bytes retains the upstream budget and prevents membership overflow after compaction.
- Browser acceptance covers short collapsed tails, Latest, switching, complete groups, focus/selection and manual inspection. Twenty frames of delayed multichunk Markdown preserve table/list/code text, height and position from reveal. The historical-copy tail exceeds the viewport; short-tail evidence is synthetic.

Sources: [history tests](../../internal/ai/flower_history_test.go), [streaming](../../internal/envapp/ui_src/src/ui/FlowerSurface.streamingStability.browser.test.tsx), [sidebar](../ui/flower-thread-sidebar.md), [Desktop bridge](../desktop/desktop-runtime-bridge.md).
