---
type: Qualification Evidence
title: Flower request-history CPU qualification
tags: [flower, performance, floret, history, qualification]
lifecycle: active_evidence
reviewed_at: "2026-10-25"
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

Engine/SQLite1000 requests, three samples×ten executions: median778.78→150.89ms(-80.6%), allocation2,305,077,316→389,844,408 bytes(-83.1%). Reads10→1 for one tool and65→1 for twelve. Observer regression600 observers/300 snapshots now retains owners/content/selection/focus. Backend/race/history/retry/fork/restart/upstream historical/API checks pass.

| Sample | Backend % | Renderer % | Combined % | GB/120s | Output ms | Input ms | Click ms | Stop ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline-1 | 103.49 | 43.74 | 156.27 | 125.853 | 115 | 15.6 | 14.5 | 18.4 |
| baseline-2 | 102.45 | 44.22 | 155.32 | 125.861 | 100 | 21.7 | 15.3 | 5.0 |
| baseline-4 | 106.20 | 42.41 | 157.90 | 125.864 | 85 | 14.5 | 14.9 | 11.3 |
| reuse-1 | 20.39 | 42.17 | 72.03 | 16.414 | 86 | 17.7 | 15.0 | 30.5 |
| reuse-2 | 20.77 | 42.45 | 72.81 | 16.413 | 97 | 9.9 | 15.1 | 57.9 |
| reuse-3 | 20.41 | 39.08 | 68.46 | 16.416 | 67 | 17.2 | 16.7 | 17.9 |

Timings are P95; content/100% markers pass; frame17.7–18.6ms. Median backend103.49→20.41%(-80.3%), combined156.27→72.03%(-53.9%), allocation125.861→16.414GB(-87.0%). Acceptance: reductions≥50/30%, input/click/output/Stop≤100ms/frame≤33ms P95, cadence/coverage≥95%; inspect metrics, not ordinary qualifier exit alone.

Retain pre-reuse accepted-1/2/3 (filenames, not passes): output110/151/146ms, one Stop106.6ms. Reuse1/2 long tasks201/218ms fail strict budget. Not fully alternating; baseline3 fails old selector after timing,baseline4 matches qualifier,candidate2 overlaps heavy tests. Earlier observer-corrected three-thread combined99.23%,input/click/output/Stop16.0/14.2/59.0/16.3ms, exact content. Its separate30min/30cycle soak: renderer/backend heap+1.48/+0.12%, stable nodes/listeners/bounded goroutines/zero release queues. Both predate projection reuse and cannot certify final source.

Independent confirmations, not median samples:

| Source | Backend/renderer/combined % | GB | Input/click/output/Stop P95 ms | Frame ms |
| --- | --- | ---: | --- | ---: |
| e4a505bfc, open-at-latest | 20.95/41.34/71.35 | 16.411 | 16.2/15.0/87.0/13.4 | 18.6 |
| 938b525a6, scroll chaining | 20.45/36.85/65.96 | 16.410 | 11.4/16.6/51.0/23.2 | 18.6 |

Exact content/100% markers/cleanup pass. Goal disclosure fixtures match existing2cf47fd8f; production unchanged. Browser217 plus31 scroll/55 sequence-streaming checks pass.

Sources: [fixture](../../internal/ai/flower_cpu_qualification_test.go), [timing/soak](../../scripts/qualify_flower_cpu.mjs), [sidebar](../../internal/flower_ui/src/flowerSurfaceModel.test.ts), [browser](../../internal/envapp/ui_src/src/ui/FlowerSurface.streamingStability.browser.test.tsx), [queue qualification](flower-live-queue-performance.md).
