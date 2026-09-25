---
type: UI Contract
title: Flower model and navigation presentation
description: Model-source controls, notifications, thread selection, and staged content ownership.
tags: [ai, flower, models, navigation]
timestamp: 2026-09-25T00:00:00Z
---
# Summary

Flower keeps environment and Desktop model sources explicit, preserves thread-owned model and reasoning defaults, and keeps unavailable selections distinct from first-time setup. Thread selection separates immediate visual intent from committed content and rejects stale loads. Transient operation failures use host notifications instead of transcript content, while canonical run and tool failures stay with their owning timeline renderers.

# Contract

## Mechanism

The shared settings contract separates `defaults.permission_type`, nullable `model_profile`, and optional `model_source`. Provider editing, first-time setup, default-permission autosave, and the settings layout follow [Flower setup and settings](flower-setup-and-settings.md). A `remote_desktop` Env App session may expose the Desktop catalog alongside the environment profile; `local_host` and ordinary browser sessions ignore the unbound Desktop diagnostic object. Runtime status distinguishes no Desktop provider (`not_configured`), configured but unavailable keys or catalog (`missing_keys` or `empty`), and actual connection or protocol errors.

Thread snapshots, list items, and thread patches carry `model_id` and `reasoning_selection` as thread defaults. Flower renders a fused model/reasoning segmented control in the composer when model options are available; the reasoning segment is shown only when the selected model exposes controllable reasoning capability. A ready Desktop model source contributes a read-only model catalog alongside editable environment provider models, preserving each opaque model id, display label, token limits, modalities, and reasoning capability. Every composer option has an explicit source: `model_profile`, `desktop_model_source`, or `thread_snapshot`. `thread_snapshot` is a disabled, ungrouped option used only when an existing thread references a model no longer present in either catalog; Flower does not regroup or silently replace that model. When both active catalogs exist, the compact menu groups the environment models first under the environment display name and Desktop models second under the fixed `Desktop` name; a single active source remains a flat list. A new Flower mount selects the environment profile's persisted `current_model_id`, falling back to the Desktop current model only when the environment profile is absent. Selecting another environment model calls `persistDefaultModel`; selecting a Desktop model writes only the mounted surface's pending-new-thread draft. Repeated New Chat actions in that mount retain the draft, while a remount restores the environment default. Creating a new thread always sends the chosen draft model explicitly, and draft reasoning is included only when that model supports reasoning control. Switching to a model without reasoning removes any draft reasoning override before launch. An existing thread always resolves its own `model_id` first. Changing it sends `setThreadModel`; an environment-model change then persists the environment default, while a Desktop-model change stops after the thread PATCH. Returning to New Chat restores the mounted new-thread choice without copying the thread model into the environment default. Readiness is evaluated for the selected option's source: environment models require their provider and web-search keys, while Desktop models require a `ready` source containing that exact model id. If the selected model is unavailable but another source is usable, the composer and model menu remain visible, send stays disabled, the model trigger shows a compact warning, and the menu shows one compact Desktop status row without a global banner. First-time configuration follows [Flower setup and settings](flower-setup-and-settings.md). Existing conversations and configured profiles retain composer recovery controls when no model is usable. A configured remote profile does not show an unrelated Desktop setup warning; actual Desktop connection or protocol failures retain their diagnostics and connection recovery action. Refresh calls only `adapter.loadSettings()` and atomically replaces the settings snapshot, preserving thread selection, input, attachments, mounted Desktop draft, and environment default. `missing_keys` recovers through Desktop Flower settings, `unsupported` through remote Runtime settings, and `connecting`, `expired`, or `error` through Desktop Connection Center. Existing-thread launch does not add a global model override, so subsequent turns use the persisted thread default and waiting-input responses do not override the frozen Turn configuration. The model/reasoning segmented control is disabled while the selected thread is active, waiting for user input, compacting, read-only, or otherwise unable to accept a thread preference change. Thread inventory has its own `loading`, `ready`, and `error` states. A failed or timed-out inventory request leaves the sidebar usable, replaces the skeleton with a localized retry action, and never blocks the composer or the main empty state. The Flower UI quality gate explicitly runs a cross-layer Desktop model-source test that renders the shared surface over the real Env adapter and verifies catalog projection, labels, reasoning defaults, thread creation, and first-turn RPC payloads together.

See [reasoning selection ownership](flower-reasoning-selection.md) for loading, draft, and submission rules.

## Web search presentation

Model choices display the shared search badge from the server's readonly
`web_search` projection. Search availability is independent of ordinary chat
readiness. Settings show the selected model set's actual state, including mixed
availability and missing Brave credentials, using the same localized labels in
Desktop and Env App. A provider brand or frontend model name never enables search.
Unreviewed pending draft projections are displayed as pending and never saved as
user preferences. See [model directory ownership](../ai/model-directory-and-selection.md).

