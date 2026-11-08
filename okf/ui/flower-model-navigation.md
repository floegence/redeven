---
type: UI Contract
title: Flower model and navigation presentation
tags: [ai, flower, models, navigation]
lifecycle: contract
reviewed_at: "2026-11-06"
---
# Summary

Flower separates Desktop/environment sources, unavailable models and first setup. Transient action failures use notifications; canonical failures remain in their timeline. The model picker aligns to the logical start edge of its trigger through the published Floe anchored-layer API, retaining surface boundary clamping.

# Contract

## Mechanism
The composer always keeps its model label visible without an availability spinner or busy status.

Its bounded scroll viewport exposes the complete configured catalog; selection and recent thread activity never reorder provider groups or model rows. Alias folding retains the selected identity in the original catalog slot. Closing retains the displayed selection and rows until unmount. Search, keyboard navigation, unavailable rows and management remain available. Selection focus restores only after saving and exit settle, to the visible model entry or More button, without overriding a newer focus choice.

Runtime status distinguishes no Desktop provider (`not_configured`), configured but unavailable keys or catalog (`missing_keys` or `empty`), and actual connection or protocol errors.

## Model identity and recovery
Thread snapshots, list items, and patches carry `model_id` and `reasoning_selection` as thread defaults. The last is a disabled, ungrouped display of a thread's missing model; Flower never silently replaces it.

See [reasoning selection ownership](../ai/model-reasoning-runtime.md#selection-controls) for loading, draft, and submission rules.

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

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.modelMenu.browser.test.tsx` - New/existing threads across five widths, catalog order, exit geometry, keyboard and delayed-save focus.
- `redeven:desktop/scripts/check-flower-model-picker.mjs` - Built Electron picker acceptance at desktop and narrow widths, with per-frame geometry and owned-process cleanup.
