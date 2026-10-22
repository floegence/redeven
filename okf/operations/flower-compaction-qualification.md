---
type: Runtime Qualification
title: Flower context compaction qualification
description: Isolated deterministic, historical-copy, and real-provider compaction acceptance.
tags: [ai, flower, context, compaction, qualification]
timestamp: 2026-10-20T00:00:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

Compaction qualification uses isolated state and explicit test lanes. Production
threads are never continued by historical-copy inspection. The [execution contract](../ai/flower-context-compaction.md) owns intent and recovery; [usage presentation](../ai/model-context-usage-and-compaction.md) maps canonical observations.

# Contract

## Deterministic timeline qualification
`REDEVEN_COMPACTION_RUNTIME_UI=1 GOWORK=off go test ./internal/ai -run '^TestFlowerCompactionRuntimeUI$' -count=1 -v` starts a task-owned SQLite Runtime and dynamic HTTP port with a scripted overflow provider.

Browser checks retain every operation, canonical neighbor order, one row per operation, complete collapse and refresh. Empty managed-context collections map to wire arrays without mutating upstream snapshots.

## Real DeepSeek qualification
`scripts/check_flower_context_deepseek.sh --compaction` reads the configured official DeepSeek model and credentials through production parsers and uses isolated state.

Every lane has bounded rounds and time.

Its output retains synthetic canonical snapshots, screenshots, and sanitized request accounting.

# Boundaries

These checks qualify published Floret through public APIs and actual Flower surfaces. They never substitute for deterministic historical migration and adoption release gates.

# Evidence

- `redeven:internal/ai/flower_compaction_ui_test.go` - Isolated scripted Runtime and optional historical-copy qualification.

- `redeven:scripts/check_flower_compaction_ui.mjs` - Actual FlowerSurface order, collapse and refresh assertions.

- `redeven:internal/ai/run_e2e_deepseek_compaction_acceptance_test.go` - Four real-provider lanes.
