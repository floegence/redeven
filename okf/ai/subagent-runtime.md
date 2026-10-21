---
type: AI Tool Contract
title: Flower subagent runtime
description: Canonical child threads, direct task instructions, scoped reads, and complete handoffs.
tags: [ai, floret, subagents, permissions]
timestamp: 2026-10-18T00:00:00Z
---
# Summary

Floret v7 owns each SubAgent as a normal canonical child Thread. Redeven exposes product tools and Flower mappings over the typed `ThreadRuntime` without a second child identity, result store, recovery projection, or child lifecycle table. Parent-scoped summaries are bounded status only; the canonical child current view is the only complete handoff authority.

# Contract

The `subagents` tool supports spawn, send input, wait, list, status, inspect, close, and close all. Spawn requires `task_name`, `task_description`, and `message`, with optional `context_mode`. The parent writes the task, scope, constraints, execution authorization, deliverables, and verification needs in `message`; Flower passes that text unchanged as child input. `context_mode` selects mission-only or full-history context and does not select capabilities. Task names, descriptions, and message wording do not filter tools or change permission. New children inherit the parent's current permission settings; later `send_input` uses the child's current settings. Every child still follows the ordinary product resource, permission, and approval lifecycle. The new schema has no `agent_type`. Floret `HostProfileRef` is host metadata only: new children share `flower`, while historical values remain available for original-request replay. Neither this metadata nor historical role fields select current prompts, permissions, or tools. Replay retains the original admitted input and request identity. Title/objective aliases and inferred task names are rejected. Mission-only creates a child without inherited transcript; full-history uses the typed Floret fork path. Published Floret v7.26.0 closes copied in-flight tool calls before the child branch boundary with an explicit non-inheritance result. The child starts with paired model history while the parent retains ownership of its ongoing execution and real result.

Floret v7.64.0 distinguishes status checks from result reads. `status` requires explicit target/ids, deduplicates in request order, and accepts at most 200 distinct direct children. Its allowlist contains thread identity, task name (140 code points), status, current turn, closed, queue count, update time, and optional failure code. It never reads a complete View or returns previews, report bodies, task descriptions, waiting questions, or failure messages. Missing identities are explicit. `inspect` and `wait` retain full results.

Parents reuse sufficient untruncated reports and complete results already available for the same child turn. Read report events only when their text is needed; completion events have no final report, so read the result through inspect when needed. Event reads remain available for audit and overflow review remains mandatory. Wait only for outstanding children when independent work is exhausted. No durable read ledger, automatic full-report injection, or extra parent wakeup is introduced.

Every tool call and result uses Floret's typed `subagent_operation` Activity renderer. Its payload keeps the exact action, requested target order, task display fields, target status, requested/completed/missing counts, timeout state, and public error. Redeven never truncates a multi-target operation to its first child. Wait targets join current summaries only by canonical `ThreadID`; labels and unrelated child lists are not fallback identity. The older `subagent` renderer remains limited to one durable child-thread fact and is not an operation fallback.

List, wait, and inspect `items` entries expose `last_message_preview` only for bounded status context. Wait and inspect prove membership through the parent-scoped list, then read every selected completed child through typed `View`. They return one ordered `handoffs` array containing the exact final non-live Assistant text from the current Turn together with its `ThreadID`, `TurnID`, and `RunID`. A timed-out wait still returns handoffs for completed children and status only for active children. A failed View read, identity mismatch, changed completion state, or completed Turn without a final Assistant item fails explicitly; preview text never substitutes for a handoff.

List, wait, and inspect also expose `items[].failure` when the canonical child summary contains a failure. Its exact `code` and `message` come from Floret's typed `ThreadTurnFailure`, including interruption and unknown-effect reasons; Redeven does not infer them from status or preview text. Failure text remains subject to Floret's standard tool-output projection rather than preview truncation. An absent canonical failure omits the field, and subsequent reads reflect the current summary after retry without retaining the old reason. Child failures do not make a successful management read fail or enter the completed `handoffs` array. The parent must not automatically retry `effect_outcome_unknown`.

Model-visible handoff content bypasses Redeven's Activity-size sanitizer and remains subject only to Floret's standard tool-output projection. The Activity projection reads its own bounded status allowlist and never copies or scans handoff content, so a long report cannot create a false Activity truncation state.

Redeven calls published Floret v7 typed Create/Fork, Send, Steer, View, List, and Delete operations. Floret allocates the canonical child `ThreadID`; that id is used in model results, Flower summaries, detail routes, interactions, and activity. There is no public or persisted `subagent_id`, publication receipt, provisional child identity, or recovery handle.

