---
type: AI Tool Contract
title: AI tool runtime
description: Redeven AI builtin tools are registered with permission semantics, presentation metadata, provenance, and runtime execution dispatch.
tags: [ai, tools, permissions, ui]
timestamp: 2026-06-18T00:00:00Z
---

Redeven's AI runtime treats tools as typed runtime capabilities. Builtins declare mutation and approval requirements, presentation metadata, grouping behavior, and renderer hints before execution dispatch reaches the runtime implementation. Floret owns the provider loop, projected turn execution, loop progress guards, tool dispatch lifecycle, permission/resource/approval lifecycle, streaming observation, core control-signal projection, opaque provider state lifecycle, activity observation, and engine metrics. Redeven owns product threads, persisted messages, concrete tool implementations, product policy decisions, approval UI, provider credentials, provider-specific state persistence, and Flower timeline projection.

# Mechanism

The builtin registry includes file, patch, terminal, web search, OKF search, todo, interaction, skill, and subagent tools. Mutating tools require approval by default; terminal commands and subagent actions are profiled per invocation; `okf.search` is read-only Redeven repository knowledge lookup; web search is non-mutating product behavior but an open-world network effect in Floret's engine contract. `ToolPresentationSpec` is the single product display source for renderer, grouping, operation, label fields, fallback labels, compact call payload fields, result payload fields, and activity chip fields. Redeven projects builtins into Floret tool definitions with effects, read-only/destructive/open-world flags, resource extractors, static permission defaults, dynamic `PermissionFor`, and activity projection. Tool execution normalizes success summaries, errors, truncation, provenance, and builtin dispatch results so the chat activity timeline can render compact tool activity instead of raw low-level payloads.

Floret owns the permission lifecycle. Redeven still decides product policy, including plan-mode readonly blocking, dangerous command blocking, subagent readonly guards, no-user-interaction blocking, and user approval requirements, but those decisions are returned through the Floret `Approver` before tool dispatch. `subagents` is a static delegation tool whose invocation policy asks for approval when spawning a `worker`, sending input to a child, closing one child, or closing all children; read-only explore/reviewer spawns and observation actions stay read-only. A user-approved `worker` spawn becomes a narrow child host-context delegation grant for mutating child tool invocations, while later `send_input` calls do not extend that mutation grant. Dangerous-command, plan-mode, and read-only profile guards still run through the Floret approver path. Tool handlers execute already-approved domain actions and write audit/query records such as `ai_tool_calls`, run events, and execution spans; those records support diagnostics and tool-detail lookup, not Flower UI activity generation.

Provider adapters are model gateways, not Flower renderers. `floretProviderAdapter` maps provider stream bytes into Floret `ModelEvent` values. Assistant text, reasoning deltas, and model-generated tool-call stream observations are emitted as provider-neutral Floret model events before Redeven projects them into Flower live state. `ToolCallStream` identifies a tool call while the model is still generating it; final executable tool calls remain the separate `ToolCalls` batch. Redeven applies assistant text, reasoning deltas, tool-call stream observations, retry/done/abort markers, and source observations only from Floret runtime events in the event sink. Provider continuation persistence reads the complete opaque provider state from the Floret turn result, stores it as a state JSON envelope including `Attributes`, and only matches provider id, model, base URL, and state kind before passing it back to Floret.

Context pressure and compaction presentation also come from structured Floret runtime observations. Redeven maps Floret context status into `context.usage.updated` and maps Floret compaction lifecycle events into `context.compaction.updated`; those product events are persisted as run events and projected into Flower live materialized state. Redeven supplies a projected compaction summarizer to Floret so the reusable Floret lifecycle still owns the compaction decision, operation id, start/complete/failed phases, active history rewrite, and continuation.

Flower UI tool activity comes from Floret `ActivityTimeline` projection. Redeven can key detail lookups from timeline item ids, but it must not synthesize chat activity rows from `ai_tool_calls`, `tool.call`, `tool.result`, execution spans, handler outcomes, or provider-adapter side effects.

