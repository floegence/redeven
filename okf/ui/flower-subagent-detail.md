---
type: UI Contract
title: Flower subagent detail presentation
description: Parent header membership, canonical thread routing, and child execution detail and canonical input controls.
tags: [ai, flower, subagents, ui]
timestamp: 2026-10-21T00:00:00Z
---
# Summary

- Authority: Floret v7 parent-scoped `ThreadRuntime.List` owns child membership; the child's complete `ThreadView` is the only detail-content authority.
- Outcome: Flower opens a stable, parent-scoped detail window immediately and updates it live without polling or layout-changing sync chrome.
- Invariants: every public child route uses canonical `thread_id`; `task_name` is required and never guessed from title, role, description, or message.
- Failure boundary: malformed summaries, missing canonical identity, parent-child mismatch, or invalid detail contracts are rejected rather than mapped through legacy aliases.

# Contract

The parent header replaces the numeric robot badge with at most three circular canonical portraits and a separate `+N` remainder. Running children own the stack whenever present; every running identity can rotate into the foreground without increasing the visible portrait count. With no running children, waiting, queued, and unknown children retain static color; only a fully settled inventory becomes gray. The remainder counts the represented pool minus three and disappears at three or fewer. The accessible header label and existing dropdown preserve every lifecycle status, including failures and waiting input. Rotation pauses for keyboard focus, pointer hover, an open dropdown, hidden documents, unconfirmed live presentation, and reduced-motion preferences; timers are local presentation state and are disposed with the component. The existing surface-local floating layer, keyboard activation, Escape dismissal, and detail routing remain authoritative.

Thread-level child membership comes from Floret v7 `ThreadRuntime.List` scoped by canonical parent id. Redeven maps that list into `thread.subagents` for membership and summary presentation only. An empty or updated list never clears the current open child detail. The header dropdown never scans transcript activity, audit rows, or product settings to infer membership.

`FlowerSubagentSummary` contains `parent_thread_id`, canonical child `thread_id`, required `task_name`, task description, agent type, context mode, status, timing, and current control flags. There is no `subagent_id` or `title` compatibility field. Activity payloads route `Open messages` with `thread_id` only. Delegated approval presentation uses `child_thread_id`; it does not duplicate the same identity under another name.

SubAgent tool rows are action-first. One localized formatter combines the typed operation action with the Activity lifecycle and outcome counts, so spawn, wait, list, status, inspect, send-input, close, and close-all never collapse to the ambiguous title “Subagents.” Every target appears immediately as an inline capsule in request order, with its canonical portrait, compact task name, and status glyph. A single target sits beside the operation title in a compact capsule matching the tool row height; its task name appears only in the capsule. Multiple capsules wrap within the transcript. Touch input retains a larger activation target. Management tools have no disclosure or chevron. Clicking or activating a capsule opens the existing floating detail window directly. Operation errors remain visible inline; a failed creation without a canonical child identity never fabricates a clickable capsule. Unknown or invalid operation data uses a neutral operation title and never guesses from a generic label.

Historical management rows describe their own invocation. Published Floret v7.32.1
supplies canonical dispatch/result timestamps; each row displays that fixed
execution interval after success, failure, cancellation, or timeout. Only an
unfinished running or waiting invocation with a recorded start uses the page
clock. Missing execution boundaries leave duration unavailable, without a
turn-duration or child-clock substitute. Saved target statuses and wait counts
remain facts at the operation boundary. Current inventory may fill missing task
identity by exact `thread_id`, but cannot rewrite those outcomes or supply timing.
Capsule glyphs preserve the recorded target status at the invocation boundary. Their
accessible names expose the full task name and localized status; hover titles
also retain the task description. Live inventory changes retain the same capsule
and keyboard focus.
Current child status and runtime appear in the child dropdown and detail overview;
later child turns, live replacements, history reloads, and terminal refresh cannot
restart an old management row's timer.

The dropdown is a compact accessible floating surface over the parent thread. The header shows total and active counts without separate metric cards. Active rows remain visible; ended rows start collapsed every time the dropdown opens. The ended disclosure shows its count, two overlapping small avatars, and a +N remainder; failures and timeouts retain a visible failure count. Expanding replaces the avatar summary with the complete ended list. Live membership updates retain the disclosure choice and update counts and previews from the canonical inventory. Rows sort by canonical status and update time. Keyboard navigation supports arrows, Home, End, Enter, Space, and Escape; it includes the disclosure and only mounted visible rows. The disclosure exposes its expanded state and controlled region to assistive technology. Selecting a row synchronously creates one stable detail selection and opens its floating detail window with a loading skeleton. A boolean-equality projection of selection presence is the only window-visibility input; current-view, summary, request, and error updates cannot restart the floating-window presence animation. There is no second writable open state. The window does not wait for HTTP, select a sidebar child thread, or create a child composer. Temporary inventory omission cannot close it; only explicit close, parent-thread selection change, or leaving Flower can do so. Initial failure stays visible with an in-place retry.

