---
type: Qualification Evidence
title: Flower request-history CPU qualification
tags: [flower, performance, floret, history, qualification]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
---
# Summary

Floret v7.79.0 reads canonical request facts once/execution, advancing bounded state after successful writes. Retry/restart reload; lineage validation remains. Redeven bounds sidebar previews and retains sequence members/observers. Three Service/Electron samples reduce median backend CPU80.3%, combined53.9%, allocations87.0%, preserving content/interaction.

# Contract

Floret owns request preparation; consume published runtime, without sibling replacement/second cache. No reduced cadence, dropped output/history or durable ledger. [Storage](../ai/flower-storage-ownership-and-migrations.md) and [streaming](../ui/flower-streaming-stability.md) remain normative.

Real Service/SQLite/production Electron, fake providers:100 turns/200 requests,16,384-byte system prompt, mixed Markdown/Unicode/reasoning, tool every40 updates at40Hz. Fresh fixtures warm10s/measure120s, then check exact prose/reasoning/rendered code. Apple M5 Pro18 cores/64GiB,macOS arm64,Go1.27.3/Node26.7.0; CPU process time (100%=core), combined includes all Electron, allocations cumulative not retained heap.

Build TestFlowerCPUQualification with GOWORK=off and qualify_flower_cpu.mjs --build --dist=<isolated-ui>. Set REDEVEN_CPU_QUALIFICATION=1, HISTORY_TURNS=100, SYSTEM_PROMPT_BYTES=16384, TOOL_EVERY=40, RETAIN_SEED_SCOPE=1, STATE=<fresh-root>, DIST=<ui> using the REDEVEN_CPU_ prefix. Run fixture -test.run '^TestFlowerCPUQualification$' -test.timeout=45m, then qualifier --fixture=<state>/fixture.json --seconds=120 --warmup=10 --threads=1 --hz=40 --stop-samples=3 --output=<sample>.json. Retain seed scope only for historical amplification; ordinary forks change it. Concurrency/lifecycle leave override unset.

Quit owned fixtures via their operation/verify cleanup. Retain raw failures/binary/UI/source hashes; match UI and qualifier since thinking selectors changed in7d649a3b6. Never touch user Flower.

# Boundaries

Reference31e4966a4 uses v7.78.2. Candidate also includes index removal2445833, bounded sequences7d649a3b6 and browsing233a46346/41341d417/8cb73c54e. Product gain measures all; Engine benchmark isolates history reads. Loopback NDJSON excludes encryption/model latency. Relative/P95 passes do not satisfy absolute CPU/every-task<100ms.

# Evidence

Engine 1000requests, three×ten executions:median 778.78→150.89 ms, allocation 2305077316→389844408 B; reads 10→1(one tool),65→1(twelve). Observer 600/300snapshots preserves owners/content/selection/focus; Go/race/history/retry/fork/restart/upstream checks pass.

Three product samples:median backend 103.49→20.41%, combined 156.27→72.03%, allocation 125.861→16.414GB/120 s; exact content/100%markers, frame 17.7–18.6 ms. Relative reductions≥50/30%, input/click/output/Stop≤100 ms, frame≤33 ms pass. Reuse long tasks 201/218 ms still fail strict budget. Preserve pre-reuse output 110/151/146 ms and Stop 106.6 ms; baseline 3 selector failure, candidate 2 heavy-test overlap and nonalternating order limit inference.

Earlier three-thread combined 99.23% and 30min soak(heap+1.48/+0.12%, stable nodes/listeners, bounded goroutines, zero release queues) predate reuse and cannot certify final source. Independent e4a505bfc/938b525a6 confirmations are not pooled medians:combined 71.35/65.96%, output 87/51 ms, frame 18.6 ms; content/cleanup pass. Goal fixtures retain 2cf47fd8f; 217browser plus 31scroll/55sequence checks pass.

Sources: [fixture](../../internal/ai/flower_cpu_qualification_test.go), [qualifier](../../scripts/qualify_flower_cpu.mjs), [sidebar](../../internal/flower_ui/src/flowerSurfaceModel.test.ts), [browser](../../internal/envapp/ui_src/src/ui/FlowerSurface.streamingStability.browser.test.tsx), [queue](flower-live-queue-performance.md). Git retains individual source/sample tables. Loopback NDJSON excludes encryption/model latency.
