---
type: Qualification Evidence
title: Flower live queue CPU qualification
description: Recorded source-volume and bounded reading recovery qualification.
tags: [flower, performance, streaming, qualification]
timestamp: 2026-10-22T00:00:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-25"
---
# Summary

Ordered queues avoid premature full-history snapshots. Global facts and bounded
root/child reading have separate owners. Local read failure preserves content
without reconnecting or replacing drafts; see the
[live-state contract](../ui/flower-live-timeline.md).

# Contract

Real isolated Services/fake providers emit Markdown, Unicode, reasoning and tools at
40 Hz; Apple M5 Pro (18 cores, 64 GiB), macOS arm64, Go 1.27.3, Node 26.7.0, published
Floret and GOWORK=off. CPU is process time (100% = one core); combined includes fixture
Electron processes. Current fixtures use the published SSE parser and product
framing/headers; payload counters exclude framing/encryption. Earlier NDJSON samples
retain their original transport scope. Allocations are cumulative.
Input/click/output/frame timing is followed by exact canonical/rendered prose,
reasoning and code inspection. Cadence/marker coverage must reach 95%; retain failures
before assertions and never relax gates.

Build `node scripts/qualify_flower_cpu.mjs --build --dist=<ui>` and compile
`TestFlowerCPUQualification` against the frozen backend. Start fresh state with
`REDEVEN_CPU_QUALIFICATION=1`, `REDEVEN_CPU_STATE`, `REDEVEN_CPU_DIST` and
`REDEVEN_CPU_HISTORY_TURNS` (520 for queue comparison, 100 for recovery).
Child fixtures add `REDEVEN_CPU_CHILD_DETAIL=1`. After seeding:

```sh
node scripts/qualify_flower_cpu.mjs --fixture=<state>/fixture.json --seconds=60 --warmup=10 --threads=1 --hz=40 --candidate-gates --output=<sample>.json
```

Use `--subagent --full-cache` for child, `--idle --seconds=30` for idle and 120 seconds
for the older comparison. Keep local raw evidence/hashes; quit only owned fixtures
and verify subscribers/queues/process cleanup.

# Boundaries

The older comparison predates window/body paging. Recovery bounds selected root/child
reads but neither experiment proves arbitrary-content CPU bounds, encrypted transport
performance or thirty-minute stability. Single 100-turn recovery samples cannot be
compared as medians with the older 520-turn workload.

# Evidence

## Queue comparison, 2026-10-22

Floret v7.78.2, 520 completed turns/2,080 items, fresh fork each run; three alternating
120-second samples per side, ten-second warmup. Reference queue `40c924749`; both
renderers include `7e14ee68d`, so only queue behavior differs.

| Median | Reference | Candidate | Reduction |
| --- | ---: | ---: | ---: |
| Backend CPU | 90.31% | 6.39% | 92.9% |
| Renderer CPU | 163.10% | 52.26% | 68.0% |
| Combined CPU | 257.62% | 67.89% | 73.6% |
| Payload bytes/s | 11,621,515 | 180,390 | 98.4% |
| Allocated bytes/s | 677,006,967 | 52,148,838 | 92.3% |
| Output P95 | 1,459 ms | 49 ms | 96.6% |
| Frame P95 | 549.2 ms | 17.5 ms | 96.8% |

Candidates retain all 28 items, cadence, 100% markers and 24 input/click probes without
timeout. References have 35/35/31 timeouts; reference 1 fails postmeasurement content
inspection, while 2/3 complete inspection but fail interaction assertions.
Candidates meet ≥50% relative CPU/≥90% payload reduction, interaction/output ≤100 ms
and frame ≤33 ms P95. Their 576–618 ms long tasks **fail** stricter renderer ≤20%,
combined ≤60% and every-task <100 ms budgets. Three-thread/30-second follow-up preserves
exact content: input/click/output P95 28.5/31/53 ms, frame 17.5 ms, Stop 44.5 ms,
no timeouts, zero subscribers/queue bytes after close.

## Reading recovery, 2026-10-23

Published `v7.80.3-0.20261023160735-6389f55946e3` treats empty Goals as absent; upstream
full/historical/blank-module gates and Actions passed. Root/child have 100 seed turns,
ten-second warmup, sixty-second 40 Hz measurement; child first visits eleven other
roots to fill cache. No task-owned builds/tests overlap timing.

