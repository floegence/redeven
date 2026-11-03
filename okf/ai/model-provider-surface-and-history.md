---
type: AI Runtime Contract
title: Model provider surface and history
tags: [ai, models, providers, history]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Floret owns canonical provider history/rendering lineage; Redeven supplies model, prompt, permissions and ephemeral overlays at declared boundaries. History stays readable without restoring removed tools or rewriting facts. Surface changes create compatible lineage, never a host continuation store.

# Contract

## Responses
Hosted search includes web_search_call.action.sources for Activity URLs; Qwen keeps its tool shape. Floret7.97.0 ResponsesOutput reconciles done/terminal. Completed reasoning ciphertext wins; fill only missing/null/empty from matching terminal item. Search done bytes win when only valid action.sources differ,never merge/overwrite lists; answer annotations independent. Validate terminal-only fallback; omitted terminal retains ordered done events. Duplicate done,identity/content/arguments/status/inputs/unknown fields/missing items/byte limits remain strict.

Redeven maps opaque SDK bytes/typed errors. CompleteWithDiagnostics returns safe paths,boundary,counts/chosen authority,never query/URL/values. Localize post-response.completed validation failure with exact copyable conflict detail. Attempt epochs identify requests,not failed retries. Validation never advances history,changes retry policy or replays effects.

Floret7.92.2 PrepareResponsesHistory owns OpenAI key/compatible/Qwen/ChatGPT replay. Hosted receipts,encrypted reasoning/functions survive disabled tools/search. Confirmed incomplete Responses keep snapshots for length continuation; failed/interrupted streams install none. ChatGPT rejects incomplete; filtering never advances history. Activity is not replay state.

Estimate full native input. Only explicit API-key OpenAI responses_continuation plus Engine permission uses response-ID/suffix; others full input. Freeze request/choice through transport retry; rejected IDs cannot drop evidence. Explicit config may choose full replay. ChatGPT retains namespace/OAuth/WebSocket/published state. Historical ID-only states retain opt-in but missing bytes unrecoverable; new states store full upstream envelope. Reader removal requires future-major migration,not v7. Changed prefix discards stale IDs/suffix; Floret isolates model/account/secrets. Manual Retry/Fork keep facts/tools,clear source state.

Floret7.99.0 CommitAssistant binds full text once before ordered functions. Hosted Activity boundaries are presentation. Old split bindings stay readable at saved prefixes; remap only native-proven whitespace coordinates,save next successful commit. Preserve search/reasoning/phases; changed content/role/tool/namespace/order fails without reset/replay. ResponsesHistoryError carries safe reason,zero-based record/canonical positions,counts/allowlisted fields via history_detail/Desktop RPC. Both hosts distinguish pre-network preparation/post-response commit,show details/manual Retry,omit irrelevant setup.

Floret7.37.0 owns append-only lineage keyed provider/model/reasoning/prompt/local-hosted tools/adapter/context policy/state compatibility. Flower uses saved Activity/neutral display,never unknown JSON/arguments.

## Measurement/recovery
Floret7.26.0 EstimateRenderedRequest owns Responses/Chat/Gemini signatures/Moonshot/Anthropic. Verified models use official vocabularies; unknown explicit multilingual BPE proxy. Server rendering may differ; no host calibration/preflight. Floret7.79.0 owns [measurement](model-request-measurement.md),frozen-prefix pressure/schema28; [recovery](model-request-recovery.md) owns retries/deadlines/diagnostics/current feedback.

## Anthropic
Floret7.95.0 owns HTTP/SSE,frozen cache hints,authorized attachments,signed output; Redeven maps public Gateway content/controls/usage/events,retiring SDK route. Brand selects no behavior. Engine permits<=4 ephemeral cache markers separate from opaque state. Cache-off keeps signed history; secrets clear both reuse paths.

Completed output survives continuation/restart. Retry/Fork/compaction retain facts,clear source;never invent signed thinking/convert to answer. Frozen retries resolve no attachments,use new attempt IDs. Usage separates uncached/read/write; measured input requires complete partitions and no service-transformed hosted/signed input,otherwise estimated. Failed stream preserves billing without history advance. Structured HTTP errors/exact limits remain diagnostic.

## DeepSeek temporary images
Floret7.89.1 owns Files upload/validation/expiring reuse/accounting/frozen replay. Explicit official HTTPS root(/v1 allowed) only,one-hour expiry/48MiB request. Custom stays inline/32MiB. Runtime/Desktop each bound reuse by provider identity; endpoint/credential change selects new owner. Rotation uses HMAC-SHA256/random local key,not reusable plain credential hash. Reauthorize attachments each preparation;no host file-ID persistence/migration. Explicit missing/expired ref allows one upstream re-preparation; quota/upload/media errors never enter summary loop.

# Boundaries

Redeven maps typed product state,never persists envelopes,reconstructs history or infers UI authority. [Context usage](model-context-usage-and-compaction.md) owns accounting/compaction/capacity.

# Evidence

- `redeven:internal/ai/floret_runtime.go` - Source.
- `redeven:internal/ai/floret_bootstrap.go` - Source.
- model_gateway_responses_output_test.go/Floret restart:source variants,terminal-only citations,all adapters,one Activity,Goal/restart/Fork/Retry with confirmed tools. TestResponsesLiveHostedSearchCompletion uses synthetic searches/recreated adapters/configured provider,never production state.
- model_gateway_anthropic_test.go:wire/usage/cache/secrets/frozen identity;Service signed/redacted two-turn thinking plus shared arguments/attachments/cancel.
- `redeven:internal/ai/model_gateway_deepseek_files_test.go`:23 images,reuse/accounting/credentials/custom endpoints/Desktop errors.
