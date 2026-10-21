---
type: UI Contract
title: Flower subagent detail window
description: Stable parent-scoped child current views, live replacement, and queued-input controls.
tags: [ai, flower, subagents, ui]
timestamp: 2026-10-21T00:00:00Z
---
# Summary

The child detail window reads the complete canonical Floret `ThreadView`. HTTP and live updates share the selected parent-child identity, while Activity and queued-input controls remain attached to the same canonical child. The window preserves navigation and scroll state across updates without creating a second transcript or lifecycle owner.

# Contract

The detail GET returns exactly `{ summary, current }` and accepts no paging query. `current` is the complete Floret child `ThreadView`; Redeven has no detail timeline DTO, page merger, load-more path, or second transcript. The parent-scoped workspace stream carries child updates as optional `thread.batch.subagent_current`: envelope `thread_id` names the parent and `subagent_current.thread_id` names the child. Child currents use the same bounded unsent-text coalescing and transient browser-frame rules as roots, described by [live current transport](flower-live-timeline.md). Lifecycle boundaries separately refresh the complete membership list.

The shared `ThreadCache` owns the only child body. `retainDetails(ids)` derives its bounded retention set from the open detail identity and the currently selected attention child. Sidebar selection protects the primary conversation. These identities protect detail and summary visibility through LRU eviction, authoritative root-list replacement, and reconnect baselines. The cache retains at most twelve detail records; opening a child counts as a user visit, while background updates never raise visit priority. Identity changes update retention before asynchronous receipt; close, parent navigation, leaving Flower, and disposal release it. Released children follow ordinary eviction and are removed by the next authoritative root inventory. No second body, persistent cache, or window-open flag exists.

HTTP and SSE pass through the same safe current projection and selection receiver. Only the selected parent-child identity can update the window; older HTTP content cannot replace a newer live version, and same-version reads may update independent context. Generation, cancellation, and connection epoch fence late responses. Success requires an actually readable shared cache detail, including for same-version or stale acknowledgements. Missing detail records emit a convergence diagnostic and expose the existing retry state; valid empty detail shows an explicit empty state. A reconnecting `ready` performs one deduplicated HTTP refresh for the open child to recover a missed terminal view; no timer or polling loop exists. The window follows updates while its controller retains follow intent, otherwise preserving scroll position and offering the existing return-to-latest control. Live updates add no syncing message, pulse animation, or bottom status lane, so the content boundary remains fixed.

The detail window requires the production `FlowerTurnTimeline`, shared with the parent conversation. There is no alternate ledger renderer or grouping projection. Turns and nested entries render from stable semantic keys and read changing content through accessors; object identity, status, payload, position, and `view_version` never own component lifetime. Indexed native text appends notify the affected record without regrouping history or refreshing retention. An activity phase keeps one root and body owner while it grows from one operation to many: the single-operation form hides only the group summary, so an already-open tool row, disclosure controller, and terminal viewport remain mounted. Shared disclosure ownership preserves initial defaults and user choices.

[Activity disclosure interaction](flower-activity-interaction.md) owns shared native activation, floating controls, and scroll policy. Parent transcript and child detail each pass their own viewport controller to the shared renderer; opening a child tool cannot change parent following or anchoring. Later child currents request layout measurement without claiming follow intent. Selection and current view are bounded human UI state; neither is injected into parent model context or persisted as another transcript.

The detail window hides its avatar switcher for a single child. With multiple canonical members, a wrapping avatar strip switches the same stable window through the existing parent-scoped selection and load path. Navigation sorts by canonical creation time with child identity as the tie-breaker; status, update time, and selection never reorder these controls. The overview reserves separate navigation and metadata columns, with a fixed context slot inside metadata, so deferred context loading and changing status or duration cannot move or rewrap avatars. Narrow windows put metadata on its own reserved row. Context details anchor below the overview within the window width. Keyed controls retain keyboard focus across live updates. Switching never changes the parent conversation. Narrow layouts reserve only the visible navigation inset, keeping detail usable when the rail becomes an overlay.

The detail has no independent chat composer. Historical queued inputs offer Steer now and Remove through one parent-scoped operation boundary shared by Env App and Desktop. Each row freezes its full-input fingerprint; a conflict refreshes canonical detail and preserves usable controls. Busy and failure state belongs only to that row. Navigation, closing the window, and parent Stop remain available. Selection identity and connection epoch prevent late operation responses from reopening a window or replacing another child's content. Reconnection uses the existing live/current refresh, without polling.

Canonical parent steering renders as one stable user message. Pending and cancelled guidance show status; applied guidance shows no status line. Cancelled guidance explains why it was not applied. Only a `stopped` cancellation offers explicit Send again; unknown-effect failures explain the boundary without a retry control. Floret remains the lifecycle owner described in [Subagent runtime](../ai/subagent-runtime.md).

# Boundaries

The detail window must not infer membership from activity, poll for updates, switch the selected parent conversation, persist a second transcript, or replay uncertain effects. [Subagent detail presentation](flower-subagent-detail.md) owns parent membership, task labels, dropdown and operation capsules.

# Evidence

- `redeven:internal/ai/flower_current_projection.go` - Shares the safe current projection between HTTP and SSE.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Owns stable selection, monotonic current updates, and separate parent and child activity viewports.
- `redeven:internal/flower_ui/src/threadCache.ts` - Owns bounded retained detail and root-inventory cleanup; cache tests cover capacity, reconnect, attention and release.
- `redeven:internal/flower_ui/src/SubagentDetailWindow.tsx` - Requires shared timeline rendering and keeps loading, retry, empty detail, input controls and viewport ownership explicit.
- `redeven:internal/flower_ui/src/flowerSubagentDetailThread.ts` - Builds detail from the canonical child view.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.finalArchitecture.browser.test.tsx` - Verifies current replacement preserves window, Activity, terminal viewport, and parent scroll state.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.subagentSteering.browser.test.tsx` - Verifies queued-input controls, recoverable conflicts, Stop and late-response isolation.
