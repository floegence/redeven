---
type: Qualification Evidence
title: Flower live queue CPU qualification
description: Recorded source-volume and bounded reading recovery qualification.
tags: [flower, performance, streaming, qualification]
timestamp: 2026-10-22T00:00:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-23"
---
# Summary

Ordered queues avoid premature full-history snapshots. Global facts and bounded
root/child reading have separate owners. Local read failure preserves content
without reconnecting or replacing drafts; see the
[live-state contract](../ui/flower-live-timeline.md).

# Contract

## Method

Both use Apple M5 Pro (18 cores, 64 GiB), macOS arm64, Go 1.27.3, Node 26.7.0,
checksummed published Floret and GOWORK=off. Isolated real Services use synthetic
history and fake providers emitting Markdown, Unicode, reasoning and tools at
40 Hz; no user data or processes. CPU measures process time: 100% is one core;
combined includes backend and fixture Electron processes. Loopback NDJSON bytes
exclude encryption/framing; allocation is cumulative, not retained heap.

Timing includes native input/click, output and frame probes. Afterwards, actual
turn/process disclosures must match every canonical prose/reasoning item and code
block. Cadence and marker coverage must each reach 95%. Record failures before
assertions; never relax thresholds to admit a candidate.

## Queue comparison, 2026-10-22

Published Floret v7.78.2; 520 completed turns (2,080 items); fresh fork per run;
three alternating 120-second samples per side after ten seconds warmup. The
reference uses queue behavior from `40c924749`; both renderers include the streamed
list correction from `7e14ee68d`. Only queue behavior differs.

| Median | Reference | Candidate | Reduction |
| --- | ---: | ---: | ---: |
| Backend CPU | 90.31% | 6.39% | 92.9% |
| Renderer CPU | 163.10% | 52.26% | 68.0% |
| Combined CPU | 257.62% | 67.89% | 73.6% |
| Payload bytes/s | 11,621,515 | 180,390 | 98.4% |
| Allocated bytes/s | 677,006,967 | 52,148,838 | 92.3% |
| Output P95 | 1,459 ms | 49 ms | 96.6% |
| Frame P95 | 549.2 ms | 17.5 ms | 96.8% |

Each candidate renders all 28 items exactly, retains cadence and 100% markers,
and completes 24 input/click probes without timeouts. References have 35/35/31
interaction timeouts. Reference 1 times out during postmeasurement inspection:
timing remains valid, content qualification incomplete. References 2/3 complete
content inspection but fail interaction assertions.

All candidates pass relative CPU reduction >=50%, payload reduction >=90%,
interaction/output P95 <=100 ms and frame P95 <=33 ms. They retain 576–618 ms long
tasks and **fail** the stricter renderer <=20%, combined <=60% and every-long-task
<100 ms gates. This is a source-volume improvement, not an absolute-budget claim.
A separate three-thread 30-second run preserves all canonical content and exact
foreground rendering; input/click/output P95 28.5/31/53 ms, frame 17.5 ms, three Stop
probes P95 44.5 ms, no timeouts. Subscribers/queued bytes return to zero on close.

## Bounded reading recovery, 2026-10-23

Published Floret `v7.80.3-0.20261023160735-6389f55946e3` initializes empty Goals as
absent; upstream full tests, historical candidate/blank-module adoption and main
Actions pass. Each Service has 100 completed seed turns. Root/child samples use
ten seconds warmup and sixty measured seconds at 40 Hz; child first visits eleven
other roots to fill the cache. No task-owned build/test runs during timing. These
single samples are not comparable medians against the larger 2026-10-22 workload.

| Scenario | Backend | Renderer | Combined | Input / click / output P95 | Frame P95 |
| --- | ---: | ---: | ---: | --- | ---: |
| Root | 5.30% | 18.45% | 33.37% | 11.6 / 14.9 / 38 ms | 17.3 ms |
| Child, filled cache | 7.93% | 19.41% | 37.38% | 11.2 / 15.2 / 44 ms | 17.6 ms |

Both pass unchanged `--candidate-gates`: backend <=30%, renderer <=20%, combined
<=60%, input/click/output P95 <=100 ms, frame P95 <=20 ms, every long task <100 ms.
Cadence, markers and exact prose/reasoning/code pass; no long tasks, timeouts,
sync errors or browser exceptions.
Thirty-second idle: backend 0%, renderer 0.38%, combined 0.79%, passing <=3%.
Three-thread and 1 MiB-text 30-second runs also preserve exact content, cadence,
100% markers and responsiveness, with no long tasks. Combined CPU is 47.86% and
44.87%; output P95 38/39 ms. Large-text CPU is stress evidence, not a standard-budget
pass. Subscribers/queued bytes return to zero after close.
Before removing synchronous animation style reads, the child uses 20.34% renderer
CPU and fails. CSS `currentColor` retains theme behavior without those reads;
nine browser tests cover continuity, selection, colors, preferences and cleanup.
The child cursor follows child status even while its parent is idle.

## Reproduction

Build UI with `node scripts/qualify_flower_cpu.mjs --build --dist=<ui>`; compile
`TestFlowerCPUQualification` against the frozen backend. Start with
`REDEVEN_CPU_QUALIFICATION=1`, fresh `REDEVEN_CPU_STATE`, `REDEVEN_CPU_DIST` and
`REDEVEN_CPU_HISTORY_TURNS` (520 for the older comparison, 100 for recovery).
Add `REDEVEN_CPU_CHILD_DETAIL=1` for child fixtures. After seeding:

```sh
node scripts/qualify_flower_cpu.mjs --fixture=<state>/fixture.json   --seconds=60 --warmup=10 --threads=1 --hz=40 --candidate-gates --output=<sample>.json
```

Use `--subagent --full-cache` for child and `--idle --seconds=30` for idle.
Retain local raw evidence/hashes; stop owned fixtures and verify cleanup.

# Boundaries

The older comparison predates reading windows/body paging; recovery bounds
selected root/child reads. Neither proves arbitrary-content CPU bounds, encrypted
transport performance or thirty-minute stability. Preserve cadence, output and
gates; do not hide failures.

# Evidence

- [Queue and baseline ordering](../../internal/ai/flower_live_stream.go), [pressure tests](../../internal/ai/flower_live_incremental_pressure_test.go), [backpressure](../../internal/ai/flower_live_backpressure_test.go).
- [Root/child reading and release tests](../../internal/ai/flower_history_test.go), [baseline cancellation and progress](../../internal/ai/flower_live_baseline_test.go).
- [Real-Service fixture](../../internal/ai/flower_cpu_qualification_test.go), [Electron qualifier](../../scripts/qualify_flower_cpu.mjs).
- [Interaction and Markdown contract](../ui/flower-streaming-stability.md), [failure recovery](../ui/flower-failure-recovery.md).

Recovery checks cover baseline progress, stale releases, independent interests,
bounded automatic recovery, Retry, drafts, historical commands, approvals and
Computer evidence: 130 browser tests, 98 Desktop routes, type/lint and race checks.
