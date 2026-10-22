---
type: Qualification Evidence
title: Flower request-history CPU qualification
description: Qualify published execution-owned request facts and stable frontend observers under historical streaming workloads.
tags: [flower, performance, floret, history, qualification]
timestamp: 2026-10-22T00:00:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-22"
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

Floret owns request preparation and canonical storage. Redeven uses its published
public runtime without sibling replacements or a second request-history cache.
There is no provider cadence reduction, dropped output, history deletion or new
durable ledger. The [storage boundary](../ai/flower-storage-ownership-and-migrations.md)
and [streaming interaction contract](../ui/flower-streaming-stability.md) remain
authoritative.

## Qualification method

Use the real Service, its SQLite backend and the production Electron renderer
with synthetic history and fake providers. The retained-scope workload has 100
completed user turns (200 provider requests), a 16,384-byte system prompt, mixed
Markdown/Unicode/reasoning and one tool boundary every 40 updates at 40 Hz.
Each sample starts from a fresh fixture, warms up for ten seconds and measures
120 seconds. Full canonical and rendered text/code checks follow timing.

An ordinary fork starts a new prompt scope and cannot reproduce historical
provider-request amplification. Set REDEVEN_CPU_RETAIN_SEED_SCOPE=1 for the
single-thread historical comparison; leave it unset for concurrent and repeated
lifecycle scenarios. Production behavior is unchanged by these opt-in fixture
settings.

CPU uses cumulative process time; 100% is one core. Combined CPU includes the
backend and all fixture Electron processes. Allocations are cumulative bytes,
not retained heap. The machine is an Apple M5 Pro with 18 cores and 64 GiB RAM,
macOS arm64, Go 1.27.3 and Node 26.7.0. The user's running Flower is untouched.

The reference is Redeven 31e4966a4 with Floret v7.78.2. The final candidate also
contains independently merged upstream changes: Floret 2445833 removes full-text
index maintenance, Redeven 7d649a3b6 bounds expanded thinking/tool sequences, and
233a46346/41341d417/8cb73c54e simplify canonical thread browsing. Complete product
results measure this combined published upgrade. The Engine benchmark below
isolates repeated request-history reads; do not attribute every product gain to
that patch alone.

## Reproduction

Build with GOWORK=off and the published go.mod dependency:

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

The fixture process must run while the qualifier connects. Stop it through its
quit operation and verify owned process cleanup. Freeze matching UI/qualifier
revisions on the reference: thinking selectors changed in 7d649a3b6. Preserve
raw samples, failures, source identities and binary/UI hashes locally.

# Evidence

The real Engine/SQLite benchmark with 1,000 historical requests measured median
execution time 778.78 to 150.89 ms (-80.6%) and allocated bytes 2,305,077,316 to
389,844,408 (-83.1%), three samples of ten executions. The deterministic counter
regression changes 10 to 1 full-history reads for one tool step and 65 to 1 for
twelve steps. These are execution results, not whole-product CPU percentages.

The existing browser regression reproduced 600 new ResizeObservers across 300
unrelated snapshots before memoizing membership flags; afterward it retains
the original observers, content nodes, selection and focus. All 78 selected
streaming, disclosure, Markdown and reconnect browser checks pass. Backend
internal/ai and internal/session suites and focused race checks pass, including
history, cancellation, retry, fork and restart coverage. Floret source/API, full
release race, historical adoption and published blank-module gates pass; its
release Actions are green.

## Product samples and acceptance

Three baseline samples use the same retained historical workload. Three completed
projection-reuse samples give the following measurements; final
post-integration qualification must retain its exact source identity separately.

| Sample | Backend CPU | Renderer CPU | Combined CPU | Allocated / 120s | Output P95 | Input P95 | Click P95 | Stop P95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline-1 | 103.49% | 43.74% | 156.27% | 125.853 GB | 115 ms | 15.6 ms | 14.5 ms | 18.4 ms |
| baseline-2 | 102.45% | 44.22% | 155.32% | 125.861 GB | 100 ms | 21.7 ms | 15.3 ms | 5.0 ms |
| baseline-4 | 106.20% | 42.41% | 157.90% | 125.864 GB | 85 ms | 14.5 ms | 14.9 ms | 11.3 ms |
| reuse-1 | 20.39% | 42.17% | 72.03% | 16.414 GB | 86 ms | 17.7 ms | 15.0 ms | 30.5 ms |
| reuse-2 | 20.77% | 42.45% | 72.81% | 16.413 GB | 97 ms | 9.9 ms | 15.1 ms | 57.9 ms |
| reuse-3 | 20.41% | 39.08% | 68.46% | 16.416 GB | 67 ms | 17.2 ms | 16.7 ms | 17.9 ms |

