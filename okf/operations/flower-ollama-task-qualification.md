---
type: Qualification Contract
title: Flower Ollama task qualification
description: Run real selected-model tasks through production Flower commands and verify effects, interruption, recovery, and subagent handoffs.
tags: [flower, ollama, tasks, qualification]
timestamp: 2026-10-05T00:00:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

The opt-in task qualification calls the selected installed Ollama model through
the production Flower service and published Floret runtime. The model chooses
real tool calls; assertions inspect actual files, terminal processes, canonical
views, and the workspace stream. A failed scenario remains a failure, with no
simulated replacement or automatic rerun. Tests own isolated state and stop only
their own services and tools. Source configuration and credentials stay unchanged.

# Contract

## Acceptance scenarios
- Read structured data, compute a sum, write and verify a file, then modify it in   a later user turn. - Stop generation, including after visible output; accept Stop promptly, settle   cancelled, reject failure retry of a cancelled turn, and accept a new task. - Stop a running terminal command; preserve its confirmed initial effect, kill   its process, prevent its delayed write, and execute a later task. - Edit a queued task with optimistic text matching, reject a stale edit, reorder   tasks, delete one, and verify actual execution order and canonical user text. - Send queued input immediately, cancel the active provider request, and run the   selected task.

It checks the exact Chat history shape needed by Ollama without fabricating provider output.

## Interleaved operations
The additional interleaving cases combine commands at observed live boundaries:

- Submit identical requests concurrently, reject conflicting content for the   same key, issue concurrent stops, restart, and promote the single retained task. - Stop and immediately restart during real generation, approval, and Ask User;   preserve the original user-stop identity, reject stale responses, and promote   each retained queue item exactly once across the three boundaries. - Edit, reorder, and delete queued tasks during approval; stop and restart before   promotion, and reject a late approval without executing the cancelled tool. - Submit duplicate approvals concurrently and replay the accepted answer before   and after restart; reject a conflicting answer and verify one actual effect. - Stop an Ask User interaction, restart and run replacement input, then reject a   stale answer without reviving the cancelled task. - Cut two real continuations across restarts, race retry commands, and enqueue   new input while retrying; preserve the original write exactly once. - Race duplicate send-now commands, reject edits to consumed queue items, and   replay promotion across restart without executing either item again. - Change permissions while input is queued, reject active model changes, and   preserve an existing approval snapshot when permissions are later upgraded. - Repeat readonly, approval, shutdown/restart, stale approval rejection, fresh   approved input, post-effect stream failure, readonly downgrade, restart/retry,   and restored full-access writes.

Passing both layers does not claim an automated Desktop click-through against the live model.

## Execution and evidence
Run `scripts/check_flower_tasks_ollama.sh` explicitly, or use `scripts/check_flower_tasks_ollama.sh --interleavings` for only the combined operation cases.

Deterministic tests pass for the role-free schema, exact delegation text, all three inherited permission modes, historical readonly preservation, and canonical steering and spawn replay.

Temp stores and fixture files are removed after each case; reports retain the observable results.

# Boundaries

The [thread runtime](../ai/floret-thread-runtime.md) owns commands, cancellation, queueing, and retry.

Every observed provider request must use that model.

These controlled transport faults qualify recovery paths, not the endpoint's natural network reliability.

# Evidence

- `redeven:scripts/check_flower_tasks_ollama.sh` - Explicit published-dependency real-model runner.

- `redeven:internal/ai/run_e2e_ollama_tasks_test.go` - Model-driven tasks, effects, fault boundaries, product commands, and acceptance evidence.

- `redeven:internal/ai/run_e2e_ollama_interleavings_test.go` - Concurrent commands, stale responses, restart, isolation, and compaction interleavings.
