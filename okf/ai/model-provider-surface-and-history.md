---
type: AI Runtime Contract
title: Model provider surface and history
description: Keep provider-visible model history, tool surface refresh, and render lineage under Floret ownership.
tags: [ai, models, providers, history]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Floret owns the provider-visible history and render lineage for each Turn. Redeven supplies the current model surface, prompt, permission snapshot, and ephemeral overlays at the declared boundaries. Historical tool facts remain readable without reintroducing removed tools or rewriting canonical history; provider-surface changes create a new compatible lineage and never become a second continuation store.

# Contract

## Native web-search observation
OpenAI Responses hosted search requests include `web_search_call.action.sources` so returned source URLs can reach the canonical Activity. Qwen requests keep their existing tool shape.

## Provider surface and history
Flower's provider prefix has one owner. Published Floret v7.37.0 keeps one append-only canonical history and keys each render lineage by the complete provider request surface: provider, model, reasoning, System Prompt, local and hosted tools, adapter, context policy, and provider-state compatibility.

Flower reads persisted Activity first and otherwise uses a neutral label and renderer without exposing arguments or unknown JSON.

## Provider rendering and estimation
Published Floret v7.26.0 owns `EstimateRenderedRequest` for local Responses, Chat Completions, Gemini signatures, Moonshot, and Anthropic. Verified model mappings select official vocabularies; unknown models use an explicit multilingual BPE proxy. These remain estimates because server rendering can differ; Redeven adds no network preflight or calibration ledger.

## Native request measurement
Published Floret v7.78.2 owns [native request measurement](model-request-measurement.md), frozen-prefix pressure and schema 28. Redeven maps protocol facts without a second pressure policy or measurement store.

## Provider request recovery
[Model request recovery](model-request-recovery.md) defines Engine-owned retry budgets, physical-request deadlines, attempt diagnostics and current-view feedback. Neither creates a second history owner.

# Boundaries

Redeven maps product model and permission state into Floret's typed surface. It does not persist provider envelopes, reconstruct canonical history, or infer execution authority from rendered Flower state. Usage accounting, compaction, and capacity errors belong to [Model context usage and compaction](model-context-usage-and-compaction.md).

# Evidence

- `redeven:internal/ai/floret_runtime.go` - Hosted Agents receive the current prompt, tools, model, reasoning, and context policy.

- `redeven:internal/ai/prompt_builder.go` - Stable System Prompt construction.

- `redeven:internal/ai/floret_bootstrap.go` - Restart uses canonical Turn input and provider-safe state.
