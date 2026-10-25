---
type: Qualification Evidence
title: Flower request-history CPU qualification
description: Qualify published execution-owned request facts and stable frontend observers under historical streaming workloads.
tags: [flower, performance, floret, history, qualification]
timestamp: 2026-10-22T00:00:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-25"
---
# Summary

Published Floret v7.79.0 reads canonical request facts once per Engine execution
and advances bounded state only after successful writes. Retry/restart reload
facts; historical render-lineage validation remains intact. Redeven stops sidebar
preview work at the latest useful content and retains unchanged sequence groups,
members and observers during streaming. Three real-Service/Electron samples
reduce median backend CPU 80.3%, combined CPU 53.9% and allocations 87.0%, while
preserving complete output, responsive controls, selection and manual reading.

# Contract

Floret owns canonical request preparation; Redeven consumes the published runtime
without sibling replacements or a second cache. No cadence reduction, dropped output,
history deletion or durable ledger is permitted. [Storage ownership](../ai/flower-storage-ownership-and-migrations.md)
and [streaming interaction](../ui/flower-streaming-stability.md) remain normative.

## Method and reproduction

Real Service/SQLite and production Electron use fake providers, 100 completed turns
(200 requests), 16,384-byte system prompt, mixed Markdown/Unicode/reasoning, tool
boundaries every 40 updates and 40 Hz output. Each fresh fixture warms ten seconds
and measures 120 seconds before exact canonical/rendered prose, reasoning and code
checks. Apple M5 Pro (18 cores/64 GiB), macOS arm64, Go 1.27.3, Node 26.7.0; CPU is
cumulative process time (100% = one core), combined includes all fixture Electron
processes, and allocations are cumulative bytes rather than retained heap.

The historical comparison retains its seed prompt scope. An ordinary fork creates
a new scope and cannot reproduce request-history amplification. Leave that override
unset for concurrency/lifecycle scenarios.

```sh
GOWORK=off go test -c ./internal/ai -o /tmp/flower-cpu-fixture.test
node scripts/qualify_flower_cpu.mjs --build --dist=<isolated-ui-directory>
REDEVEN_CPU_QUALIFICATION=1 REDEVEN_CPU_HISTORY_TURNS=100 \
REDEVEN_CPU_SYSTEM_PROMPT_BYTES=16384 REDEVEN_CPU_TOOL_EVERY=40 \
REDEVEN_CPU_RETAIN_SEED_SCOPE=1 REDEVEN_CPU_STATE=<fresh-empty-directory> \
REDEVEN_CPU_DIST=<isolated-ui-directory> \
/tmp/flower-cpu-fixture.test -test.run '^TestFlowerCPUQualification$' -test.timeout=45m
node scripts/qualify_flower_cpu.mjs --fixture=<state>/fixture.json \
  --seconds=120 --warmup=10 --threads=1 --hz=40 --stop-samples=3 --output=<sample>.json
```

Keep the fixture alive for connection, stop it via its quit operation and verify
owned cleanup. Retain raw samples/failures and binary/UI/source hashes locally;
match reference UI and qualifier revisions because thinking selectors changed in
`7d649a3b6`. Never touch the user's running Flower.

# Boundaries

Reference `31e4966a4` uses Floret v7.78.2. Candidate published v7.79.0 also includes
upstream index removal (`2445833`), bounded sequences (`7d649a3b6`) and thread browsing
simplification (`233a46346/41341d417/8cb73c54e`). Product gains measure that combination;
only the Engine benchmark isolates request-history reads. Loopback NDJSON excludes
encrypted network overhead and real model latency. Relative/P95 acceptance does not
satisfy the separate absolute CPU or every-long-task-below-100-ms budgets.

# Evidence

Engine/SQLite, 1,000 historical requests, three samples of ten executions: median
778.78 → 150.89 ms (-80.6%), allocations 2,305,077,316 → 389,844,408 bytes (-83.1%).
Deterministic history-read counts fall 10 → 1 for one tool step and 65 → 1 for twelve.
Observer membership regression formerly created 600 ResizeObservers for 300 unrelated
snapshots; it now retains observers, content, selection and focus. Backend/race,
history/retry/fork/restart and upstream historical/API adoption checks passed.

