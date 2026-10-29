---
type: AI Runtime Contract
title: Model provider surface and history
tags: [ai, models, providers, history]
lifecycle: contract
reviewed_at: "2026-10-29"
---
# Summary

Floret owns the provider-visible history and render lineage for each Turn. Redeven supplies the current model surface, prompt, permission snapshot, and ephemeral overlays at the declared boundaries. Historical tool facts remain readable without reintroducing removed tools or rewriting canonical history; provider-surface changes create a new compatible lineage and never become a second continuation store.

# Contract

## Native web-search observation
OpenAI Responses hosted search requests include `web_search_call.action.sources` so returned source URLs can reach the canonical Activity. Qwen requests keep their existing tool shape.

## Provider surface and history
Published Floret v7.92.2 owns native Responses replay through
PrepareResponsesHistory. API-key OpenAI, compatible Responses, Qwen and
ChatGPT adapters retain search receipts, encrypted reasoning and original
function items across local tools. Activity is never a replay source.
Disabling new searches retains old evidence. Completed item events supply
output when terminal snapshots omit it. Confirmed terminal incomplete responses
retain their native snapshot for length
continuations; interrupted and failed streams install no state. ChatGPT continues
to reject incomplete responses. Content-filtered output never advances Engine
history.

Preparation estimates complete native input. API-key OpenAI uses server
continuation only with explicit responses_continuation and Engine permission;
it sends only the validated suffix after the response ID. Other connections
send complete native input. This choice freezes with preparation and transport
retries. Rejected IDs never trigger automatic evidence-dropping retries;
explicit configuration changes can select full replay using retained state.
ChatGPT keeps its namespace, OAuth, WebSocket and published native state format.

Published ID-only OpenAI states remain readable with their original opt-in
continuation behavior; missing historical bytes cannot be recovered. New
responses write the complete upstream envelope. Removing the historical reader
requires a domain migration in a future major release, never within v7.
Changed canonical prefixes discard stale native suffixes and server IDs;
model/account and supplemental-secret isolation remain Floret boundaries.
The Responses history acceptance test covers provider modes, streamed-only
output, continuation suffixes, immutable retries, Goal review, truncation and
restart. Manual Retry and Fork retain canonical facts and confirmed tool results;
their existing lineage boundaries discard source provider state. Transport retry
keeps the frozen native request.

Flower's provider prefix has one owner. Published Floret v7.37.0 keeps one append-only canonical history and keys each render lineage by the complete provider request surface: provider, model, reasoning, System Prompt, local and hosted tools, adapter, context policy, and provider-state compatibility.

Flower reads persisted Activity first and otherwise uses a neutral label and renderer without exposing arguments or unknown JSON.

## Provider rendering and estimation
Published Floret v7.26.0 owns `EstimateRenderedRequest` for local Responses, Chat Completions, Gemini signatures, Moonshot, and Anthropic. Verified model mappings select official vocabularies; unknown models use an explicit multilingual BPE proxy. These remain estimates because server rendering can differ; Redeven adds no network preflight or calibration ledger.

## Native request measurement
Published Floret v7.79.0 owns [native request measurement](model-request-measurement.md), frozen-prefix pressure and schema 28. Redeven maps protocol facts without a second pressure policy or measurement store.

## Provider request recovery
[Model request recovery](model-request-recovery.md) defines Engine-owned retry budgets, physical-request deadlines, attempt diagnostics and current-view feedback. Neither creates a second history owner.

# Boundaries

Redeven maps product model and permission state into Floret's typed surface. It does not persist provider envelopes, reconstruct canonical history, or infer execution authority from rendered Flower state. Usage accounting, compaction, and capacity errors belong to [Model context usage and compaction](model-context-usage-and-compaction.md).

# Evidence

- `redeven:internal/ai/floret_runtime.go` - Hosted Agents receive the current prompt, tools, model, reasoning, and context policy.

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
