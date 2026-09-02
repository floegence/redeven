---
type: UI Contract
title: Flower subagent detail presentation
description: Parent header membership, canonical thread routing, and read-only child execution detail.
tags: [ai, flower, subagents, ui]
timestamp: 2026-08-15T00:00:00Z
---
# Summary

- Authority: Floret v7 parent-scoped `ThreadRuntime.List` owns child membership; the child's complete `ThreadView` is the only detail-content authority.
- Outcome: Flower opens a stable, parent-scoped read-only window immediately and updates it live without polling or layout-changing sync chrome.
- Invariants: every public child route uses canonical `thread_id`; `task_name` is required and never guessed from title, role, description, or message.
- Failure boundary: malformed summaries, missing canonical identity, parent-child mismatch, or invalid detail contracts are rejected rather than mapped through legacy aliases.

# Contract

Thread-level child membership comes from Floret v7 `ThreadRuntime.List` scoped by canonical parent id. Redeven maps that list into `thread.subagents` for membership and summary presentation only. An empty or updated list never clears the current open child detail. The header dropdown never scans transcript activity, audit rows, or product settings to infer membership.

`FlowerSubagentSummary` contains `parent_thread_id`, canonical child `thread_id`, required `task_name`, task description, agent type, context mode, status, timing, and current control flags. There is no `subagent_id` or `title` compatibility field. Activity payloads route `Open messages` with `thread_id` only. Delegated approval presentation uses `child_thread_id`; it does not duplicate the same identity under another name.

SubAgent tool rows are action-first. One localized formatter combines the typed operation action with the Activity lifecycle and outcome counts, so spawn, wait, list, inspect, send-input, close, and close-all never collapse to the ambiguous title “Subagents.” A collapsed multi-target row shows the first two task names plus the remaining count; expanded detail preserves every requested target in request order. Unknown or invalid operation data uses a neutral operation title and never guesses from a generic label.

The dropdown is a compact accessible floating surface over the parent thread. Active and ended groups stay visible, rows sort by canonical status and update time, and keyboard navigation supports arrows, Home, End, Enter, and Escape. Selecting a row synchronously creates one stable detail selection and opens its read-only floating window with a loading skeleton. A boolean-equality projection of selection presence is the only window-visibility input; current-view, summary, request, and error updates cannot restart the floating-window presence animation. There is no second writable open state. The window does not wait for HTTP, select a sidebar child thread, or create a child composer. Temporary inventory omission cannot close it; only explicit close, parent-thread selection change, or leaving Flower can do so. Initial failure stays visible with an in-place retry.

The detail GET returns exactly `{ summary, current }` and accepts no paging query. `current` is the complete Floret child `ThreadView`; Redeven has no detail timeline DTO, page merger, load-more path, or second transcript. The parent-scoped workspace stream carries child updates as optional `thread.batch.subagent_current`: envelope `thread_id` names the parent and `subagent_current.thread_id` names the child. Every coalesced current is forwarded, while lifecycle boundaries separately refresh the complete membership list.

HTTP and SSE pass through the same safe current projection and the same selection receiver. The receiver accepts only the selected parent-child identity and a strictly greater `view_version`, so a late HTTP response cannot replace newer live content. A reconnecting `ready` performs one deduplicated HTTP refresh for the open child to recover a missed terminal view; no timer or polling loop exists. The window follows updates only while the user is near the bottom, otherwise preserving scroll position and offering the existing return-to-latest control. Live updates add no syncing message, pulse animation, or bottom status lane, so the content boundary remains fixed.

The detail window maps canonical child messages, interactions, and Activity into the shared renderers with one keyed reconciliation path. Ledger groups and their nested entries render from stable semantic keys and read changing content through accessors; object identity, status, payload, position, and `view_version` never own component lifetime. An activity phase keeps one root and body owner while it grows from one operation to many: the single-operation form hides only the group summary, so an already-open tool row, disclosure controller, and terminal viewport remain mounted. Every ledger disclosure stores its first default and later user choice in that keyed owner; there is no batch-only state map or parallel open authority.

The parent transcript and child detail each provide an explicit activity viewport scope to the shared renderer. Opening a child tool pauses and anchors only the child viewport; parent scroll state cannot be read or changed through that path. Scroll events produced while that anchor is active cannot change follow intent. Later child currents request one layout measurement from the existing child scroll controller, which preserves its current follow intent instead of inferring and re-enabling follow from physical proximity. The return-to-latest control or manually scrolling back to the bottom resumes child following after an explicit disclosure interaction. The selection and its current view are bounded human UI state; neither is injected into the parent model context or persisted as another transcript.

# Boundaries

Flower must not recover a missing child identity from activity sidecars, a title, a delegated approval alias, a fallback thread id, or local state. It must not humanize an absent task name into a role-based label. Redeven does not read Floret storage tables, persist child membership, poll child detail, rebuild it from detail events, or maintain a second transcript authority; optional child product settings contain presentation and policy only.

# Evidence

- `redeven:internal/ai/types.go:172` - Backend SubAgent summaries expose canonical thread identity only.
- `redeven:internal/ai/subagents_floret.go` - Membership and detail read through parent-scoped Floret v7 typed APIs.
- `redeven:internal/ai/flower_runtime_current_routing.go` - Routes every child current through its canonical parent stream.
- `redeven:internal/ai/flower_current_projection.go` - Applies one safe projection to HTTP and SSE child current.
- `redeven:internal/flower_ui/src/contracts/flowerSurfaceContracts.ts:486` - UI contracts require `thread_id` and `task_name` without aliases.
- `redeven:internal/flower_ui/src/flowerLiveMapper.ts:744` - Wire mapping accepts only canonical child thread identity.
- `redeven:internal/flower_ui/src/flowerSubagentProjection.ts:128` - Header rows derive directly from canonical summaries.
- `redeven:internal/flower_ui/src/flowerSubagentDetailThread.ts:304` - Child detail requires canonical summary identity and task name.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Owns the stable detail selection, monotonic HTTP/SSE receiver, and explicit parent and child activity viewport scopes.
- `redeven:internal/flower_ui/src/SubagentDetailWindow.tsx` - Reconciles ledger groups and nested entries by stable semantic key without a second open-state or sync path.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.finalArchitecture.browser.test.tsx` - Proves streamed current replacement preserves the window, activity row, terminal viewport, disclosure motion, and parent scroll isolation.
- `redeven:internal/flower_ui/src/flowerActivityPresentation.ts` - Formats localized operation titles and exact ordered target summaries.
