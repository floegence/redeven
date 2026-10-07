---
type: AI Runtime Contract
title: AI model and context runtime
description: Model-source ownership, provider mapping, token limits, context usage, and compaction contracts.
tags: [ai, models, context, providers]
timestamp: 2026-10-08T00:00:00Z
quality_exception: Unified model-context contract linking provider mapping, immutable provider checkpoints, usage accounting, compaction, and Desktop source compatibility.
---
# Summary

Redeven persists product model and reasoning preferences, provider credentials, and model-source selection, while Floret owns provider-visible context and opaque continuation state. Environment and Desktop model sources remain distinct, context and compaction presentation come from typed Floret observations, and input/output token limits preserve their separate meanings. Product configuration updates merge permission and model state without overwriting unrelated settings.

# Contract

## Mechanism

Model reasoning capability, stream fields, history replay, and immutable thread settings are governed by [model reasoning capabilities and transport](model-reasoning-runtime.md).

Flower configuration has three independent states. The default `permission_type` is valid without model configuration and initializes only future threads. An environment `AIModelProfile` requires a provider registry plus a valid `current_model_id`. A Desktop source is a separate runtime catalog exposed only for the exact `remote_desktop` route. Its strict status union distinguishes ready, empty, missing-key, binding, unsupported, and error states; only `desktop_model_source` entries with opaque `desktop:model_<64 lowercase hex>` ids enter the ready catalog. The environment profile remains the persisted new-chat default. Desktop selection changes only the mounted new-chat draft or selected thread, so remount restores the environment default. `AIConfig.HasModelProfile()` is the sole environment-profile predicate. Permission and provider updates merge under the service lock, preserving unrelated settings, and generic settings updates do not accept `ai`.

Provider adapters are model gateways, not Flower renderers or lifecycle stores. `floretProviderAdapter` directly maps typed Floret messages and provider stream bytes, including `PreviousState` and `ResponseState`, without grouping, repairing, deduplicating, or reordering the Floret contract. Assistant text, reasoning deltas, and model-generated tool-call stream observations are emitted as provider-neutral Floret model events before Redeven projects them into Flower live state. Floret persists opaque response state internally after journal finalization and reloads it only when the journal leaf and non-sensitive gateway compatibility key match. Redeven computes that key from provider id/type, normalized endpoint, wire model, and transport route; it stores no continuation envelope or matching fields.

Desktop model-source RPC forwards the complete opaque `PreviousState` and returned provider state without interpreting the underlying provider. The actual provider transport is the only state interpreter: DeepSeek delegates native history validation and rendering to published Floret, Gemini validates tool signatures, and OpenAI Responses renders its response ID at the wire boundary. Unsupported transports reject non-empty state before HTTP. There is no separate response-ID control channel or host-owned continuation store. Prepared requests freeze a copy of the state along with their input.

Provider usage is normalized once at the model-gateway boundary into disjoint uncached input, cache-read input, cache-write input, output, and reasoning fields. OpenAI-compatible total input is reduced by its validated cache-read detail; DeepSeek Responses subtracts `input_tokens_details.cached_tokens` and separates `output_tokens_details.reasoning_tokens` from inclusive output; Anthropic cache read and cache creation map directly. Missing cache detail means zero cache use, while negative or contradictory counts fail closed. Desktop model-source RPC transports the same normalized shape, so local and SSH routes have identical accounting.

Tool names use one dotted canonical vocabulary across Redeven definitions, Floret, canonical history, current views, and Flower presentation; `terminal.read` and `terminal.exec` never acquire underscore-form canonical aliases. OpenAI-compatible request serialization builds one bidirectional alias table from the current tool definitions and canonical continuation history, rejects collisions, and uses that same table for definitions, historical calls/results, streamed call events, and final ToolCalls. A wire-only name such as `terminal_read` is translated back before any event enters Floret, while an unregistered response name fails at the gateway without emitting a tool event. Anthropic receives canonical dotted names directly. Published Floret v7.25.2 persists schema-invalid calls and ordered validation results in canonical history and gives the model at most two regeneration attempts; invalid calls never dispatch handlers or create Flower tool-failure rows. UI filtering does not change that history. Redeven keeps `terminal.read.description` required rather than weakening the schema to avoid correction.

Final model-gateway ToolCalls also use one completeness rule across direct providers and Desktop model-source RPC: id, canonical name, and a present JSON argument object are required. Empty objects remain explicit `{}` on the wire; omitted or `null` arguments are invalid. The Desktop connector validates before encoding, the runtime validates after decoding, and the Floret adapter reuses the same validator before mapping. No boundary infers empty arguments, invents ids, drops malformed calls, or executes a partial call.