Flower subagents use the published Floret `Host` lifecycle rather than a Redeven-owned goroutine task manager. Redeven caches one Floret subagent runtime per parent Flower thread, so child controllers, the Floret host, and the private SQLite store outlive an individual parent turn. Parent run cancellation or natural turn completion cancels only the parent sampling/tool loop; explicit `subagents(close)` or `subagents(close_all)` is the normal lifecycle path that stops children without deleting their thread records, and parent thread deletion closes known children, releases the cached host, and deletes its read-only child projection threads. `Service.Close` releases local host resources during process shutdown. The `subagents` builtin validates `spawn`, `send_input`, `wait`, `list`, `inspect`, `close`, and `close_all`, then forwards to Floret `SpawnSubAgent`, `SendSubAgentInput`, `WaitSubAgents`, `ListSubAgents`, and `CloseSubAgent`. `wait` defaults to five minutes and caps requested waits at twenty minutes, while child runs pass a twenty-minute Floret subagent run timeout. The child `ThreadID` is the canonical subagent identity and is also returned as `subagent_id` for model-facing compatibility; task names and paths are labels, not lifecycle targets, and the model cannot supply a child `thread_id` or `fork_mode`. Redeven currently selects Floret `SubAgentForkNone` at the host boundary. The thread-scoped child host registers the parent thread's maximum delegated tool surface, removes parent-only controls, and then applies the current parent turn mode and subagent profile through Floret host-context labels on each child input. If the parent run's model/tool/session configuration changes, the runtime rebuilds the child host only when no child is active; active children continue on the existing host generation. Child tools execute with the Floret invocation `RunID`, `ThreadID`, and `TurnID`, so tool-call audit records and execution spans belong to the child thread instead of the parent. Child threads run with a Flower child prompt that forbids further subagent creation and direct user input, filters out `subagents`, `ask_user`, `write_todos`, and `exit_plan_mode`, and reports concise parent-facing handoff material.

Subagent data is intentionally split into model-facing summaries, parent timeline presentation, and human detail. The model-facing `subagents` result returns bounded `items` with status, digest, controls, timeout facts, and `detail_ref`; it marks `detail_omitted=true` and scrubs child transcript, messages, entries, tool calls, tool results, raw args, raw output, commands, stdout, and stderr before the result can enter the parent model context. Parent Flower timeline state still comes from Floret `ActivityTimeline` payloads for `subagents`, and the shared UI projection accepts only the current `snapshot`, `subagent`, `item`, and `items` envelope shapes. The parent thread header exposes a Sub Agents dropdown with active and settled counts; selecting a child opens a parent-scoped detail overlay and keeps the selected Flower thread unchanged. The overlay reads `GET /api/ai/threads/{parent}/subagents/{child}/detail`, which calls Floret `ReadSubAgentDetail` with `IncludeRaw=false` and renders user/assistant messages, tool calls, tool results, approvals, turn markers, compactions, errors, and custom rows from the child execution timeline. Child projection threads still carry structured ownership metadata with `owner_kind=subagent_projection` and `parent_thread_id` for read-only internal projection and cleanup, but `threadstore.ListThreads` excludes them from normal thread-list/sidebar results. The old transcript `type:"subagent"` block chain and legacy `snapshots`, `snapshots_by_id`, or free-form `subagents` collection payloads are not supported display sources.

Control signal projection is separate from Redeven waiting UI persistence. Floret signal projection emits engine signal facts for `ask_user`, `task_complete`, and Redeven's `exit_plan_mode`; Flower `RequestUserInputPrompt` objects and product actions such as `set_mode=act` are created only by Redeven's waiting projection and persistence layer.

`terminal.exec` is the local AI runtime shell. Its schema describes local execution, and successful terminal results include `execution_location=local_runtime` plus the resolved local working directory. Thread target context, Welcome environment context, or a target-shaped id does not change where this builtin runs.

