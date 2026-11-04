---
type: AI Runtime Contract
title: AI model and context runtime
tags: [ai, models, context, providers]
quality_exception: Unified model-context contract linking provider mapping, immutable provider checkpoints, usage accounting, compaction, and Desktop source compatibility.
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Redeven persists model/reasoning preferences, credentials and source selection. Floret owns provider context and opaque continuation. Desktop/environment sources stay distinct; typed observations drive usage/compaction. Token input/output limits remain separate and configuration merges preserve unrelated settings.

# Contract

## Request output budgets
Redeven passes model output capability as Floret ModelMaxOutputTokens, and only an explicit per-request limit as MaxOutputTokens. It never maps capability to a fixed output reservation.

The comparison logs are /tmp/redeven-budget-desktop-failures-focused.log and /tmp/redeven-budget-desktop-main-baseline.log.

## Mechanism
Model reasoning capability, stream fields, history replay, and immutable thread settings are governed by [model reasoning capabilities and transport](model-reasoning-runtime.md#runtime-capability).

Unsupported transports reject non-empty state before HTTP.

Hosted-turn diagnostics record the selected wire mode, and Floret lifecycle audit events carry batch index, batch size, event type, and observation time so operators can distinguish model serialization, provider single-call output, approval wait, dispatch, and completion without feeding diagnostics back into scheduling.

## Prompt and repository rule sources
[Flower prompt and rule sources](flower-prompt-and-rule-sources.md) owns task, interaction, recovery, complete rule reading, and runtime-context admission policy.

## Related provider history
Provider-visible history, render lineage, and unavailable-tool continuity are owned by [Model provider surface and history](model-provider-surface-and-history.md).

## Related context usage
Usage accounting, context pressure, compaction, token budgets, and capacity failures are owned by [Model context usage and compaction](model-context-usage-and-compaction.md#usage-and-recovery).

# Boundaries

Redeven owns model preferences, credentials, gateway selection, and the one-shot `/compact` input mapping. Floret owns provider-visible context, canonical compaction identity and result, and opaque continuation. Live context events and UI usage projections are observations, not durable lifecycle or provider-state authority.

# Evidence

- `redeven:internal/ai/floret_provider.go:55` - Provider deltas become Floret events, never direct product-state writes.
- `redeven:internal/ai/prompt_builder.go` - Source.