Child identity uses one original vector avatar catalog: 36 individually drawn characters with distinct silhouettes and fixed palettes, replacing the shared animal-and-accessory construction. Canonical child `thread_id` deterministically selects the same artwork in the dropdown, collapsed summary, and detail overview, independently of task text, status, row order, or live updates. Full avatars use rounded-square framing; the compact summary uses overlapping circles. Artwork colors are intrinsic asset colors, while surrounding chrome follows the host theme. Avatars are decorative; accessible row names preserve every localized lifecycle status. Running and completed rows show a static status glyph and duration; waiting, failure, timeout, cancellation, and other exceptional states retain visible labels. These surfaces never use a thinking orb for child identity or running status. The native floating header combines the task name and delegated work description in one title with the canonical avatar; it retains the native drag, maximize, close, and accessible naming behavior. The body overview puts the avatar switcher beside compact status, role, duration, and context metadata, wrapping within narrow windows. A single child hides the switcher and keeps its avatar in the header. The transcript has no full-height decorative guide line.

The detail GET returns exactly `{ summary, current }` and accepts no paging query. `current` is the complete Floret child `ThreadView`; Redeven has no detail timeline DTO, page merger, load-more path, or second transcript. The parent-scoped workspace stream carries child updates as optional `thread.batch.subagent_current`: envelope `thread_id` names the parent and `subagent_current.thread_id` names the child. Child currents use the same bounded unsent-text coalescing and transient browser-frame rules as roots, described by [live current transport](flower-live-timeline.md). Lifecycle boundaries separately refresh the complete membership list.

The shared `ThreadCache` owns the only child body. `retainDetails(ids)` derives its bounded retention set from the open detail identity and the currently selected attention child. Sidebar selection protects the primary conversation. These identities protect detail and summary visibility through LRU eviction, authoritative root-list replacement, and reconnect baselines. The cache retains at most twelve detail records; opening a child counts as a user visit, while background updates never raise visit priority. Identity changes update retention before asynchronous receipt; close, parent navigation, leaving Flower, and disposal release it. Released children follow ordinary eviction and are removed by the next authoritative root inventory. No second body, persistent cache, or window-open flag exists.

HTTP and SSE pass through the same safe current projection and selection receiver. Only the selected parent-child identity can update the window; older HTTP content cannot replace a newer live version, and same-version reads may update independent context. Generation, cancellation, and connection epoch fence late responses. Success requires an actually readable shared cache detail, including for same-version or stale acknowledgements. Missing detail records emit a convergence diagnostic and expose the existing retry state; valid empty detail shows an explicit empty state. A reconnecting `ready` performs one deduplicated HTTP refresh for the open child to recover a missed terminal view; no timer or polling loop exists. The window follows updates while its controller retains follow intent, otherwise preserving scroll position and offering the existing return-to-latest control. Live updates add no syncing message, pulse animation, or bottom status lane, so the content boundary remains fixed.

The detail window requires the production `FlowerTurnTimeline`, shared with the parent conversation. There is no alternate ledger renderer or grouping projection. Turns and nested entries render from stable semantic keys and read changing content through accessors; object identity, status, payload, position, and `view_version` never own component lifetime. Indexed native text appends notify the affected record without regrouping history or refreshing retention. An activity phase keeps one root and body owner while it grows from one operation to many: the single-operation form hides only the group summary, so an already-open tool row, disclosure controller, and terminal viewport remain mounted. Shared disclosure ownership preserves initial defaults and user choices.

[Activity disclosure interaction](flower-activity-interaction.md) owns shared native activation, floating controls, and scroll policy. Parent transcript and child detail each pass their own viewport controller to the shared renderer; opening a child tool cannot change parent following or anchoring. Later child currents request layout measurement without claiming follow intent. Selection and current view are bounded human UI state; neither is injected into parent model context or persisted as another transcript.

The detail window hides its avatar switcher for a single child. With multiple canonical members, a wrapping avatar strip switches the same stable window through the existing parent-scoped selection and load path. Navigation sorts by canonical creation time with child identity as the tie-breaker; status, update time, and selection never reorder these controls. The overview reserves separate navigation and metadata columns, with a fixed context slot inside metadata, so deferred context loading and changing status, role, or duration cannot move or rewrap avatars. Narrow windows put metadata on its own reserved row. Context details anchor below the overview within the window width. Keyed controls retain keyboard focus across live updates. Switching never changes the parent conversation. Narrow layouts reserve only the visible navigation inset, keeping detail usable when the rail becomes an overlay.