Spawn and child input use deterministic request keys scoped to the parent thread, parent turn, tool call, and canonical child where applicable. Repeating the same logical tool action therefore converges in the canonical journal without duplicate child input. Redeven may persist product settings for display and current policy, but those rows do not own membership, messages, queue, activity, or lifecycle.

`send_input` uses the optional published `ThreadSteeringController.Steer` capability in Floret v7.37.2. Admission immediately persists the full instruction; the current child task resumes after the engine's safe provider/tool boundary. It does not enqueue ordinary input or cancel and replace the Turn. Floret owns pending/applied/cancelled steering facts and rejects late interaction responses. `accepted` confirms admission only. Confirmed tool results remain canonical; returned uncertainty commits a tool error and continues the model; an unsettled effect terminates with effect_outcome_unknown and must never be replayed automatically. Active guidance retains the child's existing execution authority; a new Turn receives normal product authorization. Steering does not create an unconsumed effect-request inbox entry.

The parent-scoped child input operation validates current RWX permission, endpoint ownership, and canonical membership on every call. Queue steering atomically consumes the exact full canonical input through `SteerQueued`; conditional removal checks the same complete-input fingerprint. Changed, removed, or consumed input returns a conflict. Explicit resubmission reads an original steering item only when its cancellation reason is `stopped`; unknown effects cannot be resubmitted through this route. No browser transcript is accepted as execution content.

Each child execution proves parent-child membership through the typed runtime and derives its current tool policy from Redeven settings. Child tools cannot address the root or a sibling, and the child surface excludes recursive subagent creation. Approval and Ask User interactions remain canonical child interactions; resolving them updates only that child current view.

Flower detail reads canonical child current state and typed activity through the parent-scoped product route. It does not parse metadata into messages, reconstruct activity from audits, or maintain a second child transcript. Flower Stop requests graceful cancellation of the selected thread and every existing descendant through published Floret `CancelInput.IncludeDescendants`. Children retain their canonical histories and queued inputs; independent root threads keep running. Each child settles its own confirmed effects, so parent settlement is not a barrier proving every child is already idle. Thread deletion follows the canonical Floret tree deletion contract.

Parent reports, lifecycle events, bounded waiting, and the compact event panel are described in [Subagent parent events](subagent-parent-events.md).

## Child ownership and historical references

Forks copy conversation facts, never child ownership. Every child tool and detail/input route uses the current parent ThreadID. Missing or foreign `send_input` and `close` targets return an explicit `not_found` result, false admission/cancellation flags, and guidance to list current children; no authority, steering, or cancellation is dispatched. Canonical read failures remain errors. The execution-environment snapshot identifies the current thread and refreshes naturally after a fork without querying child inventories.

Historical Activity preserves task facts and distinct child identities, but navigation is offered only for a canonical child of the selected thread. Panel projection, Activity actions, and the detail-open boundary all check current membership; a historical child ID never becomes a synthetic current child. Missing targets are presented as missing rather than completed or timed out.

# Boundaries

Task labels and previews are presentation, not identity or results. Redeven must not query Floret storage, persist child lifecycle or handoff projections, infer membership from activity, or reintroduce publication, permission-snapshot, recovery, receipt, output-budget, or authority-barrier state.

# Evidence

- `redeven:internal/ai/builtin_tool_handlers.go` - Declares the strict subagent tool input.
- `redeven:internal/ai/subagents_floret.go` - Adapts subagent operations to typed Floret v7 child Thread methods.
- `redeven:internal/ai/floret_tools.go` - Maps SubAgent calls and results into the typed operation Activity without losing action or target order.
- `redeven:internal/ai/subagents_handoff_test.go` - Proves complete handoffs, timeout behavior, identity failures, and Activity separation.
- `redeven:internal/ai/subagents_scope_test.go` - Proves non-mutating stale-target recovery, independent-root and fork isolation before/after restart, and provider continuation.
- `redeven:internal/ai/delegation_model_context_test.go` - Checks actual provider requests for absent automatic overviews, one-time removal, capability refresh, and preserved management results.
- `redeven:internal/ai/subagents_failure_test.go` - Proves canonical failure delivery to the parent model across list, wait, inspect, and retry.
- `redeven:internal/ai/subagent_input_operations_test.go` - Proves immediate provider interruption, task identity, queue consumption, and authorization failures.
- `redeven:internal/ai/types.go` - Exposes canonical child `thread_id` in product views.
- `redeven:internal/flower_ui/src/flowerSubagentProjection.ts` - Projects canonical child activity for Flower.
- `redeven:internal/flower_ui/src/flowerSubagentDetailThread.ts` - Builds detail from the typed canonical child view.
