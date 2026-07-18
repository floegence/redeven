---
type: UI Contract
title: Flower approval and context state
description: Approval queue, compaction, context usage, read acknowledgement, and conflict handling.
tags: [ai, flower, approvals, context]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

Flower projects current approvals from Floret pending-approval snapshots and exposes only the queue head as actionable composer state. Context usage, compaction, and read acknowledgement are separate typed projections with explicit ownership and compare-and-swap identity. Activity history cannot recreate current approvals, model context, or read state, and conflicts reload authoritative state instead of preserving stale user actions.

# Contract

## Mechanism

Current approval decisions belong in the composer and follow the in-memory product projection of Floret's pending approval snapshot. The queue snapshot carries generation, revision, current action id, current position, total, and unresolved count; each action carries immutable queue order, queue generation, batch index, and batch size. When the selected thread has a pending `primary_action`, the composer body replaces the text or secret input with exactly that approval panel, and the footer primary controls become Reject and Approve. Other pending actions remain read-only locators. A decision validates the current Floret pending identity before release, and Redeven records only the authorization audit. Refresh, reconnect, and restart rebuild approval presentation from Floret; no Redeven approval request, lifecycle event, idempotency, or outbox row is queryable as a second authority. Historical activity may show approval participation but cannot create current actionable state.

Context usage and compaction state share one Floret-owned canonical model while using distinct Flower presentation affordances. During an active process, `context.usage.updated` and `context.compaction.updated` update only the in-memory live materialized state. Bootstrap and reconnect call `ThreadMaintenanceHost.ReadThreadContext`, validate the returned snapshot, and map its current usage plus compaction history into the response; Redeven does not persist those mapped values or a context cursor. A compaction divider is keyed only by typed `operation_id`, with typed `request_id` and `source`; metadata aliases and generated identities are rejected. The divider is not a transcript message and does not affect message ordering, read revision, copying, or model-visible history.

Flower `/compact` is a composer command, not a chat message. Running threads forward the request into the active Floret hosted-turn lifecycle. Idle threads use an operation-only background path that owns only product command admission, queueing, mutual exclusion, cancellation, and the in-memory running divider; the worker calls Floret `Host.CompactThread` and validates the canonical terminal result. Redeven does not synthesize noop/completion lifecycle, commit provider continuation, or run a context-boundary compensation transaction. A cancellation before Floret starts ends only the product operation. Cold bootstrap reads terminal compaction history from `ReadThreadContext`; it never replays an uncommitted in-memory running divider. User turns sent during idle compaction enter the queued follow-up lane and start through the ordinary turn path after the operation clears.

Thread read state is a user-scoped product acknowledgement over a canonical Floret activity snapshot. `ThreadView.FlowerActivity` derives its revision and signature from Floret `ThroughOrdinal`, latest canonical message time, and waiting signal identity at read time; those values are not stored on `ai_threads`. The read-state store persists only the user's acknowledgement. Floret context telemetry does not advance this product acknowledgement.

Mark-read requests echo a snapshot previously delivered by the server. Future snapshots are rejected, current-revision signature, waiting-prompt, or last-message mismatches remain protocol errors, and stale snapshots are accepted without pretending they covered newer activity; the response still returns the current authoritative `read_status`. The shared Flower adapter returns that `read_status` directly instead of reloading the bootstrap. A selected running thread that completes while the user keeps it selected is therefore marked read from the final snapshot by the Flower surface, while background completions remain unread until selected.

# Boundaries

Flower does not derive the current pending ordinary-tool approval from activity rows, transcript rows, audit records, or empty assistant block projections. Redeven projects ordinary pending approvals from Floret `ListPendingApprovals` only, and it maps that product-neutral snapshot to Flower `approval_actions` before bootstrap, `timeline.replaced`, and `approval.requested` delivery. Activity rows render the Floret `ActivityTimeline` item presentation that originated from Redeven `ToolPresentationSpec`; the UI does not look up a pending approval by run id/tool id to replace row labels or payload, and it does not hide duplicate tool/approval rows as a fallback. A Floret tool activity item with `approval_state=requested` must remain a single waiting row until explicit approval resolution, and Redeven validates that contract at the Floret projection boundary instead of repainting invalid lifecycle states in the UI. Resolved activity can remove or mark old approval actions, but an activity timeline entry with `approval_state=requested` is audit history unless the Floret pending snapshot still contains the matching approval. `requires_approval=true` without `approval_state=requested` and `status=waiting` is not a UI lock: it records historical approval participation while allowing terminal and structured detail expansion.

Flower does not infer read snapshots from run status, timestamps, message previews, context telemetry, or local activity tables. It applies `read_status` delivered by bootstrap/list/patch payloads and only persists read state for the currently selected thread. Selected-thread read sync updates local `read_status` from the `/read` response; if the response is still unread, Flower only queues another persistence attempt when the returned snapshot key differs and the thread remains selected.

Flower does not parse provider request metadata, database rows, or transcript text to estimate context pressure. It renders context usage and compaction only from typed live/bootstrap fields projected by Redeven from structured Floret observations. The composer last-known context indicator can reuse a previous `context_usage` value, but it must label that freshness explicitly and must not synthesize a replacement ratio while waiting for the current run's Floret observation. Flower slash commands are local composer actions; `/compact` does not enter the transcript and does not cancel or replace a running agent turn.

# Evidence

- `redeven:internal/flower_ui/src/flowerLiveReducer.ts:407` - `context.usage.updated` is applied as thread presentation state.
- `redeven:internal/ai/run.go:574` - Active manual compaction captures the operation anchor when the request is queued.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:1930` - Active subagent detail tailing is limited to queued/running/waiting-input states.
- `redeven:internal/ai/floret_events.go:464` - Floret context status is projected onto the Redeven Flower run id before emitting `context_usage`.
- `redeven:internal/flower_ui/src/chat/flowerContextPresentation.ts:94` - The composer context indicator labels last-known usage through explicit presentation copy.
- `redeven:internal/ai/flower_live_types.go:401` - Approval actions and queue snapshots carry typed ordering, batch, generation, revision, and current-position fields.
