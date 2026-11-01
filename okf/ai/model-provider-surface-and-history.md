---
type: AI Runtime Contract
title: Model provider surface and history
tags: [ai, models, providers, history]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Floret owns the provider-visible history and render lineage for each Turn. Redeven supplies the current model surface, prompt, permission snapshot, and ephemeral overlays at the declared boundaries. Historical tool facts remain readable without reintroducing removed tools or rewriting canonical history; provider-surface changes create a new compatible lineage and never become a second continuation store.

# Contract

## Native web-search observation
Responses hosted search requests include web_search_call.action.sources for canonical Activity URLs. Qwen keeps its tool shape.

## Provider surface and history
Published Floret v7.92.2 PrepareResponsesHistory owns API-key OpenAI, compatible Responses, Qwen and ChatGPT native replay: search receipts, encrypted reasoning and function items survive local tools. Activity is no replay source. Disabling searches retains evidence; completed events supply output omitted from terminal snapshots. Confirmed incomplete Responses retain snapshots for length continuation; interrupted/failed streams install none. ChatGPT rejects incomplete responses; content filtering never advances history.

Preparation estimates full native input. API-key OpenAI uses response-ID/suffix continuation only with explicit responses_continuation and Engine permission; others send full input. Freeze selection/request across retries. Rejected IDs never trigger evidence-dropping retries; explicit configuration can select full replay. ChatGPT retains namespace/OAuth/WebSocket/published state.

Historical ID-only OpenAI states retain opt-in continuation; absent bytes cannot be recovered. New states store complete upstream envelopes. Reader removal needs a future-major domain migration, never within v7. Changed canonical prefixes discard stale suffixes/IDs; Floret isolates model/account/secrets. Manual Retry/Fork retain canonical facts/tool results but clear source state; transport retries preserve frozen requests. Acceptance covers provider modes, streamed-only output, suffixes, immutable retry, Goal review, truncation/restart.

Floret v7.37.0 owns append-only canonical history and lineages keyed by provider/model/reasoning/prompt/local-hosted tools/adapter/context policy/state compatibility. Flower reads persisted Activity or uses neutral presentation without unknown JSON/arguments.

## Provider rendering and estimation
Floret v7.26.0 EstimateRenderedRequest owns Responses, Chat Completions, Gemini signatures, Moonshot and Anthropic. Verified mappings use official vocabularies; unknown models use an explicit multilingual BPE proxy. Server rendering may differ; no host calibration ledger/network preflight.

## Anthropic Messages
Floret v7.95.0 owns HTTP/SSE, frozen cache hints, authorized attachments and native signed output. Flower maps controls/content/usage/events through public Gateway; retire the SDK route. Endpoint brand/intermediary does not select behavior. Engine policy allows at most four ephemeral markers and separately controls opaque state. Cache-off retains permitted signed history; secret isolation clears both reuse paths.

Completed output survives continuation/restart. Retry/Fork/compaction retain canonical facts and clear source state through Floret. Never fabricate signed historical reasoning or recast it as answer text. State stays opaque. Frozen transport retries resolve no attachments and carry new attempt IDs.

Usage separates uncached/cache-read/cache-write. Measured request input needs complete partitions and excludes service-transformed hosted/signed input; unsupported evidence remains estimated. Failed streams retain billing without advancing state. Diagnostics preserve public structured HTTP errors and exact byte limits.

model_gateway_anthropic_test.go covers final wire/usage/state/cache-off/secret isolation/frozen identity. Service regression retains signed/redacted blocks across two turns with separately typed public thinking. Shared argument/attachment/cancel/prepared-request tests remain; no qualification resumes production threads.

## Native request measurement
Floret v7.79.0 owns [measurement](model-request-measurement.md), frozen-prefix pressure and schema 28; Redeven adds no pressure policy/store.

## Provider request recovery
[Recovery](model-request-recovery.md) owns Engine retry budgets/deadlines/attempt diagnostics/current feedback, without another history owner.

# Boundaries

Redeven maps product model and permission state into Floret's typed surface. It does not persist provider envelopes, reconstruct canonical history, or infer execution authority from rendered Flower state. Usage accounting, compaction, and capacity errors belong to [Model context usage and compaction](model-context-usage-and-compaction.md).

# Evidence

- `redeven:internal/ai/floret_runtime.go` - Current hosted prompt/tools/model/reasoning/context inputs.

- `redeven:internal/ai/floret_bootstrap.go` - Restart uses canonical Turn input and provider-safe state.

## Temporary DeepSeek image transport

Published Floret v7.89.1 owns Files API upload, media validation, expiring reuse,
visual token accounting and frozen replay. Redeven enables this only for the
explicit official HTTPS API root (including /v1), with one-hour expiry and the
48 MiB official request limit. Custom endpoints retain the existing inline
transport and 32 MiB host policy. Runtime Service and Desktop executor each keep
bounded provider-identity owners; credential or endpoint changes select a new
owner. Credential rotation identity uses HMAC-SHA256 with a random owner-local key, preventing reusable plain credential fingerprints. Original attachments remain canonical and authorized on every new
preparation. Neither host persists temporary file IDs or migrates Floret data.
Explicit missing/expired reference errors allow one upstream re-preparation;
quota, upload and invalid media failures cannot trigger summary loops.

Evidence: `redeven:internal/ai/model_gateway_deepseek_files_test.go` covers
23 image occurrences, visual accounting, cross-preparation reuse, credential
isolation, custom endpoints and typed Desktop error round trips.