## Permission and navigation

Below the 768px viewport breakpoint, the composer keeps permission status and
selection in its own More panel, alongside any other overflow controls. The
footer does not repeat the permission control. Desktop retains its measured
inline/overflow placement. Both locations use the same permission owner and
submission path; moving between them preserves the composer DOM, draft and text
selection. Permission options open above the panel, stay within the viewport and
retain 44px mobile touch targets. Escape closes the options before the More
panel, returning focus to the corresponding trigger.

Existing-thread permission changes remain available during active work when the detail is loaded, the thread is writable, and its adapter supports the settings PATCH. Saving disables only the permission control, prevents duplicate requests, merges the authoritative settings response, and restores the confirmed value on failure. The confirmed displayed mode applies to the next tool authorization in the active task and queued work. Already prepared calls retain their invocation snapshot; users do not need to stop or send another message. Pending approvals and user input remain canonical interactions and are not settled or replaced by a settings response. Model and reasoning retain their busy lock. Full access uses soft fill and text color without an additional warning border; keyboard focus remains visible.

Permission follows the same ownership boundary: environment `defaults.permission_type` applies only to new Threads. A new-thread draft stores `permission_type_override` only after an explicit choice and clears it when matching the loaded default; existing Threads use their own `permission_type`. While settings load, the control is a non-interactive safety placeholder and never persists `approval_required`. Launch omits `permission_type` without an override; the backend resolves and freezes the default in Thread settings. Saving the default updates unmodified new-thread drafts, never existing Threads or explicit overrides.

Flower treats user-triggered operation failures and input blockers as transient feedback, not transcript content. The shared surface emits a host notification intent for send failures, invalid or blocked submits, model/default-model persistence failures, permission changes, approval submits, and sidebar actions; Env App and Desktop render that intent as a toast through their own notification systems. These toasts do not change the canonical thread timeline, and Flower no longer inserts composer or sidebar error cards into the page flow for those transient actions. Run failures, tool failures, subagent detail errors, and other structured timeline/detail content remain rendered by their owning timeline or detail renderer rather than being guessed from the notification channel.

Thread navigation separates visual, requested, and displayed ownership. A user click marks the list row immediately, then commits selection after the intent paint. A thread whose detail is already in the explicit warm set is displayed atomically without calling `loadThread` again. A cold target loads in staging while the previous transcript remains visible and read-only; only the newest request may publish the target transcript, focus the composer, restore tail position, or emit `content_presented`. Compose mode, permission changes, programmatic focus ownership, and newer thread requests cancel or supersede the pending user transaction. Warm sessions switch without provider or transcript remount and stale loads cannot replace the current thread.

# Boundaries

Flower does not treat the global model or permission as an existing-Thread launch override. Both are defaults only for the next new Thread. After creation, its `model_id`, `reasoning_selection`, and `permission_type` are authoritative; Thread changes write to its settings, while new-thread overrides stay connection-local and never update environment defaults.

The Activity companion reuses this model and selection contract; its placement, presence, read gate, and Activity/Workbench focus isolation are defined in [Flower Activity companion](flower-activity-companion.md). The header switcher is only a product-specific compact presentation; it does not create a second selected-thread owner or change the requested, committed, and content-presented ordering.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.mobile.browser.test.tsx` - Mobile permission placement, draft retention, request success/failure and keyboard dismissal.

- `redeven:internal/flower_ui/src/FlowerSurface.tsx:128` - Flower recognizes `model_io.updated` as a model-status presentation boundary.
- `redeven:internal/flower_ui/src/contracts/flowerSurfaceContracts.ts:380` - Flower thread snapshots expose `model_id` and `reasoning_selection`.
- `redeven:internal/flower_ui/src/runtimeFlowerSurfaceAdapter.ts:235` - The runtime adapter keeps thread model PATCH and environment default persistence as separate operations.
- `redeven:internal/envapp/ui_src/src/ui/flower/envLocalFlowerSurfaceAdapter.ts:288` - The Env adapter exposes Desktop models only for the stable `remote_desktop` session route.
- `redeven:scripts/check_flower_ui.sh:26` - The Flower UI quality gate includes the Desktop model-source cross-layer test explicitly.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.navigation.test.tsx:460` - Combined navigation coverage rejects late detail loads across rapid A-to-B-to-A selection.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.navigation.structuredInput.test.tsx:412` - Summary-only refresh coverage preserves cached detail for non-selected threads.
- `redeven:internal/envapp/ui_src/src/ui/pages/settings/sections/FlowerSection.tsx:219` - Env Settings selects the remote Desktop model-source layout from stable session routing rather than transient binding state.
