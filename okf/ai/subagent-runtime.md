---
type: AI Tool Contract
title: Flower child runtime and parent event boundary
tags: [ai, floret, subagents, permissions]
lifecycle: contract
reviewed_at: "2026-11-06"
---
# Summary

Floret owns canonical child threads, reports and parent-scoped lifecycle events. Its flat provider schema describes conditional fields: spawn requires task_name, task_description and message; send_input requires target and message; close requires target; status/inspect accept the deduplicated union of target then ids; wait requires ids.

# Contract

## Child runtime
The `subagents` tool supports spawn, send input, wait, list, status, inspect, close, and close all.

Non-null fields belonging to another action are rejected before
authorization, including empty filters. Strict-provider nulls mean omission. The
existing action validator also runs as a pure Floret decoder before resources
and effect authorization. Published Floret v7.107.9 owns bounded model correction
and omits rejected calls from actionable Activity. Valid argument values remain
unchanged. Child scope, stale targets, storage and permission checks remain
execution-state checks, not input correction or permission to replay effects.

send_input steers an active child or starts a new turn when idle, including after
completion or cancellation. close cancels one child's execution; close_all uses
current_thread scope (the default), covering unfinished direct children across
parent turns. current_run is rejected rather than silently widened. Neither action
deletes threads or history, includes descendants, or accepts list/target filters.

Cancellation results derive from the returned Floret view: accepted/accepted_count
confirms a cancellation for its exact thread/turn/run; stopped/stopped_count and
closed/closed_count confirm settled execution. Already-terminal children do not
contribute. affected_ids contains confirmed admissions; per-child status and
failure remain authoritative, including unknown external effects. A batch stops
at its first error and retains confirmed siblings, unconfirmed_ids and
unattempted_ids. The failing call may have committed before result projection
failed: the model receives a non-retryable uncertain-effect error, and Activity
retains the confirmed prefix with the failed target marked unknown. No replay or
second lifecycle store is introduced. Inspect before a new action. Model results
retain every candidate outcome; Activity limits its target list to 200, marks the
display truncation and keeps the complete requested count.

The model-facing result keeps child identity, task name, status, current turn, queue count, failure and interaction facts. Display timestamps, duplicated IDs and counts, and UI action flags remain outside that projection. Spawn and wait do not repeat task descriptions; list and explicit inspect retain them. A preview is omitted only when the same result carries the complete handoff.

Complete handoff bodies bypass generic output caps. Explicit event reads retain their full page contract. Bounded-wait metadata derives from the original execution result, never its compact model projection. Wait returns on child events and includes available complete reports; inspect explicitly reads reports. Tool descriptions state input and output semantics without prescribing a coordination workflow.

Parent reports, lifecycle events, bounded waiting, and the compact event panel are described in [Subagent parent events](#parent-events).

Wait attention_required reports canonical child input/approval counts in each
item without creating a second parent confirmation. Child requests remain
blocked at their own authority boundary. The parent model can use completed
handoffs, perform independent work or explicitly ask for a dependency decision.
Unchanged attention is neither a timeout nor new progress. Parent UI activity
continues to derive solely from its canonical lifecycle; child badges retain the
real requests. Existing persisted parent requests remain operable after restart.

### Child ownership and historical references
Forks copy conversation facts, never child ownership.

Missing targets are presented as missing rather than completed or timed out.

## Parent events
Flower uses published Floret parent events. subagent_events reads only events
addressed to the current parent thread, including earlier turns; it is not a
global event stream.

Floret atomically records references for completion, failure, cancellation, interruption, normalized execution timeout and input/approval attention alongside their canonical source.

The browser keeps only temporary reading/disclosure state.

# Boundaries

Task labels and previews are presentation, not identity or results. Redeven must not query Floret storage, persist child lifecycle or handoff projections, infer membership from activity, or reintroduce publication, permission-snapshot, recovery, receipt, output-budget, or authority-barrier state.

Events are observations and context inputs, not a second result store or a background scheduling mechanism. Task and execution authorization remain in the original `message`; see [Subagent runtime](#child-runtime).

# Evidence

- `redeven:internal/ai/subagents_cancellation_test.go` - Published cancellation, retained threads/continuation, race outcomes, partial model results and public Activity reload.
- `redeven:internal/ai/subagents_model_payload.go` - Source.
- `redeven:internal/ai/subagents_arguments_test.go` - Conditional validation before effect authority and unchanged accepted inputs.
- `redeven:internal/ai/subagents_arguments_integration_test.go` - Actual provider feedback, valid execution, user-visible Activity, restart and subsequent-turn history.
- `redeven:internal/ai/tool_contract_clarity_test.go` - Sent schemas across provider adapters.
