---
type: AI Configuration Contract
title: Provider configuration validation
description: Apply provider-specific optional fields and reject incomplete model configurations before saving.
tags: [ai, providers, credentials, settings]
timestamp: 2026-10-04T00:00:00Z
---

# Summary

Redeven owns provider configuration, credential requirements, and Flower readiness. Ollama and custom OpenAI-compatible endpoints can send without a stored key; other local-profile providers require one. Both editors and the provider-bundle API enforce configuration completeness without inventing stored secrets. Invalid saves leave configuration and credentials unchanged; network or authentication failures remain execution errors. Floret's published thread-runtime contract is unchanged.

# Contract

## Readiness and saving

The shared Flower composer follows the same credential contract as provider execution: a selected Ollama inventory model or configured OpenAI-compatible model can start or continue a conversation without a stored API key. Other local-profile provider types require their configured key. Credential snapshots report actual secret presence; readiness must not manufacture a configured secret or bypass catalog membership. Explicit optional credentials still apply to discovery and execution. Without a key, these endpoints receive no Authorization header and never inherit the host process OpenAI API key. An endpoint that requires authentication still needs its real credential; rejection by that endpoint remains an execution error.

Both provider editors block saving missing required credentials and identify the missing key. The provider-bundle API validates the resulting credential state before changing configuration or secrets, including retained credentials, replacements, explicit deletion, and the last update when a key appears more than once. Blank editor inputs preserve stored keys. Required keys cannot be removed while saving an enabled provider; an optional endpoint key can be removed. A missing Brave key blocks saving a provider with Brave search enabled, but does not disable ordinary chat for a previously saved profile. Invalid structural fields also reject the bundle before writes. These checks validate configuration completeness, not remote service reachability or credential validity.

## Field requirements

| Field | Required value or omission behavior |
| --- | --- |
| Provider API key | Optional for Ollama and custom OpenAI-compatible endpoints; all other local-profile provider types require a new or stored key. Desktop and Redeven AI model sources retain their separate session authority. |
| Base URL | OpenAI, Anthropic, and Gemini may use their adapter default. Other provider types require an explicit HTTP(S) URL. |
| Provider display name | Optional; the UI derives a name from the provider type or identity. |
| Models | Explicit lists require named models; catalog preferences retain their existing selection semantics, including deselecting all models without deleting the provider. |
| Context and output limits | Published catalog or adapter defaults may supply omitted limits. Explicit compatible, OpenRouter, xAI, Groq, and Ollama model entries require context capacity. Custom catalog models also require it. Output limits remain optional. |
| Brave API key | Required only when Brave search is enabled; existing stored credentials satisfy the requirement. |

# Boundaries

The [model directory](model-directory-and-selection.md) owns catalog discovery and selected-model membership. This contract governs configuration completeness only. It does not add a background connection probe, change transport protocols, or require optional display names and output limits. Existing malformed or externally edited configurations still receive defensive runtime checks; provider-bundle saves must not create a newly incomplete profile. Independent credential revocation remains available and may make an existing profile unavailable until a key is restored.

The Go configuration package owns the optional-key policy used by provider execution, Desktop model-source publication, and bundle validation. The lightweight Flower credential policy is shared by the composer and both product editors, without importing the full model catalog into the initial UI bundle. Secret patches remain separate from model profiles.

# Evidence

- `redeven:internal/config/ai.go` - Structural validation and optional authentication contract.
- `redeven:internal/ai/model_gateway_optional_key_test.go` - Streamed requests preserve explicit endpoint credentials and omit authentication when absent, even with host credentials set.
- `redeven:internal/ai/provider_adapter.go` - Runtime credential resolution preserves optional keys and read failures.
- `redeven:internal/codeapp/appserver/provider_credentials.go` - Validates final credential presence before bundle writes.
- `redeven:internal/codeapp/appserver/server_provider_credentials_test.go` - Save acceptance and unchanged configuration and secrets on rejection.
- `redeven:internal/flower_ui/src/providerCredentials.ts` - Shared product readiness and editor credential policy.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.providerReadiness.test.shared.tsx` - New and existing chat sending in DOM and browser tests.
- `redeven:internal/envapp/ui_src/src/ui/pages/settings/FlowerProviderDialog.test.tsx` - Shared editor credential requirements.
- `redeven:internal/envapp/ui_src/src/ui/pages/settings/AIProviderDialog.test.tsx` - Environment editor credential requirements.
