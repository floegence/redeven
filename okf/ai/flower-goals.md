---
type: AI Interaction Contract
title: Flower thread Goals
tags: [ai, flower, goals, recovery]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Floret owns canonical Goal, model tool, reflection and completion; Redeven authorizes and presents facts. One current Goal/thread states intent without text limits or Todo dependency. Stop/navigation/recovery remain usable; unresolved requests never imply successful mutation.

# Contract

## Compaction and continuation
[Manual compaction](flower-context-compaction.md) defaults to explicit continue_goal intent. Retry and restart use canonical preparation and confirmed tools. Redeven forwards intent and renders state without a second execution coordinator.

## Goal ownership and execution
User and model updates enter Floret's shared journal writer with request identity and expected version. An existing unfinished Goal remains authoritative across continuation and context restoration.

Stop cancels execution and reflection; deletion only cancels future Goal checks.

## Interaction and recovery
Selecting or entering /goal opens an in-composer command chip.

Each popup opening confirms detail through the existing read coordinator before showing canonical text.

A failed binding leaves the draft available for retry; no cross-thread target validation is relaxed and no attachment is uploaded twice.

# Boundaries

## Todo
Default Flower tools, capability lists and prompts omit write_todos and current Todo state. Deleting Todo later requires no change to Goal execution or interaction.

# Evidence

- redeven:internal/ai/activity_goal_test.go

- redeven:internal/ai/thread_goal.go
