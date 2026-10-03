---
type: Provider Compatibility Review
title: Provider API and catalog review
description: Match the shipped model catalog to official APIs, regional endpoints, and released adapter capabilities.
tags: [ai, models, providers, compatibility]
timestamp: 2026-10-03T00:00:00Z
---

# Summary

Redeven owns one model catalog shared by Runtime, Web, Desktop, and the native iOS client through the authenticated catalog API. Official provider documentation establishes model identities, API contracts, and capability corrections; the pinned models.dev snapshot supplies reproducible inventory metadata. A model must be supported by the released adapter before it becomes selectable. Catalog refreshes preserve user selections and never replace a conversation's stored model. Unsupported engine capabilities remain explicit integration blockers.

# Reviewed APIs

The 2026-10-03 review covers all existing provider types. Token ceilings describe provider capacity, not a request to increase user budgets. Audio, video, embeddings, and restricted-access specialized models are outside the default Agent directory.

| Provider | Current public Agent models reviewed | Runtime route and constraints |
| --- | --- | --- |
| OpenAI | GPT-6 Astra, GPT-6.1 Sol, GPT-6 Sol, GPT-6 Luna | `/v1/responses`; function tools for GPT-6.1 Sol require Responses. Sol/Luna permit `none`; 6.1 Sol and Astra do not. 1,050,000 context and 128,000 output tokens. |
| Anthropic | Claude Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 4.5 | `/v1/messages`, API version `2023-06-01`; SDK base is the origin without `/v1`. Opus/Sonnet 5.5 use adaptive thinking with effort, reject manual budgets and `disabled`, and expose 1M context / 128K output. |
| Google | Gemini 3.8 Flash | Supported `/v1beta/openai/chat/completions` with model-specific effort/budget settings and opaque tool thought signatures. Existing directory already includes the current model. |
| DeepSeek | `deepseek-flash` (V4.1 Flash), `deepseek-v4-pro` | Published Floret v7.19.0 accepts the new name through `/responses`; Flash and both official aliases support images, while Pro is text-only. All support off/low/high/max and a 393,216-token output ceiling. Built-in search remains ignored by the provider. |
| Qwen | Qwen3.8 Max, Flash, Omni Flash | `/compatible-mode/v1/chat/completions`; existing qualified search models use Responses. New Omni Flash is text output with tools and text/image input in Redeven. Qwen3.7 Max/Plus output ceilings rise to 131,072. |
| Moonshot | Kimi K3, K2.7 Code, K2.6 | `/v1/chat/completions`; K3 requires thinking, supports low/high/max, and accepts `max_completion_tokens` up to 1,048,576 (provider default 131,072). Search for K3 remains unintegrated. |
| Z.ai | GLM-5.3, GLM-5.3-Flash/FlashX | `/api/paas/v4/chat/completions`; FlashX has 1M context and 128K output, forced thinking with low/high/max. The persisted provider type stays `chatglm`; display branding is Z.ai. |
| xAI | Grok 4.7 | Existing `/v1/chat/completions` is still supported but marked legacy. Responses is the supplier's preferred API for new features. 4.7 supports low/medium/high/xhigh, defaults to high, and cannot disable thinking. |
| Groq | GPT-OSS 120B/20B and Qwen3.8-27B | `/openai/v1/chat/completions`; preview status stays explicit. Existing catalog is current. |
| OpenRouter | Dynamic provider inventory | Discover tool-capable models from `/api/v1/models`; preserve explicit user selection. |
| Ollama | Installed local inventory | `/api/tags`, `/api/ps`, `/api/show`, then `/v1/chat/completions`; serving context and tools must be discovered. |
| Custom compatible | User-defined models | Retain explicit endpoint, token limits, and capability configuration. |

# Contract

The generated catalog must include only models that have a released adapter, a reviewed endpoint and capability contract, positive provider limits, and a web-search declaration. Catalog metadata is authoritative for selectable model identity and user-visible status. Provider credentials, workspace IDs, regional endpoint choice, and per-thread model selection remain user-owned state. A new supplier model remains unavailable until the released upstream adapter and its replay, tool, image, and reasoning contracts are qualified.

## Endpoint compatibility

