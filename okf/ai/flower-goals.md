---
type: AI Interaction Contract
title: Flower thread Goals
tags: [ai, flower, goals, recovery]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Floret owns canonical Goal, model tool, reflection and completion; Redeven authorizes and presents facts. Stop/navigation/recovery remain usable; unresolved requests never imply successful mutation. Stop cancels execution and reflection; deletion only cancels future Goal checks.

# Contract

## Compaction and continuation
[Manual compaction](model-context-usage-and-compaction.md#manual-compaction) defaults to explicit continue_goal intent. Retry and restart use canonical preparation and confirmed tools. Redeven forwards intent and renders state without a second execution coordinator.

## Goal ownership and execution
User and model updates enter Floret's shared journal writer with request identity and expected version. An existing unfinished Goal remains authoritative across continuation and context restoration.

## Interaction and recovery
Selecting or entering /goal opens an in-composer command chip.
The chip shares the editor's typography and first line box. Entering, typing a
single-line Goal and exiting preserve composer, footer and transcript geometry;
multiline text retains normal bounded autosizing. Native command conversion
synchronizes the editable value even when the canonical draft stays empty, so
the localized Goal placeholder appears immediately.

Each popup opening confirms detail through the existing read coordinator before showing canonical text.

A failed binding leaves the draft available for retry; no cross-thread target validation is relaxed and no attachment is uploaded twice.

# Boundaries

## Todo
Default Flower tools, capability lists and prompts omit todo_write and current Todo state. Deleting Todo later requires no change to Goal execution or interaction.

# Evidence

- redeven:internal/ai/activity_goal_test.go
- redeven:internal/ai/thread_goal.go
