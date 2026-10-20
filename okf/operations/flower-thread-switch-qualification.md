---
type: Qualification Evidence
title: Flower conversation switch performance qualification
description: Reproduce point-read scaling, bounded read recovery and actual sidebar presentation with synthetic data.
tags: [flower, performance, qualification, navigation]
timestamp: 2026-10-19T00:00:00Z
---
# Summary

Published Floret v7.69.1 owns canonical View and Summary. Redeven consumes a
point summary and coordinates ephemeral read demand through one loader. The
[sidebar contract](../ui/flower-thread-sidebar.md) and
[Desktop bridge](../desktop/desktop-runtime-bridge.md) own the behavior.
Qualification uses copied released-writer fixtures and synthetic conversations;
it never continues real user tasks. The short-detail P95 target is at least a
70% reduction, with warm selection synchronous P95 below 8 ms and actual
selection feedback presented before transcript commit. These checks are local
qualification, outside ordinary CI and hooks.

# Contract

## Measurement method

Use the same machine, published dependencies, synthetic dataset and build mode
for each comparison. Run Go with GOWORK=off. The paired backend benchmark uses
released Floret SQLite and fake providers, 25 or 200 roots with two turns each,
a fixed short target and 600 repeated text fragments in unrelated roots. It
alternates old/new order over 30 samples after warmup. The removed root-list
algorithm exists only as an explicit test reader; production has no fallback.
Both sides measure the complete GetFlowerThreadDetail path, including View,
authorized summary, child list and product mapping. The benchmark fails if the
short-target P95 reduction is below 70%.

The built-renderer sidebar qualification uses the locked Electron runtime. It
measures click handling, selection commit and content presentation, and checks
actual compositor trace screenshots before commit. Each selection has its own
trace because Chromium limits screenshot events per trace. The additional loopback
HTTP fixture measures response-header wait, body transfer, JSON parse and the
production runtime adapter mapping separately for 2/610 timeline items. Its
server returns seeded JSON without backend work, so those stages cannot be
added to the separate backend samples or treated as production TTFB. Twelve
rapid demand rounds include shared navigation/confirmation, merged revision
updates and abandoned reads; exact dispatch, completion and cancellation counts
must match. All measurements and owned-process cleanup appear in session
artifacts. Keep artifacts locally; never commit user databases or credentials.

# Boundaries

Measurements use synthetic conversations and copied released-writer fixtures.
They do not authorize continuing real user tasks or establish production latency.
Backend point-read timings and the loopback transport fixture are separate
experiments; their durations must not be added. Large-transcript layout retains
its own measured cost. These explicit qualification suites stay outside ordinary
CI and hooks.

# Evidence

## Recorded results

Apple M5 Pro, macOS arm64, Go 1.27.2, Node 26.7.0; synthetic paired samples:

| Roots / target | Before median / P95 ms | After median / P95 ms | P95 reduction |
| --- | --- | --- | --- |
| 25 / short | 6.182 / 8.619 | 0.161 / 0.286 | 96.67% |
| 200 / short | 52.250 / 78.140 | 0.339 / 1.138 | 98.54% |
| 25 / long | 5.759 / 7.777 | 0.212 / 0.416 | 94.65% |
| 200 / long | 63.810 / 82.920 | 0.550 / 1.232 | 98.51% |

The built Electron 41.10.7 / Chromium 146 qualification recorded synchronous
warm selection P95 2.0 ms across 16 measured selections after two warmups.
Actual screenshots confirm selection feedback precedes content commit, including
a 4,010-item target. Sixteen mixed-size switches recorded median/P95 elapsed
52.9/71.9 ms to feedback, 62.3/89.1 ms to commit start, 139.4/638.4 ms to commit,
and 269.8/1468.2 ms to content presentation. Large-transcript layout remains
visible in this last metric; point summaries do not eliminate its rendering cost.

Loopback short/long adapter mapping P95 was 0.2/2.0 ms; JSON parse P95 was
0.1/0.5 ms. Header wait P95 was 34.4/35.2 ms and body transfer P95 53.8/62.5 ms
in this instrumented Electron session. These are fixture transport timings,
not real-runtime latency. Rapid demand qualification recorded 72 demands,
48 HTTP dispatches, 24 coalesced demands, 12 transport cancellations and
36 completions. The session verified 64 pin operations, retained row/focus,
zero disabled or invalid rapid-operation frames, and complete process cleanup.

The original reported 1.2-1.4 second short read and 3.6 second long read belong
to a different real dataset. No claim converts those observations to the
synthetic after values. The structural no-root-list regression and paired
scaling comparison establish the removed unrelated-history work.

## Reproduction and regression

Run explicitly from the repository root:

- GOWORK=off go test ./internal/ai -count=1 -timeout=15m
- GOWORK=off go test ./internal/ai -run '^$' -bench BenchmarkFlowerThreadDetailPointRead -benchtime=1x -count=1 -timeout=10m
- python3 scripts/check_flower_storage_compatibility.py
- node scripts/check_flower_sidebar_responsiveness.mjs --output=/absolute/local/evidence-directory

The Go package includes all released historical writer upgrades, explicit
continuation, restart, Retry, Fork, tool exchanges and media authority. Focused
shared loader tests cover one drain, reentrant settlement, merged updates,
confirmation freshness, last-consumer cancellation, explicit retry and bounded
idle records. Browser regressions cover selection, queue operations, reference
preview closure, confirmed commands with failed synchronization, stale epochs,
provider recovery and attachment ownership. Desktop tests cover precise IPC
identity, sender/document isolation, preparation, response headers/body,
423 reauthorization, document teardown and cleanup. Run both UI typechecks and
lint, then the repository commit and exact-main integration gates. Rebase onto
latest main and qualify overlapping Goal, read-state and scroll behavior before
push. Private baseline frames are explicitly validated before shared-frame
assertions; tests never discard arbitrary frames to pass.

## Source evidence

- [Point summary regression](../../internal/ai/threads_list_summary_test.go)
- [Paired backend benchmark](../../internal/ai/thread_detail_performance_test.go)
- [Read demand tests](../../internal/flower_ui/src/threadDetailLoader.test.ts)
- [Renderer HTTP fixture](../../internal/flower_ui/testing/performance/detailReads.ts)
- [Sidebar qualification](../../scripts/check_flower_sidebar_responsiveness.mjs)
- [IPC owner tests](../../desktop/src/main/runtimeFlowerReadOwner.test.ts)
- [HTTP cancellation tests](../../desktop/src/main/runtimeFlowerHTTP.test.ts)
- [Historical acceptance contract](../ai/flower-upgrade-compatibility.md)
