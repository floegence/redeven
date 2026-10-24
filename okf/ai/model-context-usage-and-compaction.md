---
type: AI Runtime Contract
title: Model context usage and compaction
description: Canonical compaction evidence, context usage, and timeline presentation.
tags: [ai, models, context, compaction]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-23"
---
# Summary

Published Floret owns canonical context, compaction and usage. Redeven presents
its typed snapshots without accumulating usage or reconstructing lifecycle facts.
[Context compaction and Goal continuation](flower-context-compaction.md) defines
manual intent, admission, execution, cancellation and recovery. [Qualification](../operations/flower-compaction-qualification.md) defines deterministic, historical-copy and real-provider checks.

# Contract

## Compaction decision evidence
The canonical lifecycle optionally retains the frozen trigger candidate, pressure and validated replacement.

## Timeline presentation
Compaction uses a single status row between two short separator lines. Details
appear in a compact, surface-owned tooltip without changing timeline layout.
Successful compression shows only the canonical message counts as
≈ {before} → {after} tokens; provider-request decision estimates never substitute
for missing message counts. Missing counts have an explicit localized explanation.
Running and cancelled operations have short localized descriptions. Failures show
the original error, wrapping long text without clipping; absent errors have a
short localized fallback. No expanded detail panel is rendered.

The tooltip follows the active surface, uses global theme tokens outside the chat
shell, and prefers space above the status, falling below near the top boundary.
Pointer exit dismisses it after a brief delay that permits hovering and selecting
its contents. Escape, Tab, focus loss and outside pointer actions dismiss it;
process collapse closes it through the existing visibility owner. Keyboard and
touch access and the independent retry action remain available.

## Projection and usage
Floret installs the complete context snapshot in its actor-owned current view before publishing its version. Context changes bypass text cadence, while equal snapshots still coalesce text growth within the existing bounded queues.

Redeven does not invent a total budget or infer serving capacity from model weights.

# Boundaries

Floret owns one shared summary, validation, convergence, and installation path. Historical `/compact` conversation output is never retroactively classified as successful compaction.

Cache counters and the latest/cumulative tooltip rates follow the [request reuse and usage contract](model-request-reuse.md#cache-usage-presentation), using canonical confirmed usage rather than another host store.

# Evidence

- `redeven:internal/ai/floret_thread_context.go` - Canonical divider anchors and usage mapping.

- `redeven:internal/flower_ui/src/chat/flowerContextPresentation.ts` - Canonical usage and localized noop presentation.

- `redeven:internal/flower_ui/src/runtimeCurrentView.test.ts` - Complete typed context and execution projection.
