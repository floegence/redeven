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

OpenAI-compatible Chat reasoning is capability-driven. Redeven reads only response fields named by the resolved model capability, emits their fragments as reasoning without trimming provider whitespace, and never treats reasoning-only output as assistant body text. Assistant reasoning is replayed through provider-specific history fields only when the same capability declares that requirement; unsupported models receive no synthetic reasoning field.

Flower configuration has three independent states. The default `permission_type` is valid without model configuration and initializes only future threads. An environment `AIModelProfile` requires a provider registry plus a valid `current_model_id`. A Desktop source is a separate runtime catalog exposed only for the exact `remote_desktop` route. Its strict status union distinguishes ready, empty, missing-key, binding, unsupported, and error states; only `desktop_model_source` entries with opaque `desktop:model_<64 lowercase hex>` ids enter the ready catalog. The environment profile remains the persisted new-chat default. Desktop selection changes only the mounted new-chat draft or selected thread, so remount restores the environment default. `AIConfig.HasModelProfile()` is the sole environment-profile predicate. Permission and provider updates merge under the service lock, preserving unrelated settings, and generic settings updates do not accept `ai`.

Provider adapters are model gateways, not Flower renderers or lifecycle stores. `floretProviderAdapter` directly maps typed Floret messages and provider stream bytes, including `PreviousState` and `ResponseState`, without grouping, repairing, deduplicating, or reordering the Floret contract. Assistant text, reasoning deltas, and model-generated tool-call stream observations are emitted as provider-neutral Floret model events before Redeven projects them into Flower live state. Floret persists opaque response state internally after journal finalization and reloads it only when the journal leaf and non-sensitive gateway compatibility key match. Redeven computes that key from provider id/type, normalized endpoint, wire model, and transport route; it stores no continuation envelope or matching fields.

Tool names use one dotted canonical vocabulary across Redeven definitions, Floret, canonical history, current views, and Flower presentation; `terminal.read` and `terminal.exec` never acquire underscore-form canonical aliases. OpenAI-compatible request serialization builds one bidirectional alias table from the current tool definitions and canonical continuation history, rejects collisions, and uses that same table for definitions, historical calls/results, streamed call events, and final ToolCalls. A wire-only name such as `terminal_read` is translated back before any event enters Floret, while an unregistered response name fails at the gateway without emitting a tool event. Anthropic receives canonical dotted names directly. Published Floret v4.0.12 keeps schema-invalid calls and ordered validation results only inside the same-run provider correction loop; they do not dispatch handlers, enter canonical thread history, or create Flower tool-failure rows. Redeven keeps `terminal.read.description` required rather than weakening the schema to avoid correction.

Provider tool-call generation has a private `omit` or `enable` wire mode. `enable` serializes `parallel_tool_calls:true`; it allows a provider model to return more than one call but does not require the model to do so and is never read by the executor. Redeven enables it only for known HTTPS official OpenAI Responses/Chat, Qwen DashScope, OpenRouter, xAI, and Groq endpoints. Anthropic, DeepSeek, Moonshot, ChatGLM, Ollama, generic `openai_compatible`, Desktop opaque sources, proxies, and custom base URLs omit the field. No request path sends a false value. Hosted-turn diagnostics record the selected wire mode, and Floret lifecycle audit events carry batch index, batch size, event type, and observation time so operators can distinguish model serialization, provider single-call output, approval wait, dispatch, and completion without feeding diagnostics back into scheduling.

Thread model and reasoning defaults are Redeven product state. `ai_thread_settings` persists `model_id` and `reasoning_selection_json`; there is no separate model-lock state. Existing thread model changes validate the requested model against the allowed runtime or Desktop model source list, require an idle mutable thread, and normalize the thread reasoning selection for the new model. Redeven does not clear provider continuation: the next Floret Host uses a different gateway compatibility key when provider type, endpoint, wire model, or route changes, and Floret invalidates incompatible continuation internally. The configured `current_model_id` is only the persisted environment default for future threads; it must not be synced back into existing thread defaults. Turn launch resolves and stores product model/reasoning choices before execution, while Floret owns execution, provider-visible context, and opaque state persistence; it does not own thread preferences, provider credentials, provider profiles, UI policy, or product model switching.