Provider tool-call generation has a private `omit` or `enable` wire mode. `enable` serializes `parallel_tool_calls:true`; it allows a provider model to return more than one call but does not require the model to do so and is never read by the executor. Redeven enables it only for known HTTPS official OpenAI Responses/Chat, Qwen DashScope, OpenRouter, xAI, and Groq endpoints. Anthropic, DeepSeek, Moonshot, ChatGLM, Ollama, generic `openai_compatible`, Desktop opaque sources, proxies, and custom base URLs omit the field. No request path sends a false value. Hosted-turn diagnostics record the selected wire mode, and Floret lifecycle audit events carry batch index, batch size, event type, and observation time so operators can distinguish model serialization, provider single-call output, approval wait, dispatch, and completion without feeding diagnostics back into scheduling.

## Related provider history

Provider-visible history, render lineage, and unavailable-tool continuity are owned by [Model provider surface and history](model-provider-surface-and-history.md).

## Related context usage

Usage accounting, context pressure, compaction, token budgets, and capacity failures are owned by [Model context usage and compaction](model-context-usage-and-compaction.md).

# Boundaries

Redeven owns model preferences, credentials, gateway selection, and the one-shot `/compact` input mapping. Floret owns provider-visible context, canonical compaction identity and result, and opaque continuation. Live context events and UI usage projections are observations, not durable lifecycle or provider-state authority.

# Evidence

- `redeven:internal/ai/floret_provider.go:55` - Provider stream deltas are sent to Floret as model events rather than mutating Flower state directly.
- `redeven:internal/ai/floret_runtime.go` - Flower creates each new hosted Agent from the current System Prompt, tools, model, reasoning, and context policy.
- `redeven:internal/ai/prompt_builder.go` - Stable persona, policy, and capability System Prompt without mutable objective or runtime overlays.
- `redeven:internal/ai/prompt_workspace_context.go` - Mutable environment facts are accepted as one durable per-turn context snapshot.
- `redeven:internal/ai/floret_bootstrap.go` - Restart work uses Floret's exact canonical Turn input instead of the current continuation input.
- `redeven:internal/ai/model_gateway.go:37` - Redeven's remaining hard execution protection is the tool-call count constant.
- `redeven:internal/ai/model_gateway.go:3189` - One collision-detecting alias owner maps canonical tool names to OpenAI wire names and back.
- `redeven:internal/ai/model_gateway_result.go:36` - One result validator enforces complete final ToolCalls without changing partial stream semantics.
- `redeven:internal/ai/model_gateway_usage.go:12` - One provider-usage boundary validates and normalizes disjoint cache token buckets.
- `redeven:internal/ai/model_gateway_openai_tools_test.go:231` - OpenAI response and stream tests prove `terminal.read` round trips through `terminal_read` without leaking the alias.
- `redeven:internal/ai/floret_approval_command_integration_test.go:118` - Published Floret integration proves a missing-description correction executes no handler and creates no current-view tool row.
- `redeven:internal/ai/threads.go:912` - `SetThreadModel` validates and persists idle-thread model and normalized reasoning selection.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Model and reasoning share the busy lock; permissions have independent loaded, writable, adapter, and pending checks.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.decisionSurface.browser.test.tsx` - Browser coverage proves active permission changes, pending protection, rollback, model/reasoning locks, and preservation of newer canonical interactions.
- `redeven:internal/ai/desktop_model_source.go:1168` - Desktop model-source capabilities are sanitized to the opaque Desktop provider and model identity.
- `redeven:internal/ai/model_gateway.go:171` - Request serialization emits `parallel_tool_calls:true` only for enabled wire modes.
- `redeven:internal/ai/model_gateway.go:2358` - One resolver owns the provider and endpoint allowlist for that wire mode.
- `redeven:internal/ai/context/adapter/capability.go` - Pure capability resolution from current provider and model metadata.
- `redeven:internal/envapp/ui_src/src/ui/flower/envLocalFlowerSurfaceAdapter.ts:288` - The stable Desktop session route gates whether Env App loads and exposes Desktop models.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:1656` - Composer model changes branch on model-source ownership before persisting defaults.
- `redeven:internal/flower_ui/src/contracts/flowerSurfaceContracts.ts:97` - Desktop model-source readiness and failure modes are represented as one strict discriminated union.
