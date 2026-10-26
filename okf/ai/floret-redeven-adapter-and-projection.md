---
type: AI Runtime Contract
title: Floret Redeven adapter and projection
description: Map authorized Redeven requests and Floret typed views without creating a second thread lifecycle.
tags: [ai, floret, adapter, projection]
timestamp: 2026-10-20T00:00:00Z
quality_exception: Cross-boundary adapter contract spanning authorization, live projections, Activity sanitization, recovery, and browser ordering.
lifecycle: contract
reviewed_at: "2026-10-23"
---
# Summary

Redeven's adapter is a thin typed boundary over published Floret. It authorizes endpoint and thread ownership, resolves resources, sanitizes Activity, maps typed views, native updates and failures, and projects live summaries. Floret remains the only lifecycle, persistence, migration, cancellation, and provider-state owner; Redeven never waits on provider work or mirrors a receipt, authority barrier, transcript, or execution projection.

# Contract

[Flower Goals](flower-goals.md) use the optional published Goal controller. Ordinary executable items retain strict identity.

## Incremental observation and public projection
Floret supplies optional `ThreadFactsSource`, `ThreadWindowSource` and canonical body readers. The published module `v7.87.1` includes bounded item-text reads, lazy hidden-field preparation, prepared-thread startup reuse and single-mutation title summaries. Title extraction uses at most 16 KiB of the existing canonical array prefix without detail preparation or new index writes. Blank-module adoption opens released-writer fixtures and verifies historical continuation and restart. Floret alone owns text cadence, versions, append buffers, Activity reduction and canonical reads.

Root detail, child detail and command receipts use the bounded window projection. The accepted window includes its canonical Summary in the same baseline; there is no separate preparation window or independently sampled read watermark. POST history selects an authorized page and, when an observer is supplied, installs its reading interest on the same ordered Floret subscription. POST history-item expands one canonical item by its published body locators: frozen live extent, manifest parts or hash-verified field chunks. Every read refreshes endpoint, namespace and user authorization. The client never supplies raw entry locators as authority. Historical zero-byte Activity sources are synthesized only by Floret on explicit expansion; Redeven must not duplicate those defaults.

Workspace updates carry facts only; unchanged sidebar-visible facts preserve cache identity at text-stream cadence. Each observer has exactly two cancellable reading slots, for the conversation and optional child panel. Computer assistance outside the selected interval uses server-only canonical evidence, which is not included in the bounded response. See [live delivery](../ui/flower-live-timeline.md) and [qualification](../operations/flower-thread-switch-qualification.md).

No database schema or migration changes are part of this optimization.

## Model output and presentation
[tool_result_encoding.go](../../internal/ai/tool_result_encoding.go) owns the single final result encoder: execution facts, tool content policy, final JSON, then Text and an independent Decoder.UseNumber Structured snapshot. Activity independently projects valid source data; its display truncation never changes model output.

Its `request_key` remains the send idempotency identity used only to settle the short-lived browser outbox; the two values are not interchangeable.

Flower ask_user exposes only write and select_or_write. The latter always presents fixed choices with a separate custom-text answer, even when write_label is omitted. Floret owns normalization of historical select requests; Redeven does not add a second compatibility path. Ordinary InputRequired selection remains a separate contract.

# Boundaries

The adapter may add product authorization, resource resolution, DTO mapping, and browser-safe presentation. It must not import Floret internals, read or migrate Floret storage, create a legacy run handler, infer lifecycle from error text or timestamps, or introduce a second event/retry/replay state machine.

The obsolete logged max_tool_calls declaration is removed because it never enforced a limit.

# Evidence

- [Output-source integration fixture](../../internal/ai/flower_output_sources_integration_test.go) checks every intermediate HTTP-provider publication and canonical reopen; shared mapper and isolated browser tests consume its sanitized checkpoints.

- `redeven:internal/ai/floret_runtime.go` - Composes the published typed runtime.

- `redeven:internal/ai/threads.go` - Enforces endpoint/thread ownership and summary-only inventory mapping.