All listed runs preserve exact canonical text/reasoning and rendered text/code,
with 100% observed output marker coverage and frame P95 of 17.7-18.6 ms.
Median backend CPU falls 103.49% to 20.41% (-80.3%); combined CPU falls
156.27% to 72.03% (-53.9%); allocations fall 125.861 to 16.414 GB (-87.0%).
The local
acceptance target is at least 50% lower backend and 30% lower combined CPU,
input/click/output/Stop P95 at most 100 ms, frame P95 at most 33 ms and at least
95% of the requested stream cadence and output coverage. Do not infer acceptance
from the ordinary qualifier's exit code: compare its measurements explicitly.

Keep the nonqualifying candidates. Before projection reuse, accepted-1/2/3
(their filenames are historical labels, not acceptance status) had output P95
110/151/146 ms; one Stop P95 was 106.6 ms. A source-mapped renderer profile showed
historical group/member recreation during live propagation. The differential
projection regression failed before reuse and passes afterward. Long tasks above
100 ms still exist: reuse-1/2 maxima are 201/218 ms. This is not qualification of
the stricter every-long-task-below-100-ms budget.

Actual order was baseline-1, baseline-2, candidate-1, baseline-3, candidate-2,
accepted-1, baseline-4, accepted-2, accepted-3, then reuse-1/2/3. It was not a fully
alternating experiment. Baseline-3 retained timing evidence but failed a
postmeasurement old-thinking-selector check; baseline-4 used the matching old
qualifier. Candidate-2 overlapped heavy tests. All failures remain local evidence.

A three-thread 40 Hz workload on the observer-corrected frontend passed exact
content and input/click/output/Stop P95 16.0/14.2/59.0/16.3 ms. Its combined CPU
was 99.23%. A separate 30-minute, 30-cycle hide/show, draft, stream, Stop,
unsubscribe, fork replacement and remount soak on that same frontend completed:
renderer heap +1.48%, backend heap +0.12%, stable node/listener counts and bounded
goroutines; every released subscriber and queue returned to zero. This soak
precedes projection reuse and must not be represented as final-revision evidence.

## Post-rebase confirmation

After preserving main's 18c04d34c open-at-latest behavior, integrated-1 on
production source e4a505bfc again passes: backend 20.95%, renderer 41.34%, combined
71.35%, 16.411 GB allocated, input/click/output/Stop P95 16.2/15.0/87.0/13.4 ms
and frame P95 18.6 ms. All 262 rendered items match, with exact canonical content
and 100% marker coverage. This is a separate confirmation, not an extra sample
silently folded into the three-run medians.

An expanded browser pass found an older turn-disclosure test expecting an editor
for a completed Goal, contrary to 2cf47fd8f. The regression now asserts that the
completed control is absent, then admits an active Goal and verifies its editor
remains outside collapsed content. Production Goal behavior is unchanged. All
217 tests across seven relevant browser suites pass, including sequence/turn
disclosure, thinking, streaming stability, Markdown, recovery and Goal behavior.

After preserving 2d994f6b4 native scroll chaining, production source 938b525a6
passes another 31 scroll-ownership and 55 sequence/streaming browser checks.
Final-1 measures backend 20.45%, renderer 36.85%, combined 65.96%, 16.410 GB
allocated, input/click/output/Stop P95 11.4/16.6/51.0/23.2 ms and frame P95
18.6 ms. Canonical and all rendered contents match, marker coverage is 100%,
and owned cleanup passes. It is a separate confirmation, not part of the
three-run medians.

# Boundaries

The product fixture uses loopback NDJSON transport. It does not qualify encrypted
deployment/network overhead or real model latency. Concurrent user work and the
separate lifecycle soak can introduce machine contention; retain all samples.
The stricter existing candidate-gates absolute CPU and every-long-task-below-100-ms
budgets remain separate from relative CPU and P95 acceptance. Do not weaken them
or present a relative speedup as a universal smooth-frame guarantee.

- [Real-Service workload](../../internal/ai/flower_cpu_qualification_test.go)
- [Electron timing and lifecycle soak](../../scripts/qualify_flower_cpu.mjs)
- [Sidebar preview regression](../../internal/flower_ui/src/flowerSurfaceModel.test.ts)
- [Observer, selection and focus regression](../../internal/envapp/ui_src/src/ui/FlowerSurface.streamingStability.browser.test.tsx)
- [Earlier queue amplification qualification](flower-live-queue-performance.md)
