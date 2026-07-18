---
type: AI Runtime Contract
title: AI model and context runtime
description: Model-source ownership, provider mapping, token limits, context usage, and compaction contracts.
tags: [ai, models, context, providers]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

Redeven persists product model and reasoning preferences, provider credentials, and model-source selection, while Floret owns provider-visible context and opaque continuation state. Environment and Desktop model sources remain distinct, context and compaction presentation come from typed Floret observations, and input/output token limits preserve their separate meanings. Product configuration updates merge permission and model state without overwriting unrelated settings.

# Contract

## Mechanism

Flower configuration has three independent states. The default `permission_type` is valid without any model configuration and initializes only future threads. An environment `AIModelProfile` exists only when both the provider registry and `current_model_id` are present and the selected model belongs to that registry; either field without the other is invalid. A Desktop model source is a separate runtime catalog and may coexist with that environment profile in one Flower settings snapshot. Env App exposes it only when the required Desktop session route is exactly `remote_desktop`; `local_host` and ordinary browser sessions do not expose Desktop diagnostics. Its status is a strict discriminated union: `ready` owns a non-empty validated catalog, `missing_keys` owns provider ids, `empty` represents a successfully loaded empty catalog, `connecting`, `unbound`, `expired`, and `unsupported` are explicit binding states, and `error` may carry one diagnostic. A missing Runtime declaration maps to `unsupported`; catalog transport or validation failures map to `error` and are never swallowed. Catalog entries enter `ready` only when `source` is exactly `desktop_model_source` and the id matches the opaque `desktop:model_<64 lowercase hex>` contract. The environment profile remains the persisted default and wins initial new-chat selection whenever it exists. Selecting a Desktop model affects only the current mounted Flower surface's new-chat draft or the selected thread and never calls the environment default-model persistence path, so remounting Flower restores the environment default. `AIConfig.HasModelProfile()` is the canonical environment-profile predicate, and the existing `ai_runtime.remote_configured` wire field reports that predicate rather than the presence of an `AIConfig` object. The focused default-permission update merges under the AI service state lock, while provider-bundle updates replace only the model profile under the same lock, so concurrent writes preserve permission and recovery settings. Generic settings updates do not accept `ai`.

Provider adapters are model gateways, not Flower renderers or lifecycle stores. `floretProviderAdapter` directly maps typed Floret messages and provider stream bytes, including `PreviousState` and `ResponseState`, without grouping, repairing, deduplicating, or reordering the Floret contract. Assistant text, reasoning deltas, and model-generated tool-call stream observations are emitted as provider-neutral Floret model events before Redeven projects them into Flower live state. Floret persists opaque response state internally after journal finalization and reloads it only when the journal leaf and non-sensitive gateway compatibility key match. Redeven computes that key from provider id/type, normalized endpoint, wire model, and transport route; it stores no continuation envelope or matching fields.

Provider tool-call generation has a private `omit` or `enable` wire mode. `enable` serializes `parallel_tool_calls:true`; it allows a provider model to return more than one call but does not require the model to do so and is never read by the executor. Redeven enables it only for known HTTPS official OpenAI Responses/Chat, Qwen DashScope, OpenRouter, xAI, and Groq endpoints. Anthropic, DeepSeek, Moonshot, ChatGLM, Ollama, generic `openai_compatible`, Desktop opaque sources, proxies, and custom base URLs omit the field. No request path sends a false value. Hosted-turn diagnostics record the selected wire mode, and Floret lifecycle audit events carry batch index, batch size, event type, and observation time so operators can distinguish model serialization, provider single-call output, approval wait, dispatch, and completion without feeding diagnostics back into scheduling.

Thread model and reasoning defaults are Redeven product state. `ai_thread_settings` persists `model_id` and `reasoning_selection_json`; there is no separate model-lock state. Existing thread model changes validate the requested model against the allowed runtime or Desktop model source list, require an idle mutable thread, and normalize the thread reasoning selection for the new model. Redeven does not clear provider continuation: the next Floret Host uses a different gateway compatibility key when provider type, endpoint, wire model, or route changes, and Floret invalidates incompatible continuation internally. The configured `current_model_id` is only the persisted environment default for future threads; it must not be synced back into existing thread defaults. Turn launch resolves and stores product model/reasoning choices before execution, while Floret owns execution, provider-visible context, and opaque state persistence; it does not own thread preferences, provider credentials, provider profiles, UI policy, or product model switching.

