---
type: AI Runtime Contract
title: Floret Redeven adapter and projection
tags: [ai, floret, adapter, projection]
quality_exception: Cross-boundary adapter contract spanning authorization, live projections, Activity sanitization, recovery, and browser ordering.
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Redeven's adapter is a thin typed boundary over published Floret. It authorizes endpoint and thread ownership, resolves resources, sanitizes Activity, maps typed views, native updates and failures, and projects live summaries. Floret remains the only lifecycle, persistence, migration, cancellation, and provider-state owner; Redeven never waits on provider work or mirrors a receipt, authority barrier, transcript, or execution projection.

# Contract

[Goals](flower-goals.md) use the optional public controller; ordinary executable items retain strict identity.

## Observation
Floret supplies ThreadFactsSource, ThreadWindowSource and canonical body readers. v7.87.4 includes bounded text, lazy fields, startup reuse and single-mutation title summaries from <=16 KiB canonical prefix, without detail/index writes. Blank-module adoption verifies released historical continuation/restart. Floret alone owns cadence, versions, buffers, Activity reduction and reads.

Root/child/command receipts share bounded windows containing canonical Summary in the same baseline. No separately sampled preparation/watermark. Authorized history POST installs interest on the ordered observer; item POST expands only published frozen-live/manifest/hash-verified locators. Recheck endpoint/user/namespace each read. Client locators grant no authority. Only Floret synthesizes historical zero-byte Activity defaults on explicit expansion.

Workspace facts preserve equal sidebar cache identity. Each observer has two cancellable slots: conversation and child. Off-window Computer assistance uses server-only canonical evidence, excluded from bounded response. [Live delivery](../ui/flower-live-timeline.md) and [qualification](../operations/flower-thread-switch-qualification.md) own details. No schema/migration change.

## Model result and UI
[Final encoder](../../internal/ai/tool_result_encoding.go) applies execution facts/content policy/JSON, then Text plus independent Decoder.UseNumber structured snapshot. Activity separately projects valid source; truncation cannot alter model content. Floret's uncertain-effect warning sits outside payload budget, preserving complete diagnostics through provider/restart/retry.

Optional encoding loss emits factual error and continues provider loop, never soliciting human confirmation merely for possible mutation. Preserve result_unavailable/result_error_code separately from original owner error, invocation ID, completed_actions, needs_observation and target, including confirmed prefix/uncertain remainder. Malformed metadata cannot replace classification. Empty prefix proves no absence of effects; invocation completion is not task success. Model chooses authorized observation/work; never replay tools. Actual interactions/cancellation/dispatch/uncertainty retain authority; failure to encode safe result is infrastructure failure. Persisted questions keep canonical answer/cancel after restart, without host migration/auto-answer.

request_key remains send idempotency for transient browser outbox, not invocation identity. ask_user supports write and select_or_write; fixed choices always include custom text even without write_label. Floret normalizes historical select; ordinary InputRequired is separate. No product compatibility path.

# Boundaries

The adapter may add product authorization, resource resolution, DTO mapping, and browser-safe presentation. It must not import Floret internals, read or migrate Floret storage, create a legacy run handler, infer lifecycle from error text or timestamps, or introduce a second event/retry/replay state machine.

The obsolete logged max_tool_calls declaration is removed because it never enforced a limit.

# Evidence

- [Output-source integration fixture](../../internal/ai/flower_output_sources_integration_test.go) checks every intermediate HTTP-provider publication and canonical reopen; shared mapper and isolated browser tests consume its sanitized checkpoints.

- `redeven:internal/ai/floret_runtime.go` - Composes the published typed runtime.

- `redeven:internal/ai/threads.go` - Endpoint/thread authorization and summary-only inventory.
