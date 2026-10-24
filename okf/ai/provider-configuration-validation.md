---
type: AI Configuration Contract
title: Provider configuration validation
description: Apply provider-specific optional fields and reject incomplete model configurations before saving.
tags: [ai, providers, credentials, settings]
timestamp: 2026-10-05T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-24"
---
# Summary

Redeven owns configuration, credentials and Flower readiness. Floret's public runtime contract is unchanged. Invalid saves preserve configuration and credentials; authentication/network failures remain execution errors.

# Contract

## Readiness and saving
All settings entrypoints and provider-bundle saves enforce the same completeness rules. Readiness reflects actual stored secrets and selected catalog membership. Ollama and custom compatible endpoints may run without a key. Unknown discovered models need explicit capabilities.

| Field | Rule |
| --- | --- |
| API key | Required for local providers except Ollama/custom compatible. Desktop and Redeven AI sources retain separate session authority. |
| Base URL | Optional adapter default for OpenAI/Anthropic/Gemini; explicit HTTP(S) otherwise. |
| Display name | Optional; derive from provider type/identity. |
| Models | Explicit named list or selected_models, including empty selection. Legacy exclusion profiles require review. Preserve unavailable selections without inventing capacity. |
| Limits | Published defaults may supply omitted limits. Explicit compatible/OpenRouter/xAI/Groq/Ollama models and custom catalog entries require context. Unknown discoveries require context, output and tools capability; reviewed models retain optional output limits. |
| Brave key | New or stored key required when Brave search is enabled. |

## Kimi Code
The kimi_code provider uses its own subscription key and official China/global coding endpoint. Admit only six reviewed model/wire identities, capacity ceilings and reasoning levels. An explicit 1M override is user intent, not entitlement evidence. Preparation rejects unknown IDs, thinking-off and response-ID continuation before dispatch.

# Boundaries

[Model directory](model-directory-and-selection.md) owns discovery/membership. Runtime defensively checks externally edited profiles; saves must not introduce incomplete ones. Secret patches remain separate from profiles.

# Evidence

- redeven:internal/config/ai.go - Validation/authentication.
- redeven:internal/config/kimi_code_test.go - Endpoint, identity, capacity and reasoning bounds.
- redeven:internal/ai/model_gateway_optional_key_test.go - Explicit keys and keyless requests ignore ambient credentials.
- redeven:internal/ai/provider_adapter.go - Shared credential resolution and read failures.