| Scenario | Backend | Renderer | Combined | Input / click / output P95 | Frame P95 |
| --- | ---: | ---: | ---: | --- | ---: |
| Root | 5.30% | 18.45% | 33.37% | 11.6 / 14.9 / 38 ms | 17.3 ms |
| Child, full cache | 7.93% | 19.41% | 37.38% | 11.2 / 15.2 / 44 ms | 17.6 ms |

Both pass unchanged candidate gates: backend ≤30%, renderer ≤20%, combined ≤60%,
input/click/output ≤100 ms and frame ≤20 ms P95, every long task <100 ms. Exact
content, cadence and markers pass; no long tasks, sync errors or browser exceptions.
Idle/30 seconds: backend/renderer/combined 0/0.38/0.79%, within ≤3%.
Three-thread and 1 MiB-text/30-second stress retain exact content, cadence and markers;
combined 47.86/44.87%, output P95 38/39 ms, no long tasks. Large text is stress evidence,
not standard-budget acceptance. Subscribers/queued bytes return to zero.

Before removing synchronous animation-style reads, child renderer 20.34% fails.
CSS `currentColor` preserves theme; nine browser checks cover continuity, colors,
preferences, selection and cleanup. Child cursor follows child status even with idle
parent. Baseline progress, stale release, interests, recovery/Retry, drafts, historical
commands, approval and Computer evidence have 130 browser/98 Desktop route checks,
type/lint and race coverage.

- [Queue owner](../../internal/ai/flower_live_stream.go), [pressure](../../internal/ai/flower_live_incremental_pressure_test.go), [backpressure](../../internal/ai/flower_live_backpressure_test.go).
- [Reading/release](../../internal/ai/flower_history_test.go), [baseline cancellation](../../internal/ai/flower_live_baseline_test.go).
- [Service fixture](../../internal/ai/flower_cpu_qualification_test.go), [Electron qualifier](../../scripts/qualify_flower_cpu.mjs).
- [Interaction](../ui/flower-streaming-stability.md), [recovery](../ui/flower-failure-recovery.md).

## Responsive lifecycle qualification, 2026-10-25

Published Floret v7.87.0 and the current Flower UI were measured with 100 seed turns,
40 Hz mixed Markdown/reasoning/tool output, ten-second warmup and sixty-second
measurement. The fixture now uses the published `fetchServerSentEvents` parser and
product SSE framing/headers instead of its own NDJSON decoder. No task-owned build
or test overlapped either timed measurement.

| Sample | Backend | Renderer | Combined | Input / click / output / Stop P95 | Frame P95 |
| --- | ---: | ---: | ---: | --- | ---: |
| Initial, failed CPU gate | 4.78% | 20.27% | 37.88% | 12.4 / 15.3 / 46 / 12.5 ms | 18.2 ms |
| Controlled repeat, passed | 4.61% | 19.89% | 37.22% | 12.2 / 16 / 47 / 16.6 ms | 18.4 ms |

The unchanged renderer limit is 20%; both measurements remain evidence. The repeat
passes all candidate gates but has little renderer CPU margin. Both runs retained
100% foreground markers, exact canonical prose/reasoning, complete rendered Markdown
and code blocks, with no long tasks or page exceptions. Each recorded two fixture
HTTP 500 responses when a live body identity was superseded by its sealed identity;
exact content converged. These are not zero-transport-error measurements. Browser
regressions independently verify old-source cancellation and sealed-source reading.

An earlier NDJSON thirty-minute attempt failed disposal in its thirtieth cycle:
one uncancelled HTTP subscription remained after the one-second release deadline.
Its first 29 cycles are not a passing stability result. Raw Chromium fetch/abort
also reproduced retained requests; changing headers or SSE framing alone did not
establish a fix. The actual Flower component with the published SSE parser passed
120 isolated mount/dispose cycles, each releasing subscribers within one second.
That result establishes repeated disposal only, not thirty-minute stability.

The subsequent SSE run completed 1,800 seconds and all thirty cycles with the
unchanged gates. Late/early medians grew 6.71% for renderer heap, 2.44% for runtime
heap, 4.14% for app CPU and 1.60% for runtime CPU. DOM nodes grew 0.32%, listeners
stayed at 131 and maximum early/late runtime goroutines stayed at nineteen. Every
cycle preserved canonical text/reasoning and the visible final message, retained
the draft across close/reopen, and returned subscriptions and queued bytes to zero
after disposal. Each mounted surface owned one subscription. No page exceptions
or convergence errors occurred. This is fixed-workload lifecycle evidence, not an
arbitrary-content memory bound; active Markdown and terminal documents remain uncapped.