Context pressure and compaction presentation come from structured Floret runtime observations and `ReadThreadContext`. During a live process, Redeven maps typed context status and compaction events into in-memory Flower events only; it does not persist those events, compaction debug lifecycle, mapped context DTOs, or a context run cursor. Bootstrap and reconnect open a provider-free maintenance Host over the Service's shared Floret Store, read the canonical `ThreadContextSnapshot`, validate it, and map usage plus terminal compaction facts into the response. Manual `/compact` requests enter Redeven only as Flower UI/RPC coordination signals. The command response exposes the Redeven `request_id`, never a provisional Floret operation id; canonical operation identity appears only in validated Floret events and results. Active compaction stays inside the current Floret turn. Idle compaction keeps only Redeven command admission, queueing, mutual exclusion, cancellation, and shutdown coordination; `CompactThreadResult.Validate()` and its typed compaction event provide the operation id and terminal outcome. Redeven never synthesizes a Floret lifecycle or commits provider state.

Run token limits preserve distinct field semantics across the Redeven/Floret boundary. Redeven passes `RunOptions.MaxInputTokens` directly to Floret `TurnLimits.MaxInputTokens`, where it limits cumulative provider input usage across the entire hosted run. `MaxOutputTokens` remains a per-provider-request output ceiling used by Floret context policy and `ModelRequest.MaxOutputTokens`. Redeven does not add input and output limits into a derived `MaxTotalTokens`, and an unset input limit does not create an implicit cumulative token budget.

# Boundaries

No additional boundary is declared for this concept.

# Evidence

- `redeven:internal/ai/tools/types.go:126` - `ToolPresentationSpec` carries renderer, operation, label, fallback, compact payload, result payload, and activity chip fields.
- `redeven:internal/ai/floret_provider.go:55` - Provider stream deltas are sent to Floret as model events rather than mutating Flower state directly.
- `redeven:internal/ai/floret_events.go:105` - Structured context status observations update only the current Flower stream.
- `redeven:internal/ai/floret_runtime.go:160` - Flower execution runs through Floret hosted turns with a Floret approver, event sink, and dynamic tool surface provider.
- `redeven:internal/ai/compact_thread_context.go:17` - Manual context compaction is exposed as a serialized thread action.
- `redeven:internal/ai/run.go:548` - Active runs implement Floret's manual compaction source.
- `redeven:internal/ai/model_gateway.go:37` - Redeven's remaining hard execution protection is the tool-call count constant.
- `redeven:internal/ai/context_action_floret.go:27` - Redeven formats accepted linked context and attachments into Floret supplemental context.
- `redeven:internal/ai/subagents_floret.go:363` - Subagent hosts reuse the resolved Flower model gateway, Floret tools, approver, event sink, shared Floret thread store, and twenty-minute run timeout.
- `redeven:internal/ai/threads.go:670` - `SetThreadModel` validates product model preferences without managing provider continuation.
- `redeven:internal/ai/service.go:2093` - `resolveRunModel` chooses explicit request model, thread model, Desktop model-source defaults, then config current model.
- `redeven:internal/ai/thread_actor.go:607` - `SendUserTurn` resolves the effective model before starting or enqueueing a turn.
- `redeven:internal/ai/threadstore/store.go:951` - Threadstore updates `model_id` and `reasoning_selection_json` as the thread default preference.
- `redeven:internal/ai/floret_tools.go:135` - Floret tool invocations validate parent execution identity exactly and use explicit child host context for product child run identity.
- `redeven:internal/ai/desktop_model_source.go:1168` - Desktop model-source capabilities are sanitized to the opaque Desktop provider and model identity.
- `redeven:internal/ai/tool_concurrency_contract_test.go:20` - Provider matrix and HTTP request tests prove supported endpoints send true and all other paths omit the field.
- `redeven:internal/envapp/ui_src/src/ui/flower/envLocalFlowerSurfaceAdapter.ts:288` - The stable Desktop session route gates whether Env App loads and exposes Desktop models.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:1656` - Composer model changes branch on model-source ownership before persisting defaults.
- `redeven:internal/flower_ui/src/contracts/flowerSurfaceContracts.ts:97` - Desktop model-source readiness and failure modes are represented as one strict discriminated union.
