---
type: UI Contract
title: Flower model and navigation presentation
description: Model-source controls, notifications, thread selection, and staged content ownership.
tags: [ai, flower, models, navigation]
timestamp: 2026-10-12T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Flower keeps environment and Desktop model sources explicit, preserves thread-owned model and reasoning defaults, and keeps unavailable selections distinct from first-time setup. Thread selection separates immediate visual intent from committed content and rejects stale loads. Transient operation failures use host notifications instead of transcript content, while canonical run and tool failures stay with their owning timeline renderers.

# Contract

## Mechanism
The composer always keeps its model label visible without an availability spinner or busy status.

Runtime status distinguishes no Desktop provider (`not_configured`), configured but unavailable keys or catalog (`missing_keys` or `empty`), and actual connection or protocol errors.

## Model identity and recovery
Thread snapshots, list items, and patches carry `model_id` and `reasoning_selection` as thread defaults. The last is a disabled, ungrouped display of a thread's missing model; Flower never silently replaces it.

See [reasoning selection ownership](flower-reasoning-selection.md) for loading, draft, and submission rules.

## Web search presentation
Model choices display the shared search badge from the server's readonly `web_search` projection. A provider brand or frontend model name never enables search. See [model directory ownership](../ai/model-directory-and-selection.md).

## Permission and navigation
Below the 768px viewport breakpoint, the composer keeps permission status and selection in its own More panel, alongside any other overflow controls.

Saving disables only the permission control, prevents duplicate requests, merges the authoritative settings response, and restores the confirmed value on failure.

Warm sessions switch without provider or transcript remount and stale loads cannot replace the current thread.

# Boundaries

Flower does not treat the global model or permission as an existing-Thread launch override. After creation, its `model_id`, `reasoning_selection`, and `permission_type` are authoritative; Thread changes write to its settings, while new-thread overrides stay connection-local and never update environment defaults.

The header switcher is only a product-specific compact presentation; it does not create a second selected-thread owner or change the requested, committed, and content-presented ordering.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.mobile.browser.test.tsx` - Mobile permission placement, draft retention, request success/failure and keyboard dismissal.

- `redeven:internal/flower_ui/src/FlowerSurface.tsx:128` - Flower recognizes `model_io.updated` as a model-status presentation boundary.

- `redeven:internal/flower_ui/src/contracts/flowerSurfaceContracts.ts:380` - Flower thread snapshots expose `model_id` and `reasoning_selection`.