When a thread is configured for explicit target routing, the runtime forwards target-scoped builtin calls through `TargetToolExecutor`. The target executor receives a `TargetToolCall` containing `target_id`, `tool_name`, sanitized arguments, and required capabilities. The run layer returns a result payload that preserves or injects `target_id` and `execution_location`, so target-routed tool results cannot lose provenance before they reach the model or activity timeline.

Flower execution uses the published Floret runtime package through `runFloretProjectedTurn`. Redeven passes its internal hard tool-call protection to Floret as `MaxToolCalls`; Floret `Metrics.Steps` is consumed as telemetry for result projection and activity accounting, not as a product configuration or request field. `ask_user` and `task_complete` use Floret core control definitions and provider-safe projection, while `exit_plan_mode` remains a Redeven product control signal.

# Boundaries

Tool names are not aliases for deleted knowledge-era tools. Current repository knowledge lookup is `okf.search` only. OKF is an embedded project corpus and does not access the internet; external, current, recent, news, third-party, market, pricing, and general web facts must use direct authoritative URLs or web search discovery instead.

Target provenance is part of the tool contract, not a UI hint. Flower must not infer remote execution from thread context alone; it can only claim remote or target execution when a tool result or Redeven product command returns explicit execution provenance.

Redeven must consume published Floret releases. Repository builds, tests, Desktop runs, and release validation must not depend on a sibling checkout, Go workspace, local replace directive, or package-manager local link. The current runtime boundary depends on `github.com/floegence/floret v0.3.22`, including Floret's public reasoning selection API, structured context observations, projected compaction summary lifecycle, and parent-scoped subagent detail API.

# Citations