Context pressure and compaction presentation come from structured Floret runtime observations and the identity-bound context reader. During a live process, Redeven maps typed context status and compaction events into in-memory Flower events only; it does not persist those events, mapped context DTOs, or a context run cursor. Bootstrap and reconnect use the provider-free reader issued by the composition-root `runtime.Host`, validate the canonical `ThreadContextSnapshot`, and map usage plus terminal compaction facts into the response. A pure `/compact` turn with no attachment, context action, structured response, or secret answer receives one run-local `ManualCompactionSource` carrying the stable request identity. That source can be consumed once by the hosted turn; Redeven does not expose a separate idle compaction coordinator, public Host command, receipt, or lifecycle. Canonical operation identity and terminal outcome come only from validated Floret events and context reads.

Run token limits preserve distinct field semantics across the Redeven/Floret boundary. Redeven passes `RunOptions.MaxInputTokens` directly to Floret `TurnLimits.MaxInputTokens`, where it limits cumulative provider input usage across the entire hosted run. `MaxOutputTokens` remains a per-provider-request output ceiling used by Floret context policy and `ModelRequest.MaxOutputTokens`. Redeven does not add input and output limits into a derived `MaxTotalTokens`, and an unset input limit does not create an implicit cumulative token budget.

# Boundaries

Redeven owns model preferences, credentials, gateway selection, and the one-shot `/compact` input mapping. Floret owns provider-visible context, canonical compaction identity and result, and opaque continuation. Live context events and UI usage projections are observations, not durable lifecycle or provider-state authority.

# Evidence

- `redeven:internal/ai/tools/types.go:126` - `ToolPresentationSpec` carries renderer, operation, label, fallback, compact payload, result payload, and activity chip fields.
- `redeven:internal/ai/floret_provider.go:55` - Provider stream deltas are sent to Floret as model events rather than mutating Flower state directly.
- `redeven:internal/ai/floret_events.go:105` - Structured context status observations update only the current Flower stream.
- `redeven:internal/ai/floret_runtime.go:160` - Flower execution runs through Floret hosted turns with a Floret approver, event sink, and dynamic tool surface provider.
- `redeven:internal/ai/floret_manual_compaction.go:18` - Pure `/compact` input creates one run-local manual compaction request.
- `redeven:internal/ai/floret_manual_compaction_test.go:10` - Covers exact command admission and one-shot consumption.
- `redeven:internal/ai/model_gateway.go:37` - Redeven's remaining hard execution protection is the tool-call count constant.
- `redeven:internal/ai/model_gateway.go:3189` - One collision-detecting alias owner maps canonical tool names to OpenAI wire names and back.
- `redeven:internal/ai/model_gateway_openai_tools_test.go:231` - OpenAI response and stream tests prove `terminal.read` round trips through `terminal_read` without leaking the alias.
- `redeven:internal/ai/floret_approval_command_integration_test.go:118` - Published Floret integration proves a missing-description correction executes no handler and creates no current-view tool row.
- `redeven:internal/ai/context_action_floret.go:27` - Redeven formats accepted linked context and attachments into Floret supplemental context.
- `redeven:internal/ai/subagents_floret.go:363` - Subagent hosts reuse the resolved Flower model gateway, Floret tools, approver, event sink, shared Floret thread store, and twenty-minute run timeout.
- `redeven:internal/ai/threads.go:670` - `SetThreadModel` validates product model preferences without managing provider continuation.
- `redeven:internal/ai/service.go:1301` - Turn preparation resolves and binds the effective model before execution.
- `redeven:internal/ai/service.go:1347` - `resolveRunModel` chooses thread, environment, or Desktop model authority and validates capabilities.
- `redeven:internal/ai/send_user_turn.go:145` - Typed send maps the admitted product request into the Floret run boundary.
- `redeven:internal/ai/threadstore/store.go:951` - Threadstore updates `model_id` and `reasoning_selection_json` as the thread default preference.
- `redeven:internal/ai/floret_tools.go:135` - Floret tool invocations validate parent execution identity exactly and use explicit child host context for product child run identity.
- `redeven:internal/ai/desktop_model_source.go:1168` - Desktop model-source capabilities are sanitized to the opaque Desktop provider and model identity.
- `redeven:internal/ai/model_gateway.go:171` - Request serialization emits `parallel_tool_calls:true` only for enabled wire modes.
- `redeven:internal/ai/model_gateway.go:2358` - One resolver owns the provider and endpoint allowlist for that wire mode.
- `redeven:internal/envapp/ui_src/src/ui/flower/envLocalFlowerSurfaceAdapter.ts:288` - The stable Desktop session route gates whether Env App loads and exposes Desktop models.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:1656` - Composer model changes branch on model-source ownership before persisting defaults.
- `redeven:internal/flower_ui/src/contracts/flowerSurfaceContracts.ts:97` - Desktop model-source readiness and failure modes are represented as one strict discriminated union.
