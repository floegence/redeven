---
type: AI Tool Contract
title: AI tool approval runtime
description: Canonical Floret approval authority, Flower projection, conflict validation, and decision reconciliation.
tags: [ai, tools, approvals, flower]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

Floret is the only real-time authority for ordinary and delegated tool approvals. Redeven reads the root Floret approval queue, maps its records into Flower presentation DTOs, and publishes complete `approval.queue_replaced` snapshots without persisting, ordering, promoting, timing out, or reconstructing a second approval lifecycle. Decisions are compare-and-set operations against the current Floret queue and record identity. An explicit empty replacement clears stale UI state, including after cancellation. Redeven-owned `control_confirm` actions remain a separate product confirmation mechanism and do not participate in the Floret queue. A run waiting on a canonical Floret approval is active user wait, not idle execution, and remains bounded by the run maximum wall time.

# Contract

## Canonical queue

Floret v3.2.39 validates queue and record identity, lifecycle state, batch position, timestamps, resources, effects, and argument hashes. Approval-gated effect callbacks retain the active turn's renewable lease binding, and approval settlement accepts only monotonic heartbeat successors within the same thread, turn, owner, generation, and acquisition. Canonical turn projections advance by ordinal: an equal or older committed entry cannot overwrite the current projection, and a conflicting equal ordinal fails closed. A terminal approval decision therefore cannot regress to requested when the next provider step rebuilds its projection. Canceling while an effect waits for approval reads that current renewed proof, atomically cancels the approval batch and canonical turn, keeps the admission replayable, and never executes the pending tool. It also projects a supported historical requested approval to the failed or aborted turn's coherent terminal state when recovery journaled a terminal tool result before an approval-resolution detail event. Redeven calls the root-bound approval reader; it never queries Floret's backend directly and never copies or repairs approval records in the Redeven database. Invalid or mismatched non-terminal Floret data remains a contract error, not input for synthesis or repair.

For one provider tool-call batch, Floret settles every call independently and emits exactly one provider-visible result per original call in provider order. A user rejection is a structured `user_rejected`/`declined` result with `decision_source=user`, `executed=false`, and `needs_attention=false`; it is not a dispatch error, cancellation, or run failure. Rejecting one call leaves sibling approvals pending until the user decides them, while an explicit batch-reject command submits exact decisions for all still-pending calls. Duplicate, reverse-order, concurrent, reconnect, restart, and Stop races are resolved by Floret's canonical identity and idempotency rules.

Approval lifecycle details update the state of the existing canonical tool item; they do not replace a previously authored activity label, description, renderer, or payload. Floret v3.2.39 carries a detached copy of that presentation into new canonical approval entries and excludes it from approval fingerprints and replay identity. Earlier v3 journals recover a missing approval presentation from the matching durable tool call without a state rewrite or schema change. A terminal command therefore remains the literal command with terminal rendering before approval, after approval resolution, and through restart. Only approval-only history without a matching tool presentation receives Floret's neutral fallback. Flower does not render approval decisions as transcript content or add a separate approved-status row.

Redeven maps each visible Floret record to a `FlowerApprovalAction`. Main and delegated actions both use the record's canonical run and tool-call identity. Delegated presentation derives its child label from the Floret `scope=thread:<child-thread-id>` value; there is no Redeven delegated-reference, delivery-state, or child-execution-state shadow. Product labels and safe summaries may be derived for display, but the underlying identity, order, current item, generation, revision, and actionability remain Floret-owned.

Every canonical read or resolution result is emitted as one `approval.queue_replaced` event containing the entire mapped action list and queue version. The materializer replaces all Floret-owned actions atomically, preserves independent `control_confirm` actions, and rejects lower generation or revision snapshots. An empty Floret queue is still emitted as an explicit replacement with `actions=[]`; omission is not a clear. Bootstrap follows the same sampled-versus-unsampled distinction.

Bootstrap also compares the in-memory approval overlay with the validated canonical Activity projection. A terminal canonical item suppresses only an overlay action with the exact same nonempty RunID and tool-call ID; message, thread, turn, or run identity mismatch rejects the complete bootstrap. If the suppressed action was the sampled queue head, Redeven clears that sampled Floret queue instead of promoting another stale item. Otherwise it preserves the unrelated current action and recomputes counts. The settled run/tool index filters later stale queue-replacement events for the process lifetime, so reopening or reconnecting cannot restore controls for a canonical `success`, `error`, `canceled`, rejected, timed-out, or unavailable tool. This is negative presentation reconciliation only: it never resolves an approval, mutates Floret state, or turns Activity into decision authority.

Floret approval lifecycle events trigger a fresh canonical queue read. Cancellation is allowed to publish only this authoritative replacement after the owning run is detached; all other detached presentation events remain suppressed. This permits Floret's canceled empty queue to remove stale buttons without introducing a synthetic Redeven cancellation path.

The run idle watchdog checks the active root-bound `ReadApprovalQueue` capability before declaring a run timed out. A valid non-empty queue renews the idle interval. The watchdog uses a bounded read and treats read, validation, or root-identity failure as unavailable authority rather than proof of an empty queue, so it records diagnostics and leaves the run maximum wall time as the final cancellation boundary. It does not retain the sampled queue, emit presentation, or derive approval state from Activity or local projections.

The queue head is projected with `surface_role=primary_action`; every later record is projected as `surface_role=locator`. Canonical replacement validation requires exactly one primary action when the queue is non-empty and rejects missing, mirrored, duplicated, or identity-mismatched roles. Flower therefore mounts approval controls only from the current canonical primary action and never promotes an Activity timeline row into an approval component.

