---
type: AI Provider Contract
title: DeepSeek Responses
description: Flower consumes Floret stateless Responses transport and native search.
tags: [ai, provider, deepseek]
timestamp: 2026-09-08T00:00:00Z
---

# Summary

Flower routes the DeepSeek provider to the published Floret v7.3.2 Responses gateway.
Floret owns `/responses` rendering, SSE parsing, reasoning, usage normalization,
function-call validation, and opaque provider history. Redeven only maps its
model DTOs and canonical dotted tool names to provider-safe aliases.

# Contract

Each request sends full input history. The route never sends `messages`,
`enable_search`, `previous_response_id`, `store`, or `include`. Reasoning off maps
to `reasoning.effort: none`; the selectable high and max levels keep their
existing model-catalog contract.

Native search is declared in the Agent tool surface and sent as `web_search`.
Hosted search events and citation sources flow through Floret observation;
search is never dispatched as a local tool. The current conversation and
history retain a typed hosted search item, including queries, safe sources, and
failed outcomes. Refresh and Runtime restart preserve this canonical activity;
Redeven does not rebuild it from transport diagnostics. Short requests such as automatic
titles have no hosted search surface and cannot initiate a search.

# Boundaries

Floret owns raw response items, including reasoning and opaque search results.
The host passes state through without interpreting or reconstructing it. Model
or surface changes invalidate continuation through the existing compatibility
boundary. Supplemental-context Turns retain Floret's no-state privacy boundary:
canonical conversation still replays, but ephemeral host context never becomes
provider continuation state. There is no host history mirror or Chat fallback.

# Evidence

- `redeven:internal/ai/model_gateway_deepseek.go` - Thin released-gateway adapter.
- `redeven:internal/ai/floret_provider.go` - Opaque state and request tool surface.
- `redeven:internal/ai/floret_runtime.go` - Agent hosted search declaration.
- `redeven:internal/ai/model_gateway_deepseek_test.go` - Native search, alias replay, and title isolation.
- `redeven:internal/ai/thread_model_switch_integration_test.go` - Turn surface switching and replay.
- [Official Responses guide](https://api-docs.deepseek.com/guides/responses_api/)
- [Model and context runtime](model-context-runtime.md)
