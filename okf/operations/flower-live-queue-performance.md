---
type: Qualification Evidence
title: Flower live queue CPU qualification
tags: [flower, performance, streaming, qualification]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
---
# Summary

Ordered queues defer full-history snapshots; global facts and bounded root/child reading have separate owners. Local read failure preserves content/drafts without reconnecting. [Live-state contract](../ui/flower-live-timeline.md) remains authoritative.

# Contract

Isolated Service/fake providers emit Markdown/Unicode/reasoning/tools at40Hz on Apple M5 Pro (18 cores/64GiB), macOS arm64, Go1.27.3/Node26.7.0, published Floret/GOWORK=off. CPU is process time (100%=one core), combined includes Electron; allocations are cumulative. Current SSE uses published parser/product headers/framing; payload excludes framing/encryption. Older NDJSON retains its scope.

Build qualify_flower_cpu.mjs --build --dist=<ui> and TestFlowerCPUQualification against frozen backend. Fresh REDEVEN_CPU_QUALIFICATION=1/STATE/DIST/HISTORY_TURNS (520 comparison,100 recovery); CHILD_DETAIL=1 adds child. Run --fixture=<state>/fixture.json --seconds=60 --warmup=10 --threads=1 --hz=40 --candidate-gates --output=<sample>.json; child adds --subagent --full-cache, idle --idle --seconds=30, older comparison120s. Retain raw hashes/failures, exact canonical/rendered prose/reasoning/code, ≥95% cadence/markers and cleanup of owned processes/subscribers/queues. Never relax gates.

# Boundaries

Older comparison predates paging. Recovery and520-turn results have different workloads; neither proves arbitrary-content bounds/encrypted performance/30-minute stability. Separate soak evidence has its own scope.

# Evidence

October 22 v7.78.2,520turns/2080items, three alternating 120 s samples,10 s warmup, reference 40c924749/shared UI 7e14ee68d:median backend 90.31→6.39%, renderer 163.10→52.26%, combined 257.62→67.89%, payload 11621515→180390 B/s, allocation 677006967→52148838 B/s, output P95 1459→49 ms, frame 549.2→17.5 ms. Content/markers retained; reference timeouts 35/35/31. Relative gates pass; absolute renderer 20%/combined 60% and<100 ms tasks fail(576–618 ms). Three-thread 30 s preserves content/cleanup.

October 23 v7.80.3 pseudo-version 6389f55946e3,100turns/40 Hz/60 s:root CPU 5.30/18.45/33.37%, child 7.93/19.41/37.38%; output 38/44 ms, frame 17.3/17.6 ms. All fixed gates/content/markers/cleanup pass; idle combined 0.79%. Three-thread/1 MiB stresses pass their scope. Earlier child 20.34% fails before style-read removal; 130browser/98Desktop checks retain recovery/interaction.

October 25 v7.87.0 renderer 20.27% fails; controlled 19.89% passes with little margin. Both exact content/no long tasks retain two live→sealed HTTP 500 s. Initial NDJSON30min fails disposal cycle 30; raw fetch reproduces and 120 parser cycles are not soak proof. Later SSE1800 s/30cycles passes:heap+6.71/+2.44%, CPU+4.14/+1.60%, DOM+0.32%,131listeners, max 19goroutines; zero disposed queues/subscriptions. Fixed workload cannot bound arbitrary content.

October 26 eight 8 s Chromium/Electron samples,72/500messages,20/100tools,30/60 Hz:frame 16.7–17.6 ms, click 26–31.7 ms, no protected-DOM changes/flashes. Reference fa3a56ca0 CPU-32.4–55.4%, allocation-72.2–85%; 500-message 60 Hz baseline delivers~282 KiB versus 508–513 KiB, so CPU is not equal-work evidence. Twenty appends scan no 100/10000historic ordinals; no new schema/index.

Sources: [queue](../../internal/ai/flower_live_stream.go), [pressure](../../internal/ai/flower_live_incremental_pressure_test.go), [backpressure](../../internal/ai/flower_live_backpressure_test.go), [history](../../internal/ai/flower_history_test.go), [baseline](../../internal/ai/flower_live_baseline_test.go), [fixture](../../internal/ai/flower_cpu_qualification_test.go), [qualifier](../../scripts/qualify_flower_cpu.mjs). Git retains exact sample tables and adverse results.
