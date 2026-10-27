---
type: UI Contract
title: Flower personal conversation preferences
description: Remember explicit model, directory, and model-owned reasoning choices without importing thread settings into future defaults.
tags: [ai, flower, preferences, composer, persistence]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Explicit model, directory and model-owned reasoning choices are remembered per authenticated namespace, endpoint and user. Loading/switching threads never writes defaults. New roots prefer explicit launch/draft choices, then personal memory, then configuration; existing threads and immutable turns retain confirmed settings.

# Contract

## Ownership and persistence
`ai_conversation_preferences` belongs to product schema v11. Transactional v10→v11 validates source/target shapes, preserves data and never infers preferences from old threads. Missing stable scope cannot read another user's defaults.

## Selection events
Patch only the chosen field. Existing-thread edits must succeed before saving memory; memory failure cannot roll back confirmed thread state. Explicit Default differs from absent memory; Default/budget and Off/budget semantics remain.

## Drafts and admission
Draft overrides remain distinct from effective model/directory admission values; old selection cannot seed a new draft. Without explicit/remembered reasoning, root launch freezes explicit Default so retries cannot acquire later memory. Server [canonicalization](../ai/model-reasoning-runtime.md) owns model capability. Existing busy/queued/unresolved-input edit restrictions apply.

## Concurrency and failure
Adapters serialize captured patches and load latest revision; the store atomically merges with compare-and-set. Stale writes return 409 without auto-retry. Captured target/model identity fences late responses against navigation or retargeting.

The originating surface consumes its authoritative response/settings revision without reloading shared model resources; other surfaces refresh persisted preferences. Catalog refresh is reserved for configuration changes, preventing model/reasoning selection from replacing the composer with loading UI.

# Boundaries

This is Redeven product preference policy using already published Floret capabilities, not a generic upstream settings framework. Runtime catalogs, filesystem scope, canonical Thread settings, and immutable Turn execution remain authoritative. Model and directory recovery use existing controls and host notifications, not new switches, save buttons, or confirmation dialogs.

# Evidence

- `redeven:internal/ai/conversation_preferences.go` - Authenticated product preference API and model/directory/reasoning validation.

- `redeven:internal/ai/threads.go` - Root creation precedence and final validation.
