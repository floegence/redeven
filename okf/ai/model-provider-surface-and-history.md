---
type: AI Runtime Contract
title: Model provider surface and history
tags: [ai, models, providers, history]
lifecycle: contract
reviewed_at: "2026-11-06"
---
# Summary

Floret owns canonical provider history/rendering lineage; Redeven supplies models, prompts, permissions and ephemeral overlays. Hosted search projects action.sources URLs into Activity; Qwen retains its own shape. Published ResponsesOutput reconciles done and terminal events.

# Contract

## Tool argument ownership
Floret owns syntax/schema validation and bounded correction. Gateway and Desktop model-source RPC v7 retain exact nonempty args_json, including malformed/non-object JSON; v6 peers are fenced before streaming. Object adapters retain args; dual authorities fail. Missing identity/arguments and incomplete streams are transport failures. Canonical rejection/feedback crosses history unchanged, without host repair or correction Activity. Only validated calls acquire execution/authorization/questions. Exhaustion preserves confirmed effects and offers explicit Retry.

## Tool names
[Tool permissions](tool-permission-runtime.md) owns canonical names and the final provider surface. Definitions, calls, execution, history and Flower use the same provider-safe names; no provider alias table or prompt/script rewriting. Historical name migration belongs to its released owner, not an execution-time fallback.

## Responses
Strict OpenAI schemas make optional properties required/nullable and explicitly document null-as-omission. Restore only adapter-added nulls; canonical null/required fields and false/zero/empty remain meaningful. Canonical schemas/non-strict DeepSeek remain unchanged.

Completed reasoning ciphertext wins; matching terminal items fill only missing/null/empty. Search done bytes win when only valid action.sources differ; never merge lists. Answer annotations are independent. Validate terminal-only fallback and retain ordered done events when terminal omits them. Duplicate done, identity/content/arguments/status/input/unknown-field/missing-item/byte violations remain strict.

Map opaque SDK bytes and typed errors. CompleteWithDiagnostics exposes safe paths/boundary/counts/authority, never queries/URLs/values. Localized post-response.completed errors retain copyable safe conflict detail. Attempt epochs identify requests, not failed retries; validation cannot advance history/replay effects/change retry policy.

Floret PrepareResponsesHistory owns OpenAI/compatible/Qwen/ChatGPT replay. Hosted receipts, encrypted reasoning and functions survive disabled tools/search. Confirmed incomplete Responses retain length-continuation snapshots; failed/interrupted streams install none. ChatGPT rejects incomplete; filtering never advances history. Activity is not replay state.

Measure full native input. Only explicit API-key OpenAI responses_continuation plus Engine permission enables response-ID/suffix; others use full input. Freeze request/choice across transport retries. Rejected IDs cannot drop evidence; explicit config may force full replay. ChatGPT retains namespace/OAuth/WebSocket/published state. Historical ID-only states remain opt-in but missing bytes are unrecoverable; new state stores full upstream envelopes. Reader removal needs a future-major migration. Prefix changes discard stale IDs/suffix; upstream isolates model/account/secrets. Manual Retry/Fork preserve facts/tools and clear source state.

CommitAssistant binds full text once before ordered functions. Old split bindings remain readable at saved prefixes; remap only native-proven whitespace coordinates and save on next successful commit. Preserve search/reasoning/phases; changed role/content/tool/namespace/order fails without reset/replay. ResponsesHistoryError exposes safe reason, zero-based record/canonical positions, counts and allowlisted fields through history_detail/Desktop RPC. Both hosts distinguish pre-network preparation from post-response commit and show details/manual Retry without unrelated setup.

Append-only lineage keys provider/model/reasoning/prompt/local-hosted tools/adapter/context policy/state compatibility. Flower uses saved Activity or neutral display, never unknown JSON/arguments.

## Measurement/recovery
Floret EstimateRenderedRequest owns provider rendering/signatures and vocabulary-backed counts; unknown models use an explicit multilingual BPE proxy. Server rendering may differ; no host calibration/preflight. [Measurement](model-context-usage-and-compaction.md#request-measurement) owns frozen-prefix pressure/accounting; [recovery](model-request-recovery.md) owns retries/deadlines/diagnostics.

## Anthropic
Published Floret owns HTTP/SSE, frozen cache hints, authorized attachments and signed output; Redeven maps public content/controls/usage/events. Brand implies no behavior. Engine allows at most four ephemeral cache markers, separate from opaque state. Cache-off retains signed history; secret changes clear reuse.

Completed output survives continuation/restart. Retry/Fork/compaction retain facts and clear source without invented thinking/answer conversion. Frozen retries resolve no attachments and use new attempt IDs. Usage separates uncached/read/write; measured input requires complete partitions and no transformed hosted/signed input, otherwise estimate. Failed streams preserve billing without history advance. Structured HTTP errors/exact limits remain diagnostic.

## DeepSeek temporary images
Published Floret owns upload/validation/expiring reuse/accounting/frozen replay. Explicit official HTTPS root (/v1 allowed): one-hour expiry, 48MiB request. Custom endpoints remain inline/32MiB. Runtime/Desktop independently scope reuse by provider identity; endpoint/credential changes select a new owner. Rotation uses HMAC-SHA256 with random local key, never reusable plain credential hashes. Reauthorize each preparation; no host file-ID persistence/migration. Explicit missing/expired references permit one upstream re-preparation; quota/upload/media errors never enter summary loops.

# Boundaries

Redeven maps typed state, never persists provider envelopes, reconstructs history or infers UI authority. [Context usage](model-context-usage-and-compaction.md#usage-and-recovery) owns accounting/compaction/capacity.

# Evidence

internal/ai/model_gateway_result_test.go and desktop_model_source_test.go preserve malformed/non-object/large-integer arguments and reject dual authority. flower_{control,argument}_correction_integration_test.go cover real transport, correction, questions, exhaustion, restart and Retry without replay. model_gateway_tool_names_test.go checks all provider routes/canonical identities and unchanged arguments/schemas/retries. Responses output/restart tests cover sources, citations, Activity, Goal/Fork/Retry; synthetic hosted-search tests use no production state. Anthropic tests cover wire/usage/cache/secrets/frozen identity, signed/redacted history, attachments and cancellation.
