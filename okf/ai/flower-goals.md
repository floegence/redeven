---
type: AI Interaction Contract
title: Flower thread Goals
description: Manage one concise objective and reflect in the same execution context before natural completion.
tags: [ai, flower, goals, recovery]
timestamp: 2026-10-19T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Published Floret owns the canonical Goal, model tool, reflection and completion.
Redeven authorizes mutations and presents the typed facts. One current Goal per
thread describes the desired result clearly and concisely without a text-length
recommendation, ceiling or truncation. Goal never depends on Todo. Stop, thread
navigation and recovery remain available; an unresolved request never claims a
successful mutation or completion.

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

- redeven:internal/ai/activity_goal_test.go — public detail, timeline and live Goal   fidelity, closed display fields, exact long text and reviews during user waiting.

- redeven:internal/ai/thread_goal.go — authorization and typed mutation mapping.

- redeven:internal/ai/thread_goal_test.go — empty creation, provider reflection,   replay, conflicts, lost-response recovery, Stop during reflection, default Todo   exclusion and retained attachment submission.
