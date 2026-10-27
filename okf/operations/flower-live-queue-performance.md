---
type: Qualification Evidence
title: Flower live queue CPU qualification
description: Recorded source-volume and bounded reading recovery qualification.
tags: [flower, performance, streaming, qualification]
timestamp: 2026-10-22T00:00:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-26"
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

## Queue comparison — 2026-10-22

Floret v7.78.2, 520 turns/2,080 items, fresh fork per run; three alternating 120-second samples/side, ten-second warmup. Reference queue 40c924749; both renderers include 7e14ee68d.

| Median | Reference | Candidate | Reduction |
| --- | ---: | ---: | ---: |
| Backend CPU | 90.31% | 6.39% | 92.9% |
| Renderer CPU | 163.10% | 52.26% | 68.0% |
| Combined CPU | 257.62% | 67.89% | 73.6% |
| Payload bytes/s | 11,621,515 | 180,390 | 98.4% |
| Allocation bytes/s | 677,006,967 | 52,148,838 | 92.3% |
| Output P95 | 1,459 ms | 49 ms | 96.6% |
| Frame P95 | 549.2 ms | 17.5 ms | 96.8% |

Candidates retain 28 items, cadence, 100% markers and 24 input/click probes without timeout. Reference timeouts: 35/35/31; reference 1 fails content inspection, 2/3 pass content but fail interaction. Candidates pass ≥50% relative CPU/≥90% payload reduction, interaction/output ≤100 ms and frame ≤33 ms P95, but **fail** renderer ≤20%, combined ≤60% and every-task <100 ms (long tasks 576–618 ms). Three-thread/30-second follow-up: exact content, input/click/output P95 28.5/31/53 ms, frame 17.5 ms, Stop 44.5 ms, no timeout, zero subscribers/queued bytes after close.

## Reading recovery — 2026-10-23

Published v7.80.3-0.20261023160735-6389f55946e3 treats empty Goals as absent; upstream full/history/blank-module gates and Actions pass. Root/child: 100 seed turns, ten-second warmup, sixty seconds at 40 Hz. Child visits eleven roots to fill cache first. No task-owned build/test overlaps timing.

| Scenario | Backend | Renderer | Combined | Input/click/output P95, ms | Frame P95 |
| --- | ---: | ---: | ---: | --- | ---: |
| Root | 5.30% | 18.45% | 33.37% | 11.6/14.9/38 | 17.3 ms |
| Child/full cache | 7.93% | 19.41% | 37.38% | 11.2/15.2/44 | 17.6 ms |

Both pass backend≤30%, renderer≤20%, combined≤60%, input/click/output≤100 ms and frame≤20 ms P95, every task<100 ms. Exact content/cadence/markers pass; no long tasks, sync errors or browser exceptions. Idle/30s: CPU 0/0.38/0.79% (≤3%). Three-thread and 1 MiB/30s stress: combined 47.86/44.87%, output P95 38/39 ms, exact content/cadence/markers, no long tasks, zero subscribers/queues after release. Large text is stress evidence, not standard-budget qualification.

Earlier child renderer 20.34% **fails** before synchronous animation-style reads are removed. CSS currentColor preserves theme; nine browser checks cover continuity/colors/preferences/selection/cleanup. Child cursor follows child status independently of idle parent. Baseline/stale release/interests/Retry/drafts/commands/approval/Computer cases: 130 browser, 98 Desktop routes, type/lint and race coverage.

## Responsive lifecycle — 2026-10-25

Floret v7.87.0, current UI, 100 seed turns, mixed output at 40 Hz, 10s warmup/60s measurement. Published fetchServerSentEvents and product SSE framing replace NDJSON. No owned tests/builds overlap.

| Sample | Backend/renderer/combined | Input/click/output/Stop P95, ms | Frame P95 |
| --- | --- | --- | ---: |
| Initial, CPU fail | 4.78/20.27/37.88% | 12.4/15.3/46/12.5 | 18.2 ms |
| Controlled repeat, pass | 4.61/19.89/37.22% | 12.2/16/47/16.6 | 18.4 ms |

Unchanged renderer limit 20%; both retained, repeat has little margin. Both preserve 100% markers, exact prose/reasoning/rendered Markdown/code, no long tasks/page exceptions. Each records two HTTP 500s on live→sealed identity replacement before exact convergence; neither is zero-transport-error evidence. Separate browser regressions cover source cancellation/sealed reads.

Earlier NDJSON 30-minute attempt **fails** cycle 30 disposal: one subscription survives the one-second deadline. First 29 cycles are not a pass. Raw Chromium fetch/abort reproduces retention; header/framing changes alone prove no fix. Actual Flower/published parser passes 120 isolated mount/dispose cycles (<1s release), which alone is not 30-minute proof.

Subsequent SSE soak passes 1,800s/thirty cycles with unchanged gates. Late/early medians: renderer heap +6.71%, runtime heap +2.44%, app CPU +4.14%, runtime CPU +1.60%; DOM +0.32%, listeners 131, max early/late goroutines nineteen. Each cycle retains exact text/reasoning/final message and draft across reopen, one mounted subscription, zero queues/subscriptions after disposal; no page/convergence errors. This fixed workload does not bound arbitrary active Markdown/terminal memory.

## Incremental presentation — 2026-10-26

Eight eight-second minified production Chromium/Electron samples: 72/500 messages, 20/100 tools, 30/60 Hz. Frame P95 16.7–17.6 ms; click 26.0–31.7 ms; zero long tasks/protected DOM changes/skeleton flashes, retained selection/drafts, expected 72 baseline/three recovery counts, output-progress pass. Short synthetic acceptance is not production CPU/long-soak proof. Git supplies reference modules, including deleted files, under equal minification/geometry.

Reference fa3a56ca0: candidate task CPU -32.4–55.4%, sampled allocation -72.2–85.0%. At 500 messages/60 Hz, reference delivers ~282 KiB versus 508–513 KiB because its timer lags: throughput evidence, not equal-work CPU. Other pairs have comparable volume. Indexed-record regression: twenty appends visit neither 100 nor 10,000 historical ordinals; no durable index/schema; bounded canonical body/field reads remain.

Sources: [queue](../../internal/ai/flower_live_stream.go), [pressure](../../internal/ai/flower_live_incremental_pressure_test.go), [backpressure](../../internal/ai/flower_live_backpressure_test.go), [reading/release](../../internal/ai/flower_history_test.go), [baseline cancellation](../../internal/ai/flower_live_baseline_test.go), [fixture](../../internal/ai/flower_cpu_qualification_test.go), [qualifier](../../scripts/qualify_flower_cpu.mjs), [interaction](../ui/flower-streaming-stability.md), [recovery](../ui/flower-failure-recovery.md).
