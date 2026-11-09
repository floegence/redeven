---
type: AI Tool Contract
title: Flower child runtime and parent event boundary
tags: [ai, floret, subagent_manage, permissions]
lifecycle: contract
reviewed_at: "2026-11-06"
---
# Summary

Floret owns canonical child threads, reports and parent events. Its flat provider schema requires spawn(task_name,task_description,message), send_input(target,message), close(target) and wait(ids); status/inspect deduplicate target then ids.

# Contract

## Child runtime
subagent_manage supports spawn, send_input, wait, list, status, inspect, close and close_all. Reject non-null fields from other actions, including empty filters, before resources/authorization; strict-provider null means omission. The same pure action decoder owns bounded model correction in published Floret v7.107.9. Rejected calls are not actionable Activity; valid values stay unchanged. Child scope, stale targets, storage and permission checks remain execution checks, never correction or replay authority.

send_input steers active work or starts an idle turn, including after completion/cancellation. close cancels one child; close_all covers unfinished direct children across parent turns under current_thread (default). Reject current_run and list/target filters. Neither deletes history nor includes descendants.

Returned canonical views distinguish admitted cancellation (accepted/accepted_count for exact thread/turn/run) from settled stopped/closed counts. Already-terminal children do not count. affected_ids contains confirmed admissions; each child's state/failure, including unknown effects, stays authoritative. Batch failure retains confirmed siblings, unconfirmed_ids and unattempted_ids. A committed effect with failed projection returns non-retryable uncertainty; Activity marks the failed target unknown. Inspect before another action; no replay or second lifecycle store. Model results retain all candidates; Activity caps targets at 200 with explicit truncation and full requested count.

Model results keep child identity/name/status/current turn/queue count/failure/interactions, excluding display timestamps, duplicate IDs/counts and UI flags. Spawn/wait omit repeated descriptions; list/inspect retain them. Omit preview only when complete handoff is included. Complete handoffs bypass generic caps; explicit event reads preserve full pages. Bounded-wait metadata uses original execution results, not compact projection. Descriptions define semantics without prescribing coordination.

wait attention_required carries canonical input/approval counts without a second parent confirmation. Requests remain blocked at the child's own authority boundary; parent may use completed handoffs, do independent work or explicitly ask about dependencies. Unchanged attention is neither timeout nor progress. Parent UI uses its canonical lifecycle; child badges retain real requests. Persisted parent requests remain operable after restart.

### Child ownership and historical references
Forks copy conversation facts, not child ownership. Missing targets are missing, never completed/timed out.

## Parent events
Published subagent_read_events reads only events addressed to the current parent, including earlier turns. Floret atomically records canonical completion, failure, cancellation, interruption, normalized timeout and input/approval attention references. Browser state is temporary reading/disclosure only.

# Boundaries

Labels/previews are not identity/results. Redeven never queries Floret storage, persists child lifecycle/handoffs, infers membership from Activity or adds publication, permission-snapshot, recovery, receipt, budget or authority-barrier state. Events are context observations, not another result store or scheduler. Original message owns task/execution authorization.

# Evidence

internal/ai/subagents_cancellation_test.go covers cancellation, retained continuation, races, partial results and public reload. subagents_model_payload.go owns projection. subagents_arguments_test.go and subagents_arguments_integration_test.go cover pre-effect validation, provider feedback, valid execution, Activity, restart and next-turn history. tool_contract_clarity_test.go checks sent schemas across adapters.
