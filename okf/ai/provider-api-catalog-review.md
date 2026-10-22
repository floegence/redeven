---
type: Provider Compatibility Review
title: Provider API and catalog review
description: Match the shipped model catalog to official APIs, regional endpoints, and released adapter capabilities.
tags: [ai, models, providers, compatibility]
timestamp: 2026-10-12T00:00:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns one model catalog shared by Runtime, Web, Desktop, and the native iOS client through the authenticated catalog API. Official provider documentation establishes model identities, API contracts, and capability corrections; the pinned models.dev snapshot supplies reproducible inventory metadata. A model must be supported by the released adapter before it becomes selectable. Catalog refreshes preserve user selections and never replace a conversation's stored model. Unsupported engine capabilities remain explicit integration blockers.

# Contract

The 2026-10-12 review covers all existing provider types. Audio, video, embeddings, and restricted-access specialized models are outside the default Agent directory.

| Provider | Current public Agent models reviewed | Runtime route and constraints |
| --- | --- | --- |
| OpenAI | GPT-6 Astra, GPT-6.1 Sol, GPT-6 Sol, GPT-6 Luna | `/v1/responses`; function tools for GPT-6.1 Sol require Responses. Sol/Luna permit `none`; 6.1 Sol and Astra do not. 1,050,000 context and 128,000 output tokens. |
| Anthropic | Claude Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5 and 4.5 | `/v1/messages`, API version `2023-06-01`; SDK base is the origin without `/v1`. Opus/Sonnet 5.5 use adaptive thinking with effort, reject manual budgets and `disabled`, and expose 1M context / 128K output. |
| Google | Gemini 3.8 Flash | Supported `/v1beta/openai/chat/completions` with model-specific effort/budget settings and opaque tool thought signatures. Existing directory already includes the current model. |
| DeepSeek | `deepseek-flash` (V4.1 Flash), `deepseek-v4-pro` | The published Floret v7.79.0 Responses gateway accepts the new name; the capability was introduced and qualified in v7.19.0. Flash and both official aliases support images, while Pro is text-only. All support off/low/high/max and a 393,216-token output ceiling. Built-in search remains ignored by the provider. |
| Qwen | Qwen3.8 Max, Flash, Omni Flash | `/compatible-mode/v1/chat/completions`; existing qualified search models use Responses. New Omni Flash is text output with tools and text/image input in Redeven. Qwen3.7 Max/Plus output ceilings rise to 131,072. |
| Moonshot | Kimi K3, K2.7 Code, K2.6 | `/v1/chat/completions`; K3 requires thinking, supports low/high/max, and accepts `max_completion_tokens` up to 1,048,576 (provider default 131,072). Search for K3 remains unintegrated. |
| Z.ai | GLM-5.3, GLM-5.3-Flash/FlashX | `/api/paas/v4/chat/completions`; FlashX has 1M context and 128K output, forced thinking with low/high/max. The persisted provider type stays `chatglm`; display branding is Z.ai. |
| xAI | Grok 4.7 | Existing `/v1/chat/completions` is still supported but marked legacy. Responses is the supplier's preferred API for new features. 4.7 supports low/medium/high/xhigh, defaults to high, and cannot disable thinking. |
| Groq | GPT-OSS 120B/20B and Qwen3.8-27B | `/openai/v1/chat/completions`; preview status stays explicit. Existing catalog is current. |
| OpenRouter | Dynamic provider inventory | Discover tool-capable models from `/api/v1/models`; preserve explicit user selection. |
| Ollama | Installed local inventory | `/api/tags`, `/api/ps`, `/api/show`, then `/v1/chat/completions`; serving context and tools must be discovered. |
| Custom compatible | User-defined models | Retain explicit endpoint, token limits, and capability configuration. |

The generated catalog must include only models that have a released adapter, a reviewed endpoint and capability contract, positive provider limits, and a web-search declaration. A new supplier model remains unavailable until the released upstream adapter and its replay, tool, image, and reasoning contracts are qualified.

## October catalog refresh
The Floret and Redeven refresh uses the same raw models.dev response, SHA-256 `a6af79756a8a8efb5fd3144a83bd01f333e503043998d5f26f3c98bf9181d36c`. [ChatGPT plan authentication](chatgpt-local-authentication.md) discovers the account-specific listed inventory and intersects these reviewed capabilities.

## Endpoint compatibility
Anthropic's SDK appends `v1/messages`.

Preserve existing configured bases; never save the literal template or silently move a key between regions. Native iOS settings link to official provider documentation for this choice.

## Published-engine adoption
Redeven currently consumes published Floret v7.79.0 with `GOWORK=off`; no sibling dependency or transport copy bypasses the upstream boundary.

New catalog entries receive an explicit search review; supplier search support does not imply an implemented or qualified Redeven search adapter.

# Boundaries

Runtime owns provider routing and the catalog projection. `models.dev` is a reproducible directory input, not an authority to bypass official docs or released adapter support.

## Runtime inventory synchronization
The Runtime uses native Anthropic and Google list authentication/pagination and OpenAI-compatible inventories for supported brands. Unknown identities require explicit adapter-supported capability configuration. See [Model directory and selection](model-directory-and-selection.md) for ownership, deadlines, and scope isolation.

# Evidence

- `redeven:scripts/model-catalog/upstream.json` - Pinned models.dev response projection and original response SHA-256.

- `redeven:scripts/model-catalog/overrides.json` - Official-source corrections, search declarations, exclusions, and review dates.

- `redeven:internal/ai/model_gateway.go` - Provider routing and Anthropic base normalization.
