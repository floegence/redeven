---
type: AI Configuration Contract
title: Provider configuration validation
description: Apply provider-specific optional fields and reject incomplete model configurations before saving.
tags: [ai, providers, credentials, settings]
timestamp: 2026-10-05T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns provider configuration, credential requirements, and Flower readiness. Ollama and custom OpenAI-compatible endpoints can send without a stored key; other local-profile providers require one. All settings entrypoints and the provider-bundle API enforce configuration completeness without inventing stored secrets. Invalid saves leave configuration and credentials unchanged; network or authentication failures remain execution errors. Floret's published thread-runtime contract is unchanged.

# Contract

## Readiness and saving
The shared Flower composer follows the same credential contract as provider execution: a selected Ollama inventory model or configured OpenAI-compatible model can start or continue a conversation without a stored API key. Credential snapshots report actual secret presence; readiness must not manufacture a configured secret or bypass catalog membership.

Unknown discovered models require explicit capabilities before they become runnable.

## Field requirements
| Field | Required value or omission behavior |
| --- | --- |
| Provider API key | Optional for Ollama and custom OpenAI-compatible endpoints; all other local-profile provider types require a new or stored key. Desktop and Redeven AI model sources retain their separate session authority. |
| Base URL | OpenAI, Anthropic, and Gemini may use their adapter default. Other provider types require an explicit HTTP(S) URL. |
| Provider display name | Optional; the UI derives a name from the provider type or identity. |
| Models | Explicit lists require named models; catalog providers save explicit `selected_models`, including an empty selection after deselecting all models. Unresolved legacy exclusion profiles require selection review; unavailable selected identities retain their metadata without requiring invented capacity. |
| Context and output limits | Published catalog or adapter defaults may supply omitted limits. Explicit compatible, OpenRouter, xAI, Groq, and Ollama model entries require context capacity. Custom catalog models also require it. Reviewed models retain their established optional output limits; unknown discovered models require explicit context, output, and tools capability. |
| Brave API key | Required only when Brave search is enabled; existing stored credentials satisfy the requirement. |

# Boundaries

The [model directory](model-directory-and-selection.md) owns catalog discovery and selected-model membership. Existing malformed or externally edited configurations still receive defensive runtime checks; provider-bundle saves must not create a newly incomplete profile.

Secret patches remain separate from model profiles.

# Evidence

- `redeven:internal/config/ai.go` - Structural validation and optional authentication contract.

- `redeven:internal/ai/model_gateway_optional_key_test.go` - Streamed requests preserve explicit endpoint credentials and omit authentication when absent, even with host credentials set.

- `redeven:internal/ai/provider_adapter.go` - Runtime credential resolution preserves optional keys and read failures.