The detail has no independent chat composer. Historical queued inputs offer Steer now and Remove through one parent-scoped operation boundary shared by Env App and Desktop. Each row freezes its full-input fingerprint; a conflict refreshes canonical detail and preserves usable controls. Busy and failure state belongs only to that row. Navigation, closing the window, and parent Stop remain available. Selection identity and connection epoch prevent late operation responses from reopening a window or replacing another child's content. Reconnection uses the existing live/current refresh, without polling.

Canonical steering renders as one stable user message with pending, applied, or cancelled status. Cancelled guidance explains why it was not applied. Only a `stopped` cancellation offers explicit Send again; unknown-effect failures explain the boundary without a retry control. Floret remains the lifecycle owner described in [Subagent runtime](../ai/subagent-runtime.md).

# Boundaries

Flower must not recover a missing child identity from activity sidecars, a title, a delegated approval alias, a fallback thread id, or local state. It must not humanize an absent task name into a role-based label. Redeven does not read Floret storage tables, persist child membership, poll child detail, rebuild it from detail events, or maintain a second transcript authority; optional child product settings contain presentation and policy only.

Child events use the [parent timeline](flower-parent-events.md), canonical avatars and existing detail routing. The dropdown lists tasks only.

# Evidence

- `redeven:internal/flower_ui/src/SubagentAvatarStack.tsx` - Owns bounded portrait rotation and local motion cleanup.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.subagentHeader.browser.test.tsx` - Verifies running overflow, live completion, gray settlement, motion preferences, themes, and narrow header access.

- `redeven:internal/ai/types.go:172` - Backend SubAgent summaries expose canonical thread identity only.
- `redeven:internal/ai/subagents_floret.go` - Membership and detail read through parent-scoped Floret v7 typed APIs.
- `redeven:internal/ai/flower_runtime_current_routing.go` - Routes every child current through its canonical parent stream.
- `redeven:internal/ai/flower_current_projection.go` - Applies one safe projection to HTTP and SSE child current.
- `redeven:internal/flower_ui/src/contracts/flowerSurfaceContracts.ts:486` - UI contracts require `thread_id` and `task_name` without aliases.
- `redeven:internal/flower_ui/src/flowerLiveMapper.ts:744` - Wire mapping accepts only canonical child thread identity.
- `redeven:internal/flower_ui/src/flowerSubagentProjection.ts:128` - Header rows derive directly from canonical summaries.
- `redeven:internal/flower_ui/src/flowerSubagentDetailThread.ts` - Child detail requires canonical summary identity and task name.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Owns the stable detail selection, monotonic HTTP/SSE receiver, and explicit parent and child activity viewport scopes.
- `redeven:internal/flower_ui/src/threadCache.ts` - Owns bounded retained detail and root-inventory cleanup; cache tests cover capacity, reconnect, attention and release.
- `redeven:internal/flower_ui/src/SubagentDetailWindow.tsx` - Requires shared timeline rendering and keeps loading, retry, empty detail, input controls and viewport ownership explicit.
- `redeven:internal/flower_ui/src/subagentAvatarCatalog.ts` - Selects one of 36 original fixed-palette portraits by canonical child identity.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.subagentAppearance.browser.test.tsx` - Verifies collapsed previews, keyboard disclosure, live membership, identity consistency, themes, and narrow geometry.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.finalArchitecture.browser.test.tsx` - Proves streamed current replacement preserves the window, activity row, terminal viewport, disclosure motion, and parent scroll isolation.
- `redeven:internal/flower_ui/src/flowerActivityPresentation.ts` - Formats localized operation titles and exact ordered target summaries.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.activityTiming.browser.test.tsx` - Verifies invocation duration across clock ticks, child reruns, terminal replacement and reload.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.subagentDisclosure.browser.test.tsx` - Verifies direct activation, management operations, multi-child switching, live status and focus stability, failed creation, themes, and narrow wrapping.

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.subagentSteering.browser.test.tsx` - Verifies row-scoped operations, stable windows, recoverable conflicts, Stop availability, and late-response isolation.

Status checks are labeled “Check subagent status” and result reads “Read subagent results”; localized hover and accessible descriptions explain whether report bodies enter model context. Ordinary success adds no completion suffix. Child outcomes stay on the recorded target capsules, while current status remains in the dropdown and detail view. Partial waits display completed/total counts and claim a timeout only when the wait actually expired. Event tools use event labels; real child reports and completion notifications retain their own meaning.
