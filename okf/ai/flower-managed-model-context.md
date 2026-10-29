---
type: AI Context Contract
title: Flower managed runtime facts
tags: [ai, flower, context, recovery]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Flower consumes published Floret v7.47.1. One complete collector supplies four
stable partitions: execution environment, date/timezone, repository rule
sources, and available skills. Floret owns chronological admission,
semantic changes, user-role model-context messages, compaction and recovery.
The product owns collection and authorized presentation only.

# Contract

[Goal changes](flower-goals.md) use Floret-owned typed context facts, separate from the four product-collected partitions.

Skill rediscovery uses one authoritative catalog and deterministic text; disabled or newly restricted skills cannot reuse an activation cache. Loaded skill instructions remain historical model facts.

## Skill catalog and explicit reads
The automatic skill catalog contains current available names and descriptions in stable priority/name order.

Disabled, deleted, restricted, unreadable or invalid skills cannot return older instructions as current content.

Whole-request wire bytes and body tool-result bytes are reported separately by the regression tests; these are byte measurements, not tokenizer counts or production change rates.

## Snapshot lifecycle
UserInput.Context retains ordinary submitted facts and references. Automatic facts use ModelContextSnapshot, never historical free-text parsing.

No new thread, storage migration, historical text parsing, or product-owned snapshot is required.

Authorized canonical reads and the existing workspace subscription carry the same snapshot, record location, changed/removed keys and latest request use.

Subtask details use the same component and bounded detail cache.

## Presentation
One confirmed request supplies native input-token usage, visible Unicode character counts and recent cache rate as independent measurements. Missing historical values remain unavailable; visible characters never estimate or explain token differences, and no provider history is reconstructed.

# Boundaries

Floret is the sole owner of admitted snapshots, model history, compaction and recovery. Flower collects facts and presents authorized canonical reads through the existing transport. Dynamic permissions remain enforced at actual tool authorization, independently of displayed historical facts.

# Evidence

- [Collector](../../internal/ai/prompt_workspace_context.go)

- [Canonical read projection](../../internal/ai/floret_thread_context.go)
