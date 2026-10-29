---
type: Qualification Evidence
title: Flower live queue CPU qualification
tags: [flower, performance, streaming, qualification]
lifecycle: active_evidence
reviewed_at: "2026-10-26"
---
# Summary

Ordered queues defer full-history snapshots; global facts and bounded root/child reading have separate owners. Local read failure preserves content/drafts without reconnecting. [Live-state contract](../ui/flower-live-timeline.md) remains authoritative.

# Contract

Isolated Service/fake providers emit Markdown/Unicode/reasoning/tools at40Hz on Apple M5 Pro (18 cores/64GiB), macOS arm64, Go1.27.3/Node26.7.0, published Floret/GOWORK=off. CPU is process time (100%=one core), combined includes Electron; allocations are cumulative. Current SSE uses published parser/product headers/framing; payload excludes framing/encryption. Older NDJSON retains its scope.

Build qualify_flower_cpu.mjs --build --dist=<ui> and TestFlowerCPUQualification against frozen backend. Fresh REDEVEN_CPU_QUALIFICATION=1/STATE/DIST/HISTORY_TURNS (520 comparison,100 recovery); CHILD_DETAIL=1 adds child. Run --fixture=<state>/fixture.json --seconds=60 --warmup=10 --threads=1 --hz=40 --candidate-gates --output=<sample>.json; child adds --subagent --full-cache, idle --idle --seconds=30, older comparison120s. Retain raw hashes/failures, exact canonical/rendered prose/reasoning/code, ≥95% cadence/markers and cleanup of owned processes/subscribers/queues. Never relax gates.

# Boundaries

Older comparison predates paging. Recovery and520-turn results have different workloads; neither proves arbitrary-content bounds/encrypted performance/30-minute stability. Separate soak evidence has its own scope.

# Evidence

## October22: queues

v7.78.2,520 turns/2080 items, fresh forks, three alternating120s samples/side,10s warmup. Reference40c924749; both UI7e14ee68d.

| Median | Reference | Candidate | Reduction |
| --- | ---: | ---: | ---: |
| Backend CPU | 90.31% | 6.39% | 92.9% |
| Renderer CPU | 163.10% | 52.26% | 68.0% |
| Combined CPU | 257.62% | 67.89% | 73.6% |
| Payload bytes/s | 11,621,515 | 180,390 | 98.4% |
| Allocation bytes/s | 677,006,967 | 52,148,838 | 92.3% |
| Output P95 ms | 1459 | 49 | 96.6% |
| Frame P95 ms | 549.2 | 17.5 | 96.8% |

Candidates retain28 items/100% markers/24 input-click probes/no timeout. Reference timeouts35/35/31; sample1 fails content,2/3 fail interaction. Candidates pass relative CPU≥50%/payload≥90%, interaction-output≤100ms/frame≤33ms P95; fail renderer≤20%, combined≤60%, every-task<100ms (576–618ms). Three-thread30s: exact content, input/click/output28.5/31/53ms, frame17.5ms, Stop44.5ms, clean queues/subscribers.

## October23: recovery

v7.80.3-0.20261023160735-6389f55946e3 treats empty Goals as absent; upstream full/history/blank-module/Actions pass.100 turns,10s warmup/60s40Hz; child first visits11 roots/full cache. No overlapping owned builds/tests.

| Sample | Backend/renderer/combined CPU | Input/click/output P95 ms | Frame P95 ms |
| --- | --- | --- | ---: |
| Root | 5.30/18.45/33.37% | 11.6/14.9/38 | 17.3 |
| Child/cache | 7.93/19.41/37.38% | 11.2/15.2/44 | 17.6 |

Pass backend≤30%, renderer≤20%, combined≤60%, input/click/output≤100ms/frame≤20ms P95, every-task<100ms; exact content/cadence/markers, no long tasks/sync/page errors. Idle30s CPU0/0.38/0.79% (≤3%). Three-thread and1MiB30s stress: combined47.86/44.87%, output38/39ms, exact content/cadence/markers/no long tasks/clean release. Large text is stress, not standard-budget proof.

Earlier child20.34% fails before synchronous style-read removal. CSS currentColor and nine browser checks preserve theme/continuity/selection/cleanup. Child cursor tracks independently;130 browser/98 Desktop route/type/lint/race checks cover recovery/interests/Retry/drafts/commands/approval/Computer.

## October25: lifecycle

v7.87.0,100 turns,40Hz,10s warmup/60s, published SSE/product framing, no overlapping owned tests.

| Sample | Backend/renderer/combined | Input/click/output/Stop P95 ms | Frame ms |
| --- | --- | --- | ---: |
| Initial CPU failure | 4.78/20.27/37.88% | 12.4/15.3/46/12.5 | 18.2 |
| Controlled repeat | 4.61/19.89/37.22% | 12.2/16/47/16.6 | 18.4 |

Both retained; renderer20% limit unchanged with little repeat margin.100% markers/exact Markdown/code/reasoning/no long tasks/page exceptions. Each has two live→sealed HTTP500s before convergence, not zero-error evidence.

Earlier NDJSON30-minute attempt fails cycle30: subscription survives1s disposal (first29 are not pass). Raw Chromium fetch/abort reproduces; headers alone prove no fix. Actual parser120 mount/dispose cycles release<1s, not soak proof. Subsequent SSE1800s/30cycles passes: late/early renderer/runtime heap+6.71/+2.44%, app/runtime CPU+4.14/+1.60%, DOM+0.32%,131 listeners,max19 goroutines. Each cycle preserves exact content/draft/reopen, one mounted subscription, zero disposal queues/subscriptions, no page/convergence errors. Fixed workload cannot bound arbitrary Markdown/terminal memory.

## October26: presentation

Eight8s minified Chromium/Electron samples,72/500 messages,20/100 tools,30/60Hz: frame16.7–17.6ms,click26.0–31.7ms, no long tasks/protected DOM changes/skeleton flashes; selection/drafts,72 baseline/three recovery counts/output-progress retained. Synthetic short evidence is not production CPU/soak. Git supplies reference including deleted modules with equal minification/geometry.

Referencefa3a56ca0: task CPU-32.4–55.4%, allocation-72.2–85.0%.500-message60Hz reference delivers~282KiB vs508–513KiB from timer lag, so not equal-work CPU; other pairs comparable. Twenty appends scan neither100 nor10,000 historic ordinals; no durable index/schema, canonical reads remain bounded.

Sources: [queue](../../internal/ai/flower_live_stream.go), [pressure](../../internal/ai/flower_live_incremental_pressure_test.go), [backpressure](../../internal/ai/flower_live_backpressure_test.go), [reading/release](../../internal/ai/flower_history_test.go), [baseline](../../internal/ai/flower_live_baseline_test.go), [fixture](../../internal/ai/flower_cpu_qualification_test.go), [qualifier](../../scripts/qualify_flower_cpu.mjs).
