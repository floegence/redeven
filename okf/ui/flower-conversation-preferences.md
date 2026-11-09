---
type: UI Contract
title: Flower personal conversation preferences
tags: [ai, flower, preferences, composer, persistence]
lifecycle: contract
reviewed_at: "2026-11-08"
---
# Summary

Explicit model, directory and model-owned reasoning choices are remembered per authenticated namespace, endpoint and user. The originating surface consumes its authoritative response/settings revision without reloading shared model resources; other surfaces refresh persisted preferences.

# Contract

## Ownership and persistence
`ai_conversation_preferences` belongs to product schema v11. Transactional v10→v11 validates source/target shapes, preserves data and never infers preferences from old threads. Missing stable scope cannot read another user's defaults.

## Global settings
Env App Settings → Flower exposes personal defaults separately from the runtime model profile. It reuses the composer adapter and CAS endpoint, model directory, reasoning control and scoped directory picker. Opening never writes effective fallbacks; each explicit selection patches only its chosen field. Scope, connection generation and current permissions fence late completions. Composer choices remain direct shortcuts to this same memory.

## Selection events
Patch only the chosen field. Existing-thread edits must succeed before saving memory; memory failure cannot roll back confirmed thread state. Explicit Default differs from absent memory; Default/budget and Off/budget semantics remain.

## Drafts and admission
Draft overrides remain distinct from effective model/directory admission values; old selection cannot seed a new draft. Without explicit/remembered reasoning, root launch freezes explicit Default so retries cannot acquire later memory. Server [canonicalization](../ai/model-reasoning-runtime.md#runtime-capability) owns model capability. Existing busy/queued/unresolved-input edit restrictions apply.

## Concurrency and failure
Adapters serialize captured patches and load latest revision; the store atomically merges with compare-and-set. Stale writes return 409 without auto-retry. Captured target/model identity fences late responses against navigation or retargeting.

Catalog refresh is reserved for configuration changes, preventing model/reasoning selection from replacing the composer with loading UI.

# Boundaries

This is Redeven product preference policy using already published Floret capabilities, not a generic upstream settings framework. Runtime catalogs, filesystem scope, canonical Thread settings, and immutable Turn execution remain authoritative. Model and directory recovery reuse the model selector and directory picker; there is no second preference database or automatic conflict retry.

# Evidence

- `redeven:internal/ai/conversation_preferences.go` - Source.
