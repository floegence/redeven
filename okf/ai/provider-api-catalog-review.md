---
type: Provider Compatibility Review
title: Provider API and catalog review
tags: [ai, models, providers, compatibility]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
---
# Summary

Runtime/Web/Desktop/iOS share an authenticated reviewed catalog. Pinned models.dev inventory and official contracts require released adapters plus qualified limits/replay/tools/images/reasoning. Refresh preserves selections/conversation identities. Review dates: October12 baseline, October24 Kimi; no audio/video/embeddings/restricted models.

# Contract

| Reviewed provider/model | Route and constraints |
| --- | --- |
| OpenAI GPT-6 Astra,6.1 Sol,6 Sol,6 Luna | Responses;6.1Sol function tools require it. Sol/Luna allow none,6.1Sol/Astra do not. Context1050000/output128000. |
| Anthropic Fable5.1,Opus/Sonnet/Haiku5.5,Haiku4.5 | /v1/messages,2023-06-01,SDK origin without/v1. Opus/Sonnet5.5 adaptive effort, no manual budget/disabled;1M/128K. |
| Gemini3.8Flash | /v1beta/openai/chat/completions, model-specific effort/budget, opaque thought signatures. |
| DeepSeek Flash(V4.1),v4Pro | Published Responses (Flash since7.19);Flash/official aliases image-capable,Pro text-only;off/low/high/max,393216output. Provider ignores built-in search. |
| Qwen3.8Max/Flash/OmniFlash | compatible-mode Chat; qualified search uses Responses. Omni tools/text-image→text;3.7Max/Plus output131072. |
| Moonshot K3.1Pro/Highspeed,K3,K2.7Code,K2.6 | Chat;K3/K3.1 mandatory thinking low/high/max,no fixed sampling, max_completion_tokens<=1048576/default131072;search unintegrated. |
| Kimi Code K3.1Pro/Highspeed,K3/256K,K2.8Preview,K2.7CodeHighspeed | Personal key,native /coding/v1/responses on api.kimi.com/ai,six reviewed IDs,no aliases/thinking-off fallback. |
| Z.ai GLM5.3/Flash/FlashX | /api/paas/v4/chat/completions;FlashX1M/128K,mandatory thinking low/high/max;persist chatglm,display Z.ai. |
| xAI Grok4.7 | Chat supported/legacy, supplier prefers Responses for new features;low/medium/high/xhigh,default high,no off. |
| Groq GPT-OSS120B/20B,Qwen3.8-27B | /openai/v1/chat/completions;preview explicit. |
| OpenRouter | /api/v1/models tool-capable discovery;explicit selection retained. |
| Ollama | tags/ps/show then Chat;discover serving context/tools. |
| Custom compatible | Explicit endpoint/limits/capabilities retained. |

## October catalog refresh
upstream.json retains baseline/provider hashes. [ChatGPT admission](chatgpt-account-lifecycle.md#local-admission) intersects account inventory with reviewed capabilities.

## Kimi review on October 24
October23 K3.1 release is qualified by Floret7.83.0 catalog/output/reasoning/tool replay and downstream public-gateway adoption. Six subscription IDs:K3/K3.1 Plus/Moderato default262144;Pro/Allegretto may select1048576/Highspeed. Offline refresh proves no credentials/entitlement/quota.

Native Responses replays canonical reasoning/messages/tool pairs, no response-ID continuation/invented IDs. Client=Redeven. Quota/policy429 stops retry; transient overload honors Retry-After. Kimi owns personal interactive membership/key/billing; new model family starts new conversation. Native search unintegrated. Live qualification needs eligible user key; fixtures cover routing/tools/reasoning/images/usage/cancel/errors.

Sources: [models](https://www.kimi.com/code/docs/kimi-code/models.html), [membership](https://www.kimi.com/code/docs/kimi-code/membership.html), [errors](https://www.kimi.com/code/docs/kimi-code/error-reference.html), [policy](https://www.kimi.com/code/docs/kimi-code/community-guidelines.html), [platform](https://platform.kimi.com/docs/guide/kimi-k3-1-pro-quickstart), [Responses](https://platform.kimi.com/docs/api/responses.md).

# Boundaries

Qualify upstream before published GOWORK=off consumption, no sibling/copies. Host owns credentials/subscriptions/selection/regional endpoints; supplier search alone cannot enable it. Runtime owns routing/projection; native Anthropic/Google preserve authentication/pagination, compatible providers use supported inventories. Unknown identity requires explicit adapter capabilities. [Directory](model-directory-and-selection.md) owns deadlines/scope isolation.

# Evidence

scripts/model-catalog/upstream.json retains pinned projection/SHA256. internal/ai/model_gateway_kimi_code_test.go verifies wire/replay/quota/K3.1 parameters.
