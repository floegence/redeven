---
type: UI Contract
title: Flower approval and context state
description: Approval queue, compaction, context usage, read acknowledgement, and conflict handling.
tags: [ai, flower, approvals, context]
timestamp: 2026-07-22T00:00:00Z
---
# Summary

Flower projects current approvals from complete Floret approval-queue snapshots and exposes only Floret's current actionable record in the composer. Context usage, compaction, and read acknowledgement are separate typed projections with explicit ownership and compare-and-swap identity. Activity history cannot recreate current approvals, model context, or read state, and conflicts reload authoritative state instead of preserving stale user actions.

# Contract

## Mechanism

Current approval decisions belong in the composer and follow the in-memory product projection of Floret's complete `ReadApprovalQueue` result. The queue snapshot carries generation, revision, current action id, current position, total, and unresolved count; each action carries canonical run/tool identity, queue order, approval revision, batch index, and batch size. When the selected thread has Floret's current actionable record, the composer body replaces the text or secret input with exactly that approval panel, and the footer primary controls become Reject and Approve. Other pending actions remain read-only locators. A decision re-reads the root queue, validates its compare-and-set identity, and calls Floret `ResolveApproval`; Redeven records only product authorization audit and publishes the returned complete queue as `approval.queue_replaced`. Refresh, reconnect, restart, conflict, and bounded handoff resync rebuild approval presentation from Floret. An explicit empty replacement clears old actions, while omission does not. No Redeven approval request, lifecycle, delivery, timeout, idempotency, or outbox row is queryable as a second authority. Historical activity may show approval participation but cannot create current actionable state. Redeven-owned `control_confirm` remains a separate run-scoped product confirmation and is preserved independently of Floret queue replacement.

Context usage and compaction state share one Floret-owned canonical model while using distinct Flower presentation affordances. During an active process, `context.usage.updated` and `context.compaction.updated` update only the in-memory live materialized state. Bootstrap and reconnect call `ThreadReadHost.ReadThreadContext`, validate the returned snapshot, and map its current usage plus compaction history into the response; Redeven does not persist those mapped values or a context cursor. A compaction divider is keyed only by typed `operation_id`, with typed `request_id` and `source`; metadata aliases and generated identities are rejected. The divider is not a transcript message and does not affect message ordering, read revision, copying, or model-visible history.

Flower `/compact` is a composer command, not a chat message. Running threads forward the request into the active Floret hosted-turn lifecycle. Idle threads use an operation-only background path that owns only product command admission, queueing, mutual exclusion, cancellation, and the in-memory running divider; the worker calls Floret `Host.CompactThread` and validates the canonical terminal result. Redeven does not synthesize noop/completion lifecycle, commit provider continuation, or run a context-boundary compensation transaction. A cancellation before Floret starts ends only the product operation. Cold bootstrap reads terminal compaction history from `ReadThreadContext`; it never replays an uncommitted in-memory running divider. User turns sent during idle compaction enter the queued follow-up lane and start through the ordinary turn path after the operation clears.

Thread read state is a user-scoped product acknowledgement over a canonical Floret activity snapshot. `ThreadView.FlowerActivity` derives its revision and signature from Floret `ThroughOrdinal`, latest canonical message time, and waiting signal identity at read time; those values are not stored in `ai_thread_settings`. The read-state store persists only the user's acknowledgement. Floret context telemetry does not advance this product acknowledgement.

Live-event read-state decoration is demand driven. An events response reads the canonical Floret thread and the user's acknowledgement only when it contains at least one `thread.patched` event, and it performs those reads once for the response before copy-on-write decoration of every decodable patch. Empty responses, resync events, and other presentation events pass through without a canonical thread or read-state reload. This changes only the read timing: Redeven must not infer an activity snapshot from a delta, lifecycle event, timestamp, run status, or retained presentation payload.

Mark-read requests echo a snapshot previously delivered by the server. Future snapshots are rejected, current-revision signature, waiting-prompt, or last-message mismatches remain protocol errors, and stale snapshots are accepted without pretending they covered newer activity; the response still returns the current authoritative `read_status`. The shared Flower adapter returns that `read_status` directly instead of reloading the bootstrap. A selected running thread that completes while the user keeps it selected is therefore marked read from the final snapshot by the Flower surface, while background completions remain unread until selected.

# Boundaries

Flower does not derive current ordinary or delegated tool approvals from activity rows, transcript rows, audit records, local live cards, or empty assistant block projections. Redeven maps only the root Floret `ReadApprovalQueue` snapshot to Flower actions and replaces all Floret-owned actions atomically; it never orders, promotes, times out, resolves, or retains a missing record locally. Activity rows render historical Floret tool presentation and expose no competing decision controls. A Floret activity with `approval_state=requested` remains audit history unless the same canonical record is present in the current queue. `requires_approval=true` without `approval_state=requested` and `status=waiting` records historical approval participation and is not a UI lock. The UI does not recover a queue from those markers, retain a disappeared action, or use a delayed reload result as substitute authority.

Flower does not infer read snapshots from run status, timestamps, message previews, context telemetry, or local activity tables. It applies `read_status` delivered by bootstrap/list/patch payloads and only persists read state for the currently selected thread. Selected-thread read sync updates local `read_status` from the `/read` response; if the response is still unread, Flower only queues another persistence attempt when the returned snapshot key differs and the thread remains selected.

The live event buffer is Redeven-owned presentation state, not a canonical thread cache. A returned response owns a detached event slice and detached mutable payloads where required; AppServer may share an unchanged payload only within that request. It must not expose the Service's retained mutable backing storage or cache a Floret thread snapshot to avoid authoritative reads.

Flower does not parse provider request metadata, database rows, or transcript text to estimate context pressure. It renders context usage and compaction only from typed live/bootstrap fields projected by Redeven from structured Floret observations. The composer last-known context indicator can reuse a previous `context_usage` value, but it must label that freshness explicitly and must not synthesize a replacement ratio while waiting for the current run's Floret observation. Flower slash commands are local composer actions; `/compact` does not enter the transcript and does not cancel or replace a running agent turn.

# Evidence

- `redeven:internal/flower_ui/src/flowerLiveReducer.ts:601` - `context.usage.updated` is applied as thread presentation state.
- `redeven:internal/ai/run.go:695` - Active manual compaction captures the operation anchor when the request is queued.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:3894` - Active subagent detail tailing is limited to queued/running/waiting-input states.
- `redeven:internal/ai/floret_events.go:464` - Floret context status is projected onto the Redeven Flower run id before emitting `context_usage`.
- `redeven:internal/flower_ui/src/chat/flowerContextPresentation.ts:94` - The composer context indicator labels last-known usage through explicit presentation copy.
- `redeven:internal/ai/flower_live_types.go:406` - Approval actions carry typed ordering, batch, generation, revision, and current-position fields.
- `redeven:internal/ai/flower_live_types.go:434` - Approval queue snapshots carry typed generation, revision, and current-position fields.
- `redeven:internal/codeapp/appserver/thread_read_state.go:154` - Live-event read-state decoration loads canonical state only for responses containing thread patches.
- `redeven:internal/codeapp/appserver/thread_read_state_live_test.go:16` - Focused allocation and loader-count tests enforce the non-patch fast path and copy-on-write patch behavior.