[1] redeven:internal/ai/tools/registry.go:86 - Builtin tool definitions declare mutation, approval, and presentation specs.
[2] redeven:internal/ai/tools/registry.go:157 - `okf.search` is registered as a read-only structured tool activity.
[3] redeven:internal/ai/tools/types.go:126 - `ToolPresentationSpec` carries renderer, operation, label, fallback, compact payload, result payload, and activity chip fields.
[4] redeven:internal/ai/builtin_tool_handlers.go:18 - Tool success summaries are normalized by builtin name or semantic activity category.
[5] redeven:internal/ai/builtin_tool_handlers.go:632 - `okf.search` is described as embedded Redeven repository knowledge, not internet search.
[6] redeven:internal/ai/floret_tools.go:275 - Redeven projects builtin tools into Floret definitions with effects, flags, permissions, and activity projection.
[7] redeven:internal/ai/floret_tools.go:313 - Floret permission defaults and dynamic invocation permissions are derived from Redeven product tool policy.
[8] redeven:internal/ai/prompt_builder.go:322 - Prompt construction routes information sources between workspace tools, OKF, and external web discovery.
[9] redeven:internal/ai/tools/registry.go:111 - Unknown tool names do not resolve to builtin definitions.
[10] redeven:internal/ai/target_tool_policy.go:49 - Target tool calls and results carry target id and execution location fields.
[11] redeven:internal/ai/run.go:2833 - Explicit target policy forwards eligible tools through the target executor.
[12] redeven:internal/ai/run.go:3220 - Local `terminal.exec` returns local runtime execution provenance.
[13] redeven:internal/ai/floret_approval.go:14 - Redeven product policy is returned through the Floret tool approver.
[14] redeven:internal/ai/floret_provider.go:55 - Provider stream deltas are sent to Floret as model events rather than mutating Flower state directly.
[15] redeven:internal/ai/floret_events.go:42 - Flower applies streaming and source observations from Floret runtime events.
[16] redeven:internal/ai/floret_events.go:123 - Structured context status observations are persisted and streamed as `context.usage.updated`.
[17] redeven:internal/ai/floret_events.go:139 - Structured compaction observations are persisted and streamed as `context.compaction.updated`.
[18] redeven:internal/ai/floret_compaction.go:19 - Redeven implements the projected Floret compaction summarizer without taking over Floret's compaction lifecycle.
[19] redeven:internal/ai/floret_runtime.go:171 - Flower execution runs through Floret projected turns with a Floret approver and event sink.
[20] redeven:internal/ai/model_gateway.go:37 - Redeven's remaining hard execution protection is the tool-call count constant.
[21] redeven:internal/ai/floret_runtime.go:193 - Redeven passes `MaxToolCalls` into the Floret turn limits.
[22] redeven:internal/ai/floret_runtime.go:204 - Provider continuation candidates are built from the Floret turn result provider state.
[23] redeven:internal/ai/provider_continuation.go:30 - Previous provider state is loaded as the full Floret model state envelope after provider/profile matching.
[24] redeven:internal/ai/floret_runtime.go:419 - `exit_plan_mode` waiting prompts are built during Redeven result projection, not signal projection.
[25] redeven:go.mod:9 - Redeven depends on the published Floret module version.
[26] redeven:internal/ai/service.go:394 - The service caches a thread-scoped Floret subagent runtime and attaches each new parent run to it.
[27] redeven:internal/ai/subagents_floret.go:129 - The Redeven subagent runtime dispatches validated actions to the Floret host lifecycle.
[28] redeven:internal/ai/subagents_floret.go:363 - Subagent hosts reuse the resolved Flower model gateway, Floret tools, approver, event sink, private SQLite store, and twenty-minute run timeout.
[29] redeven:internal/ai/subagents_floret.go:587 - `spawn` calls Floret `SpawnSubAgent` and returns child `thread_id` as the lifecycle identity.
[30] redeven:internal/ai/subagents_floret.go:656 - `wait` calls Floret `WaitSubAgents` with bounded timeout semantics.
[31] redeven:internal/ai/tools/registry.go:424 - Subagent invocation policy asks approval for worker spawn, send_input, close, and close_all.
[32] redeven:internal/ai/subagents_floret.go:791 - Model-facing subagent results are reduced to bounded summary items.
[33] redeven:internal/ai/subagents_floret.go:1315 - Flower subagent detail reads through the parent-scoped Floret detail API with raw content disabled.
[34] redeven:internal/codeapp/appserver/server.go:3737 - Appserver exposes the parent-scoped subagent detail route.
[35] redeven:internal/flower_ui/src/flowerSubagentProjection.ts:130 - The shared UI projection derives subagent dropdown items only from current activity payload shapes.
[36] redeven:internal/flower_ui/src/FlowerSurface.tsx:1300 - Opening subagent detail loads the child detail without selecting the child thread.
[37] redeven:internal/flower_ui/src/FlowerSurface.tsx:3480 - The selected parent thread header renders the Sub Agents dropdown.
[38] redeven:internal/flower_ui/src/FlowerSurface.tsx:3342 - Subagent execution detail renders inside the parent-thread overlay.
[39] redeven:internal/ai/threadstore/store.go:357 - Normal thread-list queries exclude `subagent_projection` rows.
[40] redeven:internal/ai/floret_tools.go:135 - Floret tool invocations derive a child execution run from the invocation run, thread, and turn ids.
[41] redeven:internal/ai/floret_approval.go:56 - The Floret approver recognizes the parent-approved worker delegation grant without bypassing other policy gates.
[42] redeven:internal/ai/subagents_floret.go:2446 - Flower child prompts forbid nested subagents and direct user input.
[43] redeven:internal/ai/subagent_lifecycle_test.go:29 - Parent run cancellation is tested to avoid releasing the durable subagent runtime.
[44] redeven:internal/ai/threads.go:173 - Flower subagent projection threads are rejected by direct thread mutation paths.
[45] redeven:internal/ai/threads.go:895 - Parent thread deletion closes its cached Floret subagent runtime and deletes child projection threads.
