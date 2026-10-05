---
type: AI Runtime Contract
title: Model reasoning capabilities and transport
description: Discover verified reasoning controls, preserve explicit intent, and map thinking output and history to provider protocols.
tags: [ai, models, reasoning, providers]
timestamp: 2026-10-05T00:00:00Z
---
# Summary

Published Floret owns the portable reasoning selection contract, Ollama metadata
parser, and Ollama wire encoding. Redeven maps model metadata, product settings,
and provider requests to that contract. Only verified capabilities create
controls; Default, Off, On, named effort, and token budget retain distinct
meanings. Invalid selections fail before provider dispatch, while unknown
controls retain the model's default behavior. Active Turns keep immutable
settings through continuation and restart.

# Contract

## Capability and transport

OpenAI-compatible Chat reasoning is capability-driven. Redeven computes model capability from the current provider type, model metadata, and [generated model directory](model-directory-and-selection.md) on each resolution; it does not persist a capability cache. Redeven reads only response fields named by that result, emits their fragments as reasoning without trimming provider whitespace, and never treats reasoning-only output as assistant body text. Ollama metadata is parsed by published Floret v7.22.0, and its OpenAI-compatible stream and assistant history use the declared `reasoning` field. OpenRouter declares its response fields only when model metadata advertises reasoning, without inferring effort controls from aggregate parameter support. Generic provider identity never creates a reasoning capability. Qwen Responses preserves explicit On through its documented `enable_thinking` parameter, exact effort levels through `reasoning.effort`, and rejects unsupported token budgets. Assistant reasoning is replayed through provider-specific history fields only when the same capability declares that requirement; unsupported models receive no synthetic reasoning field.

Ollama discovery delegates `/api/show.thinking` parsing and request mapping to
Floret. Names and model families never imply controls. A declaration containing
`false`, `low`, `medium`, and `xhigh` therefore exposes those choices, without
inventing `high`. Default omits the override so the server retains its current
default. A boolean On uses Ollama's OpenAI compatibility encoding; unsupported
selections fail validation before dispatch. Older metadata without `thinking`
and unrecognized model-defined effort names remain model-controlled; a verified
subset of known levels and an explicit disable value can still be offered.

Chat history always serializes an explicit string `content` for a retained
assistant message. A reasoning-only response, including output truncation before
visible text, uses `content: ""` while preserving the declared reasoning field.
Tool calls remain paired with their original results. The adapter must not omit
content, convert reasoning to visible text, or drop the continuation to satisfy
an endpoint's message-shape requirements.

Ollama uses the published Floret v7.25.1
`Capabilities.ReasoningHistory = ReasoningHistoryCurrentUser` projection. Each
new canonical user input stops replaying earlier assistant thinking, which can
contain expired permission and tool assumptions. Historical visible answers,
tool calls/results, and canonical thinking remain intact. Tool continuations,
reasoning-only truncation, and retry after the current input retain reasoning;
ephemeral answers do not start a new boundary. The selected policy is part of
the gateway state compatibility key. Preparation estimates the same projected
payload it sends. Other provider protocols retain their required history policy.
The same published runtime preserves pure-thinking tool-call reasoning once in
each provider continuation, including parallel calls, while retaining the
canonical reasoning journal unchanged.

Qwen, Kimi, and GLM boolean transports advertise explicit On independently of
named effort. Qwen Chat encodes it as `enable_thinking: true`; Kimi and GLM use
`thinking.type: enabled`. An absent or explicit Default selection does not send
an override. Budget-only and fixed-thinking models never acquire synthetic
effort names or a toggle merely because another model supports one.

## Settings ownership

Thread model, reasoning and permission settings are Redeven product state. Model and reasoning changes require an idle mutable thread with no queue or unresolved interaction. Permission changes apply at the next tool authorization boundary, including active, queued and resumed work. Execution authority records admission permission for historical attribution only, never as live tool authorization. The atomic v9-to-v10 migration and all earlier edges remain unchanged. `SendUserTurn.Model` and Ask User continuation `Model` may be empty or equal the persisted value; a mismatch is a conflict. The configured `current_model_id` initializes future threads only.

## Automatic titles

Published Floret v7.22.1 owns title reasoning and output limits. Title requests
disable thinking when the resolved capability permits it; otherwise they use
the supported short-request effort or retain the model default. They never
change the thread's saved reasoning choice or the main response policy.

Provider output limits count hidden reasoning as well as visible text. Floret
therefore allows up to 1,024 output tokens when reasoning cannot be disabled or
its controls are unknown. Explicit non-reasoning and disable-capable models
retain the 64-token limit. Visible titles still contain at most 48 Unicode
characters; reasoning fragments never become the title. Truncation leaves title
generation failed and preserves the initial user-request title. The next
accepted user turn retries a failed automatic title, including after restart;
reopening alone does not issue a provider request. The
[live timeline contract](../ui/flower-live-timeline.md) owns canonical title
status, persistence, and workspace-summary presentation.

# Boundaries

The same capability and selection reach direct Environment models and Desktop
model-source RPC. A model rename never changes its declared control type.
The [Flower reasoning selection contract](../ui/flower-reasoning-selection.md)
owns labels, draft intent, remounts, and mutually exclusive UI controls. The
[Runtime snapshot contract](../architecture/runtime-service-snapshot.md)
owns epoch 35 pairing for the additive `on` selection. Existing database
migration lineages remain unchanged.

# Evidence

- `redeven:internal/config/ai_reasoning_catalog.go` - Thin published-Floret metadata mapping and explicit OpenRouter metadata contract.
- `redeven:internal/ai/model_catalog.go` - Read-only discovery from declared capabilities.
- `redeven:internal/ai/model_gateway.go` - Provider request, stream, and approved history-field mapping.
- `redeven:internal/ai/floret_reasoning.go` - Published replay policy selection for Ollama.
- `redeven:internal/ai/model_gateway_ollama_reasoning_test.go` - Exact declared choices, thinking stream/history, and opt-in live acceptance.
- `redeven:internal/ai/model_gateway_reasoning_test.go` - Boolean, effort, and budget contracts across provider transports.
- `redeven:internal/ai/desktop_model_source_test.go` - Capability metadata survives Desktop model-source RPC.
- `redeven:internal/ai/thread_reasoning_restart_test.go` - Saved On and Off survive reopening and immutable continuation.
- `redeven:internal/ai/thread_title_ollama_test.go` - Capability-aware title output, independent main reasoning, live summaries, restart, failed-title retry, and opt-in real Ollama acceptance.
- [Ollama thinking metadata](https://docs.ollama.com/capabilities/thinking) and [OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility) - Declared values and Chat wire encoding.
- [Qwen Responses API](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-responses) - Explicit enable, effort, and unsupported budget boundary.
