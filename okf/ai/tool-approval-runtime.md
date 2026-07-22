---
type: AI Tool Contract
title: AI tool approval runtime
description: Canonical Floret approval authority, Flower projection, conflict validation, and decision reconciliation.
tags: [ai, tools, approvals, flower]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

Floret is the only real-time authority for ordinary and delegated tool approvals. Redeven reads the root Floret approval queue, maps its records into Flower presentation DTOs, and publishes complete `approval.queue_replaced` snapshots without persisting, ordering, promoting, timing out, or reconstructing a second approval lifecycle. Decisions are compare-and-set operations against the current Floret queue and record identity. An explicit empty replacement clears stale UI state, including after cancellation. Redeven-owned `control_confirm` actions remain a separate product confirmation mechanism and do not participate in the Floret queue.

# Contract

## Canonical queue

Floret v0.23.0 validates queue and record identity, lifecycle state, batch position, timestamps, resources, effects, and argument hashes. Redeven calls root-scoped `ReadApprovalQueue`; it never queries Floret's store directly and never copies approval records into the Redeven database. Invalid or mismatched Floret data is a contract error, not input for synthesis or repair.

Redeven maps each visible Floret record to a `FlowerApprovalAction`. Main and delegated actions both use the record's canonical run and tool-call identity. Delegated presentation derives its child label from the Floret `scope=thread:<child-thread-id>` value; there is no Redeven delegated-reference, delivery-state, or child-execution-state shadow. Product labels and safe summaries may be derived for display, but the underlying identity, order, current item, generation, revision, and actionability remain Floret-owned.

Every canonical read or resolution result is emitted as one `approval.queue_replaced` event containing the entire mapped action list and queue version. The materializer replaces all Floret-owned actions atomically, preserves independent `control_confirm` actions, and rejects lower generation or revision snapshots. An empty Floret queue is still emitted as an explicit replacement with `actions=[]`; omission is not a clear. Bootstrap follows the same sampled-versus-unsampled distinction.

Floret approval lifecycle events trigger a fresh canonical queue read. Cancellation is allowed to publish only this authoritative replacement after the owning run is detached; all other detached presentation events remain suppressed. This permits Floret's canceled empty queue to remove stale buttons without introducing a synthetic Redeven cancellation path.

The queue head is projected with `surface_role=primary_action`; every later record is projected as `surface_role=locator`. Canonical replacement validation requires exactly one primary action when the queue is non-empty and rejects missing, mirrored, duplicated, or identity-mismatched roles. Flower therefore mounts approval controls only from the current canonical primary action and never promotes an Activity timeline row into an approval component.

## Decisions

Ordinary and delegated approval submission resolves the active root run, reads the current Floret queue, and verifies root ownership, current record identity, action/run/tool/origin identity, queue generation and revision, and approval revision. Redeven then calls Floret `ResolveApproval` with the exact current identity and publishes the returned complete queue. It does not consult a local live card, Activity row, transcript, or database record as decision authority.

A successful resolution returns the cursor of the replacement event. Stale, duplicate, already resolved, unavailable, or non-current decisions use HTTP 409 with `AI_APPROVAL_CONFLICT`. The Flower surface freezes the submitted action while awaiting projection, performs an explicit canonical resync after 1500 ms or on conflict, and retries at most once only if the same action remains the current actionable Floret record with refreshed compare-and-set fields. A promoted action, explicit empty queue, or terminal thread settles the handoff.

`control_confirm` is a Redeven product confirmation for a control signal. It retains its own in-memory run-scoped decision and live-event validation and is preserved alongside Floret actions in presentation, but it is not inserted into, ordered by, or resolved through the Floret approval queue.

## Presentation

The thread summary projects `waiting_approval` when the canonical queue contains visible pending actions and returns to the applicable running or terminal state when it becomes empty. Lightweight thread summaries may omit approval details; omission never clears selected-thread state.

Activity timeline approval markers are historical tool execution presentation only. They cannot create, resolve, promote, or restore an approval action and expose no competing decision controls. The current Floret queue is the sole source for actionable buttons.

# Boundaries

Floret owns ordinary and delegated approval state, ordering, timeout, cancellation, decision idempotency, and resolution. Redeven owns product policy revalidation, safe presentation mapping, live transport, conflict envelopes, and UI interaction. Redeven must not persist a second approval lifecycle, derive actionable state from historical rows, access Floret-managed storage, or add fallback logic that guesses missing queue state.

# Evidence

- `redeven:internal/ai/floret_approval.go:146` - Reads and maps the canonical root queue and emits complete replacements.
- `redeven:internal/ai/flower_live_projection.go:800` - Submits identity-checked Floret decisions and materializes atomic replacements.
- `redeven:internal/ai/floret_events.go:58` - Resynchronizes the canonical queue from Floret lifecycle events, including detached cancellation.
- `redeven:internal/flower_ui/src/flowerLiveReducer.ts:434` - Applies version-monotonic replacements while preserving product confirmations.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:4536` - Coordinates frozen decision handoff, resync, conflict handling, and bounded retry.
- `redeven:internal/codeapp/appserver/server.go:1167` - Maps approval conflicts to the flat HTTP 409 error envelope.
