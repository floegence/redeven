---
type: Qualification Evidence
title: Flower live queue CPU qualification
description: Measure removal of premature historical snapshot amplification under mixed streaming output.
tags: [flower, performance, streaming, qualification]
timestamp: 2026-10-22T00:00:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

Nonmergeable but contiguous live updates remain ordered within the existing
queue and byte budgets. An item switch, semantic boundary, or full append
fragment alone no longer reads and retransmits the complete conversation.
The [live-state contract](../ui/flower-live-timeline.md) owns this behavior;
canonical state, authorization, initialization and genuine overload recovery
remain unchanged.

# Contract

## Measurement method

The 2026-10-22 comparison uses Apple M5 Pro (18 cores, 64 GiB RAM), macOS arm64,
Go 1.27.3, Node 26.7.0 and published Floret v7.78.2 with GOWORK=off. Each side
uses an isolated real Service, immutable synthetic seed of 520 completed turns
(2,080 canonical items), and a fresh fork for each run. The fake provider emits
mixed Markdown, Unicode, reasoning and tool exchanges at 40 updates/second.
Three 120-second samples per side follow ten seconds of warmup, in alternating
order. CPU uses cumulative process time; 100% means one fully used CPU core.
Combined CPU includes the backend and every fixture Electron process.

The reference backend uses the queue behavior from commit `40c924749`; the
candidate changes only that queue behavior. Both serve the same production
Flower renderer with the streamed-list correction from `7e14ee68d`. No user
database, real provider, live task, or production process is used. The fixture
transports Flower envelopes through loopback NDJSON; payload counts exclude
encryption and network framing.

Full-content checks run after timing, open the actual turn and nested process
disclosures, and compare every generated assistant/reasoning item and code
block against canonical content. Input, click, frame and visible-output
measurements remain active throughout the timing window.

The relative acceptance checks require median combined CPU to fall by at least
50%, median payload bytes per second to fall by at least 90%, every candidate
run to retain at least 95% of the requested provider cadence and observed
output markers, input/click/output P95 at or below 100 ms and frame P95 at or
below 33 ms. Every candidate run must preserve complete canonical and rendered
content without interaction timeouts or synchronization errors.

## Recorded results

All three candidate samples passed the relative and responsiveness checks.
Values below are medians of the three samples; payload and allocation rates
are normalized by measured elapsed time. Allocation means cumulative allocated
bytes, not retained heap or a memory-leak measurement.

| Metric | Reference | Candidate | Reduction |
| --- | ---: | ---: | ---: |
| Backend CPU | 90.31% | 6.39% | 92.9% |
| Renderer CPU | 163.10% | 52.26% | 68.0% |
| Backend plus all Electron CPU | 257.62% | 67.89% | 73.6% |
| Logical payload bytes/second | 11,621,515 | 180,390 | 98.4% |
| Backend allocated bytes/second | 677,006,967 | 52,148,838 | 92.3% |
| Visible output P95 | 1,459 ms | 49 ms | 96.6% |
| Frame P95 | 549.2 ms | 17.5 ms | 96.8% |

| Sample | Reference combined CPU | Candidate combined CPU | Candidate input/click/output P95 |
| --- | ---: | ---: | --- |
| 1 | 257.62% | 71.83% | 23.7 / 24.3 / 49 ms |
| 2 | 259.40% | 66.75% | 16.7 / 21.7 / 50 ms |
| 3 | 257.62% | 67.89% | 23.1 / 17.5 / 46 ms |

Each candidate rendered all 28 generated assistant/reasoning items exactly,
including code blocks, and observed 100% of eligible output markers. All three
kept the requested 40 Hz cadence and completed 24 input plus 24 click probes
without timeouts. The references had 35, 35 and 31 interaction timeouts; their
few successful-event latency values are not representative responsiveness
metrics. Reference sample 1 exceeded the supervised session deadline during
postmeasurement content inspection; its complete timed CPU/payload sample is
retained, but that content check did not complete. Reference samples 2 and 3
completed content inspection and failed the interaction-timeout assertion.

The candidate still recorded isolated 576-618 ms long tasks. It did not meet
the stricter renderer <=20%, combined CPU <=60%, or every-long-task <100 ms
budgets; this result is not an absolute-budget or universally smooth-frame
claim. The measured source-volume fix materially improves the reproduced
workload while leaving renderer cost for separate profiling.

A separate 30-second candidate check with three concurrent 40 Hz conversations
passed full canonical content checks for all three and complete rendered-content
checks for the foreground conversation. Input/click/output P95 were
28.5/31/53 ms, frame P95 was 17.5 ms, and three Stop-control feedback probes
had P95 44.5 ms. No interaction timed out. This is a concurrent correctness
and responsiveness check, not a three-sample concurrent CPU comparison.
After closing each qualifier, subscribers and queued bytes returned to zero;
both isolated Service fixtures were then stopped gracefully.

## Reproduction

Build the production UI with `node scripts/qualify_flower_cpu.mjs --build
--dist=<isolated-ui-directory>`. Compile `TestFlowerCPUQualification` against
each frozen backend revision. Start it with `REDEVEN_CPU_QUALIFICATION=1`,
`REDEVEN_CPU_HISTORY_TURNS=520`, `REDEVEN_CPU_DIST=<isolated-ui-directory>` and
a fresh empty `REDEVEN_CPU_STATE` directory. Allow sufficient setup time for
the real persisted historical turns. For each ready fixture, run:

```sh
node scripts/qualify_flower_cpu.mjs --fixture=<state>/fixture.json \
  --seconds=120 --warmup=10 --threads=1 --hz=40 --output=<sample>.json
```

Keep raw outputs, binary/UI SHA-256 hashes and machine metadata locally. Stop
each task-owned fixture through its `quit` operation and verify process cleanup.

# Boundaries

This qualifies removal of premature snapshot amplification. It does not implement
window subscriptions or body paging. Real queue saturation and initialization
can still read a complete current view. The real-Service timing fixture has
2,080 historical items; the separate deterministic regression has 2,600.

The stricter existing `--candidate-gates` absolute renderer/combined CPU and
all-long-tasks-below-100-ms thresholds are separate from the relative comparison.
Remaining renderer work and isolated long tasks must be reported, not hidden
by disabling output, reducing provider cadence, enlarging buffers or weakening
those thresholds. Encrypted end-to-end transport and thirty-minute resource
stability are outside this qualification.

# Evidence

The full `internal/ai` Go suite, focused streaming race tests, HTTP stream
tests, 125 frontend record/cache/queue/adapter tests, two reactive identity
tests and 33 streaming/recovery browser tests passed. Browser coverage includes
reconnect continuity, pending approvals, keyboard Stop, drafts, drag ownership,
focus, selection, complete code copy and one-megabyte Unicode paragraphs.

- [Queue implementation](../../internal/ai/flower_live_stream.go)
- [Mixed semantic backlog, Unicode fragments and exact-route capacity recovery](../../internal/ai/flower_live_incremental_pressure_test.go)
- [Slow-consumer, initialization, version-gap and canonical recovery tests](../../internal/ai/flower_live_backpressure_test.go)
- [Real-Service fixture](../../internal/ai/flower_cpu_qualification_test.go)
- [Electron qualifier](../../scripts/qualify_flower_cpu.mjs)
- [Interaction and Markdown contracts](../ui/flower-streaming-stability.md)
