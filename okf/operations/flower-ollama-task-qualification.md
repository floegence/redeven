---
type: Qualification Contract
title: Flower Ollama task qualification
description: Run real selected-model tasks through production Flower commands and verify effects, interruption, recovery, and subagent handoffs.
tags: [flower, ollama, tasks, qualification]
timestamp: 2026-10-05T00:00:00Z
---
# Summary

The opt-in task qualification calls the selected installed Ollama model through
the production Flower service and published Floret runtime. The model chooses
real tool calls; assertions inspect actual files, terminal processes, canonical
views, and the workspace stream. A failed scenario remains a failure, with no
simulated replacement or automatic rerun. Tests own isolated state and stop only
their own services and tools. Source configuration and credentials stay unchanged.

# Contract

## Scope and boundaries

The [thread runtime](../ai/floret-thread-runtime.md) owns commands, cancellation,
queueing, and retry. The [subagent contract](../ai/subagent-runtime.md) owns child
membership and handoffs. This suite qualifies those contracts against actual
inference. It does not implement another runtime or promise universal model
instruction compliance. [Context qualification](flower-ollama-context-qualification.md)
separately owns token accounting and compaction pressure cases.

The existing environment's selected Ollama model and serving capacity are
resolved through the shared profile loader. Any startup conversion occurs on a
temporary copy. Every observed provider request must use that model. Isolated
threads use real full-access tools only against synthetic files in their fixture
workspace; the approval scenario changes its own thread to approval-required.
Runtime state lives outside that workspace so task files do not expose journals
as an alternate source for inherited-history answers.

A loopback proxy forwards actual model output. To make interruption timing
repeatable, it can pause after a complete original SSE event containing generated
text, or cut the real connection after a confirmed tool result reaches the next
model request. It never fabricates model tokens or tool calls. A dedicated case
waits for visible content before stopping; other cases may stop during reasoning.
These controlled transport faults qualify recovery paths, not the endpoint's
natural network reliability.

## Acceptance scenarios

- Read structured data, compute a sum, write and verify a file, then modify it in
  a later user turn.
- Stop generation, including after visible output; accept Stop promptly, settle
  cancelled, reject failure retry of a cancelled turn, and accept a new task.
- Stop a running terminal command; preserve its confirmed initial effect, kill
  its process, prevent its delayed write, and execute a later task.
- Edit a queued task with optimistic text matching, reject a stale edit, reorder
  tasks, delete one, and verify actual execution order and canonical user text.
- Send queued input immediately, cancel the active provider request, and run the
  selected task. Ordinary Stop separately preserves a queued task until explicit
  promotion.
- Cut inference after a same-turn confirmed write, retry, and finish without
  duplicating the write or original user input. Completed work is retained in
  Floret's canonical checkpoint; completed turns reject another product retry.
- Approve, deny, and stop pending tool approval. Files must not change before
  permission, denial must not execute an alternate tool, and later input works.
- Persist Ask User and queued input through service restart, answer the unchanged
  question, finish both tasks, accept an identical answer replay, and reject a
  conflicting answer. Stopping an unanswered question permits a fresh task.
- Spawn two real child workers before waiting; verify their tool execution,
  complete result handoffs, aggregated result, inspection, and follow-up input
  without creating duplicate children.
- Fork full conversation history into a child, recover a fact omitted from its
  mission, and perform a real child file write. Assert the fact is present in
  inherited messages, absent from the mission, and never written by the parent.
  Closing the child retains its history.
- Interrupt a child during a running command, send replacement work to the same
  child, and prevent the original delayed effect.
- Stop the parent while a child is running, wait for both canonical cancellations,
  prevent the delayed child effect, and accept new parent input.

Every successful case checks a final workspace-stream view against canonical
detail, unique item identities, no live items after settlement, and actual
selected-model requests. These finite tasks must leave no running terminal
processes. Browser component suites separately exercise queue
reordering, subagent disclosure/detail, and approval layout. Passing both layers
does not claim an automated Desktop click-through against the live model.

## Execution and evidence

Run `scripts/check_flower_tasks_ollama.sh` explicitly. Set
`REDEVEN_FLOWER_CONTEXT_SOURCE_STATE_ROOT` when the existing local-environment
path differs from `$HOME/.redeven/local-environment`. The script sets
`GOWORK=off` and is outside ordinary CI and the push gate.

Set `REDEVEN_FLOWER_TASK_REPORT_ROOT` to a private evidence directory for per-case
JSON reports. They contain synthetic task views, model request metadata, fault
counts, PID, temporary state location, and loopback port; keep the run log and
source commit alongside them. Reports contain no API keys. A scenario's `pass`
flag does not replace the complete Go test process exit status. Temp stores and
fixture files are removed after each case; reports retain the observable results.

# Evidence

- `redeven:scripts/check_flower_tasks_ollama.sh` - Explicit published-dependency real-model runner.
- `redeven:internal/ai/run_e2e_ollama_tasks_test.go` - Model-driven tasks, effects, fault boundaries, product commands, and acceptance evidence.
- `redeven:internal/ai/run_e2e_ollama_context_test.go` - Shared selected-profile discovery and transparent provider recorder.
- `redeven:internal/ai/stop_thread.go` - Thin product mapping to upstream graceful subtree cancellation.
