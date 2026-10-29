---
type: AI Provider Contract
title: DeepSeek Responses
tags: [ai, provider, deepseek]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Flower routes the DeepSeek provider to the published Floret v7.66.1 Responses gateway.
Floret owns `/responses` rendering, SSE parsing, reasoning, usage normalization,
function-call validation, and opaque provider history. Redeven only maps its
model DTOs and canonical dotted tool names to provider-safe aliases.

# Contract

Each request sends full input history. The route never sends `messages`, `enable_search`, `previous_response_id`, `store`, or `include`.

Floret owns public-URL checks, cancellation, redirect restrictions, response limits, sanitization and tool Activity.

## Model-specific image input
DeepSeek Vision is enabled by the selected model's `input_modalities`, just like vision models on other providers. Text-only models reject images.

Redeven passes opaque state through without interpreting it or maintaining an image/history mirror.

# Boundaries

Floret owns raw response items, including reasoning and historical opaque search results. Supplemental-context Turns retain Floret's no-state privacy boundary: canonical conversation still replays, but ephemeral host context never becomes provider continuation state. Reading that history is separate from declaring new search tools; canonical records are not rewritten when the current capability is corrected.

# Evidence

- `redeven:internal/ai/model_gateway_deepseek.go` - Thin released-gateway adapter.

- `redeven:internal/ai/floret_runtime.go` - Catalog-owned Turn tool surface.