## Product acceptance

| Sample | Backend CPU | Renderer CPU | Combined CPU | GB / 120s | Output P95 | Input P95 | Click P95 | Stop P95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline-1 | 103.49% | 43.74% | 156.27% | 125.853 | 115 ms | 15.6 ms | 14.5 ms | 18.4 ms |
| baseline-2 | 102.45% | 44.22% | 155.32% | 125.861 | 100 ms | 21.7 ms | 15.3 ms | 5.0 ms |
| baseline-4 | 106.20% | 42.41% | 157.90% | 125.864 | 85 ms | 14.5 ms | 14.9 ms | 11.3 ms |
| reuse-1 | 20.39% | 42.17% | 72.03% | 16.414 | 86 ms | 17.7 ms | 15.0 ms | 30.5 ms |
| reuse-2 | 20.77% | 42.45% | 72.81% | 16.413 | 97 ms | 9.9 ms | 15.1 ms | 57.9 ms |
| reuse-3 | 20.41% | 39.08% | 68.46% | 16.416 | 67 ms | 17.2 ms | 16.7 ms | 17.9 ms |

Listed content checks and marker coverage (100%) pass; frame P95 is 17.7–18.6 ms.
Medians improve backend 103.49 → 20.41% (-80.3%), combined 156.27 → 72.03% (-53.9%)
and allocations 125.861 → 16.414 GB (-87.0%). Acceptance requires backend/combined
reductions ≥50/30%, input/click/output/Stop P95 ≤100 ms, frame P95 ≤33 ms, cadence and
coverage ≥95%; inspect measurements rather than the ordinary qualifier's exit code.

Retained adverse evidence: pre-reuse `accepted-1/2/3` are filenames, not acceptance;
output P95 was 110/151/146 ms and one Stop P95 106.6 ms. Reuse-1/2 still have 201/218 ms
long tasks and fail the stricter every-task budget. Sampling was not fully alternating;
baseline-3 failed old-selector inspection after timing, baseline-4 used the matching
qualifier, and candidate-2 overlapped heavy tests. Retain all originals.

A prior observer-corrected three-thread sample reports combined 99.23%,
input/click/output/Stop P95 16.0/14.2/59.0/16.3 ms and exact content. Its separate
30-minute/30-cycle lifecycle soak reports renderer/backend heap +1.48/+0.12%, stable
nodes/listeners, bounded goroutines and subscribers/queues returning to zero. Both
precede projection reuse and cannot certify the final revision.

## Independent integration confirmations

| Source | Backend / renderer / combined CPU | GB allocated | Input / click / output / Stop P95 | Frame P95 |
| --- | --- | ---: | --- | ---: |
| `e4a505bfc`, open-at-latest retained | 20.95 / 41.34 / 71.35% | 16.411 | 16.2 / 15.0 / 87.0 / 13.4 ms | 18.6 ms |
| `938b525a6`, native scroll chaining retained | 20.45 / 36.85 / 65.96% | 16.410 | 11.4 / 16.6 / 51.0 / 23.2 ms | 18.6 ms |

Both preserve exact canonical/rendered content and 100% markers; final owned cleanup
passes. They are separate confirmations, not extra samples in the medians. Completed
Goal disclosure fixtures were corrected to match existing `2cf47fd8f` behavior;
production behavior did not change. The broader 217-test browser pass and final
31 scroll/55 sequence-streaming checks passed.

- [Service workload](../../internal/ai/flower_cpu_qualification_test.go)
- [Electron timing and soak](../../scripts/qualify_flower_cpu.mjs)
- [Sidebar preview regression](../../internal/flower_ui/src/flowerSurfaceModel.test.ts)
- [Observers and interaction](../../internal/envapp/ui_src/src/ui/FlowerSurface.streamingStability.browser.test.tsx)
- [Earlier queue qualification](flower-live-queue-performance.md)
