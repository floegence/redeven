---
type: Runtime Qualification
title: Flower context compaction qualification
description: Isolated deterministic, historical-copy, and real-provider compaction acceptance.
tags: [ai, flower, context, compaction, qualification]
timestamp: 2026-10-20T00:00:00Z
---
# Summary

Compaction qualification uses isolated state and explicit test lanes. Production
threads are never continued by historical-copy inspection. The [execution contract](../ai/flower-context-compaction.md) owns intent and recovery; [usage presentation](../ai/model-context-usage-and-compaction.md) maps canonical observations.

# Contract

## Deterministic timeline qualification

`REDEVEN_COMPACTION_RUNTIME_UI=1 GOWORK=off go test ./internal/ai -run '^TestFlowerCompactionRuntimeUI$' -count=1 -v` starts a task-owned SQLite Runtime and dynamic HTTP port with a scripted overflow provider. It proves start and completion reach the actual FlowerSurface while the turn stays active, then verifies stable identity, disclosure and refresh. The test logs its commit, PID, port and state path and cleans its listeners, browser and temporary state on exit. It is opt-in qualification, outside ordinary commit, push and CI gates.

Optional `REDEVEN_COMPACTION_HISTORY_COPY`, `REDEVEN_COMPACTION_HISTORY_THREAD` and `REDEVEN_COMPACTION_HISTORY_TURN` select an already consistent private database copy. Only the copy is opened through published Floret, with deferred execution and a factory that refuses execution. Browser checks retain every operation, canonical neighbor order, one row per operation, complete collapse and refresh. The original database and running thread are never opened or mutated by this qualification. Empty managed-context collections map to wire arrays without mutating upstream snapshots.

## Real DeepSeek qualification

`scripts/check_flower_context_deepseek.sh --compaction` reads the configured official DeepSeek model and credentials through production parsers and uses isolated state. The recorder retains request classification, hashes, sizes, continuation presence, and native usage without credentials, headers, or source user content. Facts appear only at the end of the earliest synthetic input, beyond the former 1,200-byte preview boundary. Qualification also checks that summary requests receive those facts. Legal public admissions create pressure; the test proves that the original source leaves the retained tail, the summary preserves the facts, and an independent recall succeeds.

Four mandatory lanes cover small-history noop, manual installation/replay/restart/repeated installation, automatic compaction with a 256,000/28,000 test budget, and automatic compaction at the configured full budget. Every lane has bounded rounds and time. Missing usage, unavailable providers, skipped tests, timeout, or absent compaction fail qualification. Simulated overflow remains deterministic evidence, never a claim of natural DeepSeek overflow.

`internal/envapp/ui_src/scripts/checkFlowerCompactionRuntime.mjs` qualifies the built Runtime and real Tessiven canvas with isolated state and the same configured provider. It checks the dedicated command route, summary-only manual execution, draft and canvas-reference preservation, replay and refresh with one divider, and natural full-window automatic compaction followed by recall. Its output retains synthetic canonical snapshots, screenshots, and sanitized request accounting.

# Boundaries

These checks qualify published Floret through public APIs and actual Flower
surfaces. Real-provider checks are explicit local qualification, outside ordinary
commit and push gates. They never substitute for deterministic historical
migration and adoption release gates.

# Evidence

- `redeven:internal/ai/flower_compaction_ui_test.go` - Isolated scripted Runtime and optional historical-copy qualification.
- `redeven:scripts/check_flower_compaction_ui.mjs` - Actual FlowerSurface order, collapse and refresh assertions.
- `redeven:internal/ai/run_e2e_deepseek_compaction_acceptance_test.go` - Four real-provider lanes.
- `redeven:scripts/check_flower_context_deepseek.sh` - Mandatory opt-in acceptance entry point.
- `redeven:internal/envapp/ui_src/scripts/checkFlowerCompactionRuntime.mjs` - Built Runtime and real-provider canvas qualification.