Anthropic's SDK appends `v1/messages`. New presets use `https://api.anthropic.com`. The adapter accepts previously saved bases ending in `/v1` or `/v1/` by removing only that terminal version before SDK construction, preserving any proxy path prefix. The original configuration is not rewritten. This prevents `/v1/v1/messages` without changing credential or host selection.

Qwen now recommends workspace-specific regional domains, for example `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1` for Singapore and `{WorkspaceId}.cn-beijing.maas.aliyuncs.com` for Beijing. Workspace identity and the API key's region are user-owned inputs. Preserve existing configured bases; never save the literal template or silently move a key between regions. The documented legacy Singapore base remains the existing preset while users can supply the new workspace URL. Native iOS settings link to official provider documentation for this choice.

## Published-engine adoption

Floret v7.19.0 was released before Redeven adopted it, with independent blank-module
adoption and module checksums verified. Its `provider.NewDeepSeek` accepts
`deepseek-flash` and the expanded Pro reasoning/output capabilities. Redeven uses
the published module with `GOWORK=off`; no sibling dependency or transport copy
bypasses the upstream boundary.

The supplier still accepts `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp`
as aliases for V4.1 Flash. Explicit overrides retain those identities, label
them as legacy aliases, and align image/effort/output capabilities with the
published engine. Existing conversations keep their selected ID and opaque
state identity. No automatic model substitution occurs. All four models keep
native search unsupported.

Daybreak Blue/Red require separate OpenAI approval and provisioning and therefore remain outside the public default catalog. New catalog entries receive an explicit search review; supplier search support does not imply an implemented or qualified Redeven search adapter.

# Boundaries

Runtime owns provider routing and the catalog projection. Floret owns provider-native request construction, opaque continuation state, and released model capability definitions. The iOS client consumes the authenticated projection and links to official configuration documentation; it does not embed a second supplier inventory or implement provider transports. `models.dev` is a reproducible directory input, not an authority to bypass official docs or released adapter support.

# Evidence

- `redeven:scripts/model-catalog/upstream.json` - Pinned models.dev response projection and original response SHA-256.
- `redeven:scripts/model-catalog/overrides.json` - Official-source corrections, search declarations, exclusions, and review dates.
- `redeven:internal/ai/model_gateway.go` - Provider routing and Anthropic base normalization.
- [Floret v7.19.0](https://github.com/floegence/floret/releases/tag/v7.19.0) - Published upstream catalog and DeepSeek support.
- `redeven:internal/ai/model_gateway_deepseek_test.go` - New Flash, aliases, Pro reasoning, image continuation, and historical search replay against the released gateway.
- `redeven:internal/ai/model_gateway_anthropic_integration_test.go` - Exact Messages path assertion for saved versioned bases.
- [OpenAI models](https://developers.openai.com/api/docs/models) and [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol).
- [Claude model overview](https://platform.claude.com/docs/en/models/overview) and [thinking configuration](https://platform.claude.com/docs/en/build-with-claude/thinking).
- [Gemini models](https://ai.google.dev/gemini-api/docs/models) and [OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai).
- [DeepSeek models and pricing](https://api-docs.deepseek.com/quick_start/pricing) and [Responses API](https://api-docs.deepseek.com/guides/responses_api/).
- [Qwen compatibility](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope), [Omni Flash](https://www.alibabacloud.com/help/en/model-studio/qwen3-8-omni-flash), and [thinking](https://www.alibabacloud.com/help/en/model-studio/deep-thinking).
- [Kimi models](https://platform.kimi.com/docs/models) and [K3 limits](https://platform.kimi.com/docs/guide/kimi-k3-quickstart).
- [GLM-5.3 Flash/FlashX](https://docs.z.ai/guides/vlm/glm-5.3-flash) and [GLM thinking](https://docs.z.ai/guides/capabilities/thinking-mode).
- [Grok 4.7](https://docs.x.ai/developers/models/grok-4.7) and [legacy Chat Completions](https://docs.x.ai/developers/model-capabilities/legacy/chat-completions).
- [Groq models](https://console.groq.com/docs/models), [OpenRouter models](https://openrouter.ai/docs/guides/overview/models), and [Ollama compatibility](https://docs.ollama.com/api/openai-compatibility).
