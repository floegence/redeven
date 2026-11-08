---
type: AI Runtime Contract
title: Floret Redeven adapter and projection
tags: [ai, floret, adapter, projection]
quality_exception: Cross-boundary adapter contract spanning authorization, live projections, Activity sanitization, recovery, and browser ordering.
lifecycle: contract
reviewed_at: "2026-11-08"
---
# Summary

Redeven authorizes ownership/resources and maps typed Floret views, updates, failures and safe Activity. Root/child/command receipts share bounded windows containing canonical Summary in the same baseline. No separately sampled preparation/watermark. Authorized history POST installs interest on the ordered observer; item POST expands only published frozen-live/manifest/hash-verified locators.

# Contract

[Goals](flower-goals.md) use the optional public controller; ordinary executable items retain strict identity.

## Observation
Floret supplies ThreadFactsSource, ThreadWindowSource and canonical body readers. v7.87.4 includes bounded text, lazy fields, startup reuse and single-mutation title summaries from <=16 KiB canonical prefix, without detail/index writes. Blank-module adoption verifies released historical continuation/restart. Floret alone owns cadence, versions, buffers, Activity reduction and reads.

Recheck endpoint/user/namespace each read. Client locators grant no authority. Only Floret synthesizes historical zero-byte Activity defaults on explicit expansion.

Published Floret v7.106.2 retires old-interest resident and deferred detail
consistently, preserving ordered semantic components and accepted explicit
baselines. The adapter consumes this owner contract without compensating diffs,
extra subscriptions, canonical reads or observer persistence.

Workspace facts preserve equal sidebar cache identity. Each observer has two cancellable slots: conversation and child. Off-window Computer assistance uses server-only canonical evidence, excluded from bounded response. [Live delivery](../ui/flower-live-timeline.md) and [qualification](../operations/flower-live-queue-performance.md#navigation) own details. No schema/migration change.

## Model result and UI
[Final encoder](../../internal/ai/tool_result_encoding.go) applies execution facts/content policy/JSON, then Text plus independent Decoder.UseNumber structured snapshot. Activity separately projects valid source; truncation cannot alter model content. Floret's uncertain-effect warning sits outside payload budget, preserving complete diagnostics through provider/restart/retry.

Optional encoding loss emits factual error and continues provider loop, never soliciting human confirmation merely for possible mutation. Preserve result_unavailable/result_error_code separately from original owner error, invocation ID, completed_actions, needs_observation and target, including confirmed prefix/uncertain remainder. Malformed metadata cannot replace classification. Empty prefix proves no absence of effects; invocation completion is not task success. Model chooses authorized observation/work; never replay tools. Actual interactions/cancellation/dispatch/uncertainty retain authority; failure to encode safe result is infrastructure failure. Persisted questions keep canonical answer/cancel after restart, without host migration/auto-answer.

Published Floret v7.108.2 owns the model-visible `user_ask` schema and field guidance. Flower
capability definitions consume `runtime.CoreControlDefinitions()` with the selected
public built-in names;
there is no alternate product schema or model-only `open_subagent` choice field.
Guidance for input modes, evidence and Goal operations belongs upstream. Final
HTTP request tests cover control guidance, interaction continuation and provider
adapters; local definition tests alone cannot prove what the model receives.

The compact model contract omits `reason_code`, `required_from_user`,
`choices_exhaustive` and constant choice `kind`. Evidence references remain
required (an empty array is valid); Computer assistance resolves an actual
same-Turn tool call and target, never a guessed latest failure. Stable question
and choice IDs, secret input, custom answers and display hints remain available.
Released v7 arguments, frozen definitions and pending presentations remain owned
and validated by Floret; absent metadata stays absent, without host defaults or
history rewrites. The browser derives its own choice-rendering discriminator.

Final HTTP definition budgets cover OpenAI strict and DeepSeek non-strict forms
across six capability surfaces. Published-runtime fixtures, structured-input and
browser regressions cover compact presentation, selected/custom answers, draft
continuity and secret input. Computer takeover tests cover restart and return
without replaying the blocked action.

request_key remains send idempotency for transient browser outbox, not invocation identity. user_ask supports write and select_or_write; fixed choices always include custom text even without write_label. Floret normalizes historical select; ordinary InputRequired is separate. No product compatibility path.

# Boundaries

The adapter may add product authorization, resource resolution, DTO mapping, and browser-safe presentation. It must not import Floret internals, read or migrate Floret storage, create a legacy run handler, infer lifecycle from error text or timestamps, or introduce a second event/retry/replay state machine.

The obsolete logged max_tool_calls declaration is removed because it never enforced a limit.

# Evidence

- [Output-source integration fixture](../../internal/ai/flower_output_sources_integration_test.go) checks every intermediate HTTP-provider publication and canonical reopen; shared mapper and isolated browser tests consume its sanitized checkpoints.
- `redeven:internal/ai/floret_runtime.go` - Source.
