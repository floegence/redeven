---
type: AI Tool Contract
title: AI tool runtime
description: Redeven AI builtin tools are registered with permission semantics, presentation metadata, provenance, and runtime execution dispatch.
tags: [ai, tools, permissions, ui]
timestamp: 2026-06-18T00:00:00Z
---

Redeven's AI runtime treats tools as typed runtime capabilities. Builtins declare mutation and approval requirements, presentation metadata, grouping behavior, and renderer hints before execution dispatch reaches the runtime implementation. Floret owns the provider loop, projected turn execution, loop progress guards, tool dispatch lifecycle, permission/resource/approval lifecycle, streaming observation, core control-signal projection, opaque provider state lifecycle, activity observation, and engine metrics. Redeven owns product threads, persisted messages, concrete tool implementations, product policy decisions, approval UI, provider credentials, provider-specific state persistence, and Flower timeline projection.

# Mechanism

The builtin registry includes file, patch, terminal, web search, OKF search, todo, interaction, skill, and subagent tools. Mutating tools require approval by default; terminal commands are profiled per invocation; `okf.search` is read-only Redeven repository knowledge lookup; web search is non-mutating product behavior but an open-world network effect in Floret's engine contract. `ToolPresentationSpec` is the single product display source for renderer, grouping, operation, label fields, fallback labels, compact call payload fields, result payload fields, and activity chip fields. Redeven projects builtins into Floret tool definitions with effects, read-only/destructive/open-world flags, resource extractors, static permission defaults, dynamic `PermissionFor`, and activity projection. Tool execution normalizes success summaries, errors, truncation, provenance, and builtin dispatch results so the chat activity timeline can render compact tool activity instead of raw low-level payloads.

Floret owns the permission lifecycle. Redeven still decides product policy, including plan-mode readonly blocking, dangerous command blocking, subagent readonly guards, no-user-interaction blocking, and user approval requirements, but those decisions are returned through the Floret `Approver` before tool dispatch. Tool handlers execute already-approved domain actions and write audit/query records such as `ai_tool_calls`, run events, and execution spans; those records support diagnostics and tool-detail lookup, not Flower UI activity generation.

Provider adapters are model gateways, not Flower renderers. `floretProviderAdapter` maps provider stream bytes into Floret `ModelEvent` values. Assistant text, reasoning deltas, and model-generated tool-call stream observations are emitted as provider-neutral Floret model events before Redeven projects them into Flower live state. `ToolCallStream` identifies a tool call while the model is still generating it; final executable tool calls remain the separate `ToolCalls` batch. Redeven applies assistant text, reasoning deltas, tool-call stream observations, retry/done/abort markers, and source observations only from Floret runtime events in the event sink. Provider continuation persistence reads the complete opaque provider state from the Floret turn result, stores it as a state JSON envelope including `Attributes`, and only matches provider id, model, base URL, and state kind before passing it back to Floret.

Flower UI tool activity comes from Floret `ActivityTimeline` projection. Redeven can key detail lookups from timeline item ids, but it must not synthesize chat activity rows from `ai_tool_calls`, `tool.call`, `tool.result`, execution spans, handler outcomes, or provider-adapter side effects.

Control signal projection is separate from Redeven waiting UI persistence. Floret signal projection emits engine signal facts for `ask_user`, `task_complete`, and Redeven's `exit_plan_mode`; Flower `RequestUserInputPrompt` objects and product actions such as `set_mode=act` are created only by Redeven's waiting projection and persistence layer.

`terminal.exec` is the local AI runtime shell. Its schema describes local execution, and successful terminal results include `execution_location=local_runtime` plus the resolved local working directory. Thread target context, Welcome environment context, or a target-shaped id does not change where this builtin runs.

When a thread is configured for explicit target routing, the runtime forwards target-scoped builtin calls through `TargetToolExecutor`. The target executor receives a `TargetToolCall` containing `target_id`, `tool_name`, sanitized arguments, and required capabilities. The run layer returns a result payload that preserves or injects `target_id` and `execution_location`, so target-routed tool results cannot lose provenance before they reach the model or activity timeline.

Flower execution uses the published Floret runtime package through `runFloretProjectedTurn`. Redeven passes its internal hard tool-call protection to Floret as `MaxToolCalls`; Floret `Metrics.Steps` is consumed as telemetry for result projection and activity accounting, not as a product configuration or request field. `ask_user` and `task_complete` use Floret core control definitions and provider-safe projection, while `exit_plan_mode` remains a Redeven product control signal.

# Boundaries

Tool names are not aliases for deleted knowledge-era tools. Current repository knowledge lookup is `okf.search` only. OKF is an embedded project corpus and does not access the internet; external, current, recent, news, third-party, market, pricing, and general web facts must use direct authoritative URLs or web search discovery instead.

Target provenance is part of the tool contract, not a UI hint. Flower must not infer remote execution from thread context alone; it can only claim remote or target execution when a tool result or Redeven product command returns explicit execution provenance.

Redeven must consume published Floret releases. Repository builds, tests, Desktop runs, and release validation must not depend on a sibling checkout, Go workspace, local replace directive, or package-manager local link. The current runtime boundary depends on `github.com/floegence/floret v0.3.16`.

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
[16] redeven:internal/ai/floret_runtime.go:170 - Flower execution runs through Floret projected turns with a Floret approver and event sink.
[17] redeven:internal/ai/model_gateway.go:37 - Redeven's remaining hard execution protection is the tool-call count constant.
[18] redeven:internal/ai/floret_runtime.go:192 - Redeven passes `MaxToolCalls` into the Floret turn limits.
[19] redeven:internal/ai/floret_runtime.go:203 - Provider continuation candidates are built from the Floret turn result provider state.
[20] redeven:internal/ai/provider_continuation.go:30 - Previous provider state is loaded as the full Floret model state envelope after provider/profile matching.
[21] redeven:internal/ai/floret_runtime.go:417 - `exit_plan_mode` waiting prompts are built during Redeven result projection, not signal projection.
[22] redeven:go.mod:9 - Redeven depends on the published Floret module version.