## Decisions

Ordinary and delegated approval submission resolves the active root run, reads the current Floret queue, and verifies root ownership, current record identity, action/run/tool/origin identity, queue generation and revision, and approval revision. Redeven then calls Floret `ResolveApproval` with the exact current identity and publishes the returned complete queue. It does not consult a local live card, Activity row, transcript, or database record as decision authority.

A user rejection commits as Floret `rejected/user_rejected`, bypasses Redeven's effect-authorization gate, and never enters the concrete tool handler. Floret returns the rejected call to the provider as a structured declined tool result so the provider can continue the same turn and produce a user-facing response; rejection alone is not a tool-dispatch or Provider-authentication failure. Redeven projects it as a quiet declined activity and does not reinterpret `effect is unauthorized`, a rejected tool result, or another host authorization message as evidence that Provider credentials are invalid. Proof, authority, permission, persistence, and unknown-outcome failures remain fail closed and can still terminate the turn.

A successful resolution returns after the minimal durable decision commit and returns the cursor of the replacement event; it does not wait for provider continuation, prompt preparation, or non-critical observation delivery. Stale, duplicate, already resolved, unavailable, or non-current decisions use HTTP 409 with `AI_APPROVAL_CONFLICT`. On click, Flower records only an in-memory request identity and bounded rollback context, immediately removes the decided action from the interactive composer, and projects a rejected tool as quiet declined. This local handoff cannot authorize an effect or create canonical lifecycle. Live projection or bootstrap replaces it. If transport fails, Flower reloads canonical state: it restores controls only when the same action is still requested, treats a terminal decision as a lost response, and keeps the ordinary composer, Stop, details, and thread navigation usable while reconciliation is pending. A conflict retry occurs at most once and only when canonical reload proves that the same action remains current with refreshed compare-and-set fields.

`control_confirm` is a Redeven product confirmation for a control signal. It retains its own in-memory run-scoped decision and live-event validation and is preserved alongside Floret actions in presentation, but it is not inserted into, ordered by, or resolved through the Floret approval queue.

## Presentation

The thread summary projects `waiting_approval` when the canonical queue contains visible pending actions and returns to the applicable running or terminal state when it becomes empty. Lightweight summaries may omit action details, but they expose the structured `approval_pending`, `approval_pending_count`, `approval_generation`, and `approval_revision` projection whenever the live materialized approval state is sampled. Flower applies these fields with monotonic generation/revision fencing, so a stale running summary or event cannot erase a background approval; an explicit false/zero replacement is required to clear it. The fields are an in-memory transport projection, not a second persisted lifecycle, and omission never clears selected-thread state.

Activity timeline approval markers are historical tool execution presentation only. They cannot create, resolve, promote, or restore an approval action and expose no competing decision controls. The current Floret queue is the sole source for actionable buttons.

If provider continuation fails after a canonical declined result, Redeven restores the provider error classification from the Floret failure without exposing the provider endpoint or raw diagnostics. Flower keeps the declined activity unchanged and shows one quiet, actionable continuation notice. The notice follows the materialized canonical timeline as bootstrap or replay arrives; it does not infer rejection from text, maintain another lifecycle, or turn Activity into approval authority.

# Boundaries

Floret owns ordinary and delegated approval state, ordering, timeout, cancellation, decision idempotency, and resolution. Redeven owns product policy revalidation, safe presentation mapping, live transport, conflict envelopes, and UI interaction. Redeven must not persist a second approval lifecycle, derive actionable state from historical rows, access Floret-managed storage, or add fallback logic that guesses missing queue state.

# Evidence

- `redeven:internal/ai/floret_approval_lease_renewal_test.go` - Runs three approval-gated effects in one turn and holds the third decision across the published lease heartbeat before requiring a completed turn and empty queue.
- `redeven:internal/ai/run_error_code_test.go` - Keeps host authorization and rejected-tool errors out of Provider credential classification.
- `redeven:internal/ai/threads_approval_status_test.go` - Restores a sanitized provider failure classification from canonical Floret snapshots.
- `redeven:internal/ai/floret_approval.go:146` - Reads and maps the canonical root queue and emits complete replacements.
- `redeven:internal/ai/run.go:597` - Keeps canonical approval waits out of idle cancellation through a bounded exact queue read.
- `redeven:internal/ai/flower_live_projection.go:800` - Submits identity-checked Floret decisions and materializes atomic replacements, including structured declined activity.
- `redeven:internal/ai/flower_live_projection.go:151` - Reconciles exact canonical terminal run/tool identities against stale in-memory approval presentation.
- `redeven:internal/ai/floret_events.go:58` - Resynchronizes the canonical queue from Floret lifecycle events, including detached cancellation.
- `redeven:internal/flower_ui/src/flowerLiveReducer.ts:434` - Applies version-monotonic replacements while preserving product confirmations.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:4536` - Coordinates frozen decision handoff, resync, conflict handling, and bounded retry.
- `redeven:internal/flower_ui/src/FlowerSurface.visibility.test.tsx` - Keeps declined activity visible with one actionable provider-continuation notice.
- `redeven:internal/ai/realtime_sink.go:447` - Builds the structured approval summary from the live materialized state and publishes it with each thread summary.
- `redeven:internal/flower_ui/src/flowerLiveReducer.ts:60` - Fences approval summaries by generation/revision and preserves waiting status over stale running patches.
- `redeven:internal/codeapp/appserver/server.go:1167` - Maps approval conflicts to the flat HTTP 409 error envelope.
