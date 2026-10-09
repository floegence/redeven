---
type: UI Contract
title: Flower model and navigation presentation
description: Model-source controls, notifications, thread selection, and staged content ownership.
tags: [ai, flower, models, navigation]
timestamp: 2026-10-08T00:00:00Z
---
# Summary

Flower keeps environment and Desktop model sources explicit, preserves thread-owned model and reasoning defaults, and keeps unavailable selections distinct from first-time setup. Thread selection separates immediate visual intent from committed content and rejects stale loads. Transient operation failures use host notifications instead of transcript content, while canonical run and tool failures stay with their owning timeline renderers.

# Contract

## Mechanism

Before the initial settings snapshot arrives, the composer shows a compact
model-loading indicator with a localized accessible status. Settings, the
Runtime baseline directory, and thread history start independently. Dynamic
directory checks run in the background; a ready static model remains usable.
Settings, history, and directory failures expose their own recovery actions.
The empty directory still exposes refresh and model management without blocking
navigation, closing the companion, or retaining a draft.

Authorized platform models use a separate read-only `platform_model_source`, described in [Authorized platform model gateway](../ai/platform-model-gateway.md). They require no local Provider key or editable model profile. The model menu groups this source under `Redeven AI` when another source is present. A selected platform default is scoped to the session owner; its current authorized catalog controls readiness.

The shared settings contract separates `defaults.permission_type`, nullable `model_profile`, and optional `model_source`. Provider editing, first-time setup, default-permission autosave, and the settings layout follow [Flower setup and settings](flower-setup-and-settings.md). A `remote_desktop` Env App session may expose the Desktop catalog alongside the environment profile; `local_host` and ordinary browser sessions ignore the unbound Desktop diagnostic object. Runtime status distinguishes no Desktop provider (`not_configured`), configured but unavailable keys or catalog (`missing_keys` or `empty`), and actual connection or protocol errors.

## Model identity and recovery

Thread snapshots, list items, and patches carry `model_id` and
`reasoning_selection` as thread defaults. Composer capabilities and availability
come from the Runtime directory described in
[model directory ownership](../ai/model-directory-and-selection.md), including
exact Desktop identities, token limits, modalities, and reasoning defaults.
The settings catalog supplies editing candidates only. Every composer option
has an explicit source: `model_profile`, `desktop_model_source`, `platform`, or
`thread_snapshot`. The last is a disabled, ungrouped display of a thread's
missing model; Flower never silently replaces it. Multiple sources are grouped
with environment models first and the fixed `Desktop` label for Desktop models.

New Chat starts with the Runtime's current model. An explicit environment or
platform choice persists the default; a Desktop choice stays in the mounted
surface's draft. Repeated New Chat actions preserve that draft. Creating a
thread sends its exact chosen model, with draft reasoning only when supported.
Switching to a model without reasoning clears the draft reasoning override.
Existing threads resolve their own `model_id` first. Changing it calls
`setThreadModel`; an environment-model change also persists the environment
default, while a Desktop-model change stops after the thread PATCH. Returning
to New Chat restores its draft without copying the thread preference.

The exact directory entry controls chat readiness independently of web search.
A pending selected model shows a checking status; an unavailable selection
retains its identity and exposes refresh, another model, and settings. Existing
conversations and configured profiles retain these controls even with no
usable models. Actual Desktop connection or protocol failures expose connection
recovery. `missing_keys` recovers through Desktop settings, `unsupported` through
remote Runtime settings, and `connecting`, `expired`, or `error` through
Connection Center. First-time setup follows
[Flower setup and settings](flower-setup-and-settings.md).

Refresh uses `adapter.loadModelDirectory(true)` through the owning connection's
shared read resource. It preserves thread selection, input, attachments, canvas
binding, and model preferences. Existing-thread launch omits a global model
override, and waiting-input responses retain the Turn's frozen configuration.
Active, queued, waiting, compacting, or read-only threads retain their existing
model-change boundaries and cancellation controls.

The searchable model menu uses Floe's owner-aware `SurfaceFloatingLayer` for
portal placement, clamping, and nested Escape ownership. Its list scrolls while
search and recovery actions remain visible. Escape closes only the model menu
and restores trigger focus; it does not close a Tessiven chat window or the
composer More panel.

Thread inventory has independent `loading`, `ready`, and `error` states. Failure
leaves the sidebar usable and replaces its skeleton with a localized retry
action. Cross-layer tests cover Runtime directory projection, labels, reasoning
defaults, thread creation, and first-turn payloads together.

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
