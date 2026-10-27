---
type: Provider Compatibility Review
title: Provider API and catalog review
description: Match the shipped model catalog to official APIs, regional endpoints, and released adapter capabilities.
tags: [ai, models, providers, compatibility]
timestamp: 2026-10-12T00:00:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-24"
---
# Summary

Runtime, Web, Desktop and iOS share one authenticated catalog. Official contracts and pinned models.dev inventory require released adapters and qualified limits, replay, tools, images and reasoning. Refreshes preserve configured model selections and stored conversation identities.

# Contract

Baseline review: October 12; Kimi update: October 24. Audio, video, embeddings and restricted models remain excluded.

| Provider | Current public Agent models reviewed | Runtime route and constraints |
| --- | --- | --- |
| OpenAI | GPT-6 Astra, GPT-6.1 Sol, GPT-6 Sol, GPT-6 Luna | `/v1/responses`; function tools for GPT-6.1 Sol require Responses. Sol/Luna permit `none`; 6.1 Sol and Astra do not. 1,050,000 context and 128,000 output tokens. |
| Anthropic | Claude Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5 and 4.5 | `/v1/messages`, API version `2023-06-01`; SDK base is the origin without `/v1`. Opus/Sonnet 5.5 use adaptive thinking with effort, reject manual budgets and `disabled`, and expose 1M context / 128K output. |
| Google | Gemini 3.8 Flash | Supported `/v1beta/openai/chat/completions` with model-specific effort/budget settings and opaque tool thought signatures.  |
| DeepSeek | `deepseek-flash` (V4.1 Flash), `deepseek-v4-pro` | Published Floret Responses supports Flash (qualified since v7.19.0). Flash and both official aliases support images, while Pro is text-only. All support off/low/high/max and a 393,216-token output ceiling. Built-in search remains ignored by the provider. |
| Qwen | Qwen3.8 Max, Flash, Omni Flash | `/compatible-mode/v1/chat/completions`; existing qualified search models use Responses. Omni Flash: tools, text/image input, text output. Qwen3.7 Max/Plus output ceilings rise to 131,072. |
| Moonshot | Kimi K3.1 Pro / Highspeed, K3, K2.7 Code, K2.6 | `/v1/chat/completions`; K3/K3.1 require thinking, support low/high/max, omit fixed sampling parameters, and accept `max_completion_tokens` up to 1,048,576 (provider default 131,072). Search for K3/K3.1 remains unintegrated. |
| Kimi Code | K3.1 Pro / Highspeed, K3 / 256K, K2.8 Preview, K2.7 Code Highspeed | Personal subscription key; native /coding/v1/responses on api.kimi.com or api.kimi.ai. Six reviewed wire IDs; no custom aliases or thinking-off fallback. |
| Z.ai | GLM-5.3, GLM-5.3-Flash/FlashX | `/api/paas/v4/chat/completions`; FlashX has 1M context and 128K output, forced thinking with low/high/max. The persisted provider type stays `chatglm`; display branding is Z.ai. |
| xAI | Grok 4.7 | `/v1/chat/completions` is still supported but marked legacy. Responses is the supplier's preferred API for new features. 4.7 supports low/medium/high/xhigh, defaults to high, and cannot disable thinking. |
| Groq | GPT-OSS 120B/20B and Qwen3.8-27B | `/openai/v1/chat/completions`; preview status stays explicit.  |
| OpenRouter | Dynamic provider inventory | Discover tool-capable models from `/api/v1/models`; preserve explicit user selection. |
| Ollama | Installed local inventory | `/api/tags`, `/api/ps`, `/api/show`, then `/v1/chat/completions`; serving context and tools must be discovered. |
| Custom compatible | User-defined models | Retain explicit endpoint, token limits, and capability configuration. |

## October catalog refresh
upstream.json records baseline and per-provider refresh hashes. [ChatGPT authentication](chatgpt-local-authentication.md) intersects account inventory with reviewed capabilities.

## Kimi review on October 24
K3.1 Pro/Highspeed launched October 23. Floret v7.83.0 qualifies Moonshot catalog, output controls and reasoning/tool replay from the same snapshot. The downstream adoption test exercises its public gateway with Redeven capabilities.

The six subscription IDs are catalogued. K3/K3.1 default to 262,144 context for Plus/Moderato; Pro/Allegretto users can choose 1,048,576 and Highspeed. Offline refresh cannot verify credentials, entitlements or quota.

Native Responses replays canonical reasoning, messages and tool pairs without response-ID continuation or invented reasoning IDs. Client identity is Redeven. Quota/policy 429 stops retries; transient overload honors Retry-After. Kimi owns keys, allowances and Extra Usage billing. Membership is personal and interactive; start a new conversation for model-family changes. Native Kimi search remains unintegrated.

Sources: [models](https://www.kimi.com/code/docs/kimi-code/models.html), [membership](https://www.kimi.com/code/docs/kimi-code/membership.html), [errors](https://www.kimi.com/code/docs/kimi-code/error-reference.html), [usage policy](https://www.kimi.com/code/docs/kimi-code/community-guidelines.html), [platform quickstart](https://platform.kimi.com/docs/guide/kimi-k3-1-pro-quickstart), and [Responses](https://platform.kimi.com/docs/api/responses.md). HTTP fixtures cover routing, tools, reasoning, images, usage and cancellation/errors. Live acceptance requires a user key and eligible plan.

# Boundaries

Provider additions qualify in Floret before Redeven adopts its published module with GOWORK=off. No sibling wiring or upstream copies. Hosts own credentials, subscriptions and selection. Preserve configured regional bases. Supplier search alone does not enable search.

Runtime owns routing and projection. Native Anthropic/Google discovery preserves authentication/pagination; supported compatible providers use their inventories. Unknown identities need explicit adapter-supported capabilities. [Model directory](model-directory-and-selection.md) owns discovery deadlines and scope isolation.

# Evidence

- `redeven:scripts/model-catalog/upstream.json` - Pinned models.dev response projection and original response SHA-256.

- redeven:internal/ai/model_gateway_kimi_code_test.go - Subscription wire, canonical replay, quota classification and K3.1 platform parameters.
