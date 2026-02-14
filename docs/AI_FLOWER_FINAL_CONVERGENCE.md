# Flower Final Convergence Plan

## 1. Objective

This document defines the **final convergence shape** for Flower chat send/run orchestration.

Primary goals:

1. Make `sendUserTurn` conflict semantics deterministic and side-effect-safe.
2. Eliminate duplicate user-message persistence and duplicate transcript broadcasts.
3. Keep runtime behavior stable during transitions (no message loss, no stuck run states).
4. Reduce client-side ambiguity when handling stale-run conflicts.

This is an implementation plan and acceptance contract for the code changes in this branch.

## 2. Current Issues

### 2.1 Conflict check after persistence

`expected_run_id` mismatch is currently checked **after** user message persistence in the thread actor path.
That can return `409 run changed` with side effects already applied.

### 2.2 Duplicate persistence path for user messages

User input is persisted in `sendUserTurn` path and again in run execution path (`executePreparedRun`) with idempotency fallback.
This creates unnecessary database writes and duplicate realtime noise.

### 2.3 Non-structured conflict handling on client

Env App currently retries based on string matching (`"run changed"`) instead of stable RPC semantics.
This is fragile and tightly coupled to server message text.

## 3. End-State Design

### 3.1 `sendUserTurn` becomes the single owner of user-input persistence (RPC path)

For the RPC start-or-steer flow:

1. Resolve active run snapshot (thread scoped).
2. Validate `expected_run_id` **before** persistence.
   - If mismatch: return `ErrRunChanged` immediately with no transcript write.
3. Persist user message once.
4. Broadcast transcript message once.
5. Route to:
   - steer existing active run, or
   - start a detached run using the already persisted message metadata.

### 3.2 Run startup supports pre-persisted user messages

Run preparation/execution must accept an optional pre-persisted user message reference.
When this reference is provided:

- `executePreparedRun` must **not** append the same user message again.
- `executePreparedRun` must reuse the persisted `message_id` for conversation-turn linking.

This removes duplicate writes while preserving existing runtime behavior.

### 3.3 Conflict handling contract in Env App

Env App should treat RPC `409` as a run-conflict signal in the send path and retry once without `expected_run_id`.

- Use typed RPC error info (`RpcError.code`) instead of text matching.
- Keep retry scope narrow (only stale-run path on first send attempt).

## 4. Safety Constraints

### 4.1 Message durability

- A successfully accepted send must remain persisted even if run startup races.
- Any race that fails detached start should attempt steer fallback when possible.

### 4.2 No behavior regression for HTTP streaming run endpoint

Legacy HTTP run start path keeps existing behavior (it still persists user input itself).
The dedupe logic only changes behavior for explicitly pre-persisted RPC start-or-steer flow.

### 4.3 Observability continuity

- Existing lifecycle/thread summary broadcasts remain in place.
- Duplicate transcript events from double persistence are removed.

## 5. Implementation Steps

1. Add an internal pre-persisted user-message carrier into run preparation.
2. Add `StartRunDetachedWithPersisted(...)` internal API.
3. Refactor thread actor send flow:
   - preflight conflict check,
   - persist once,
   - steer/start fallback handling.
4. Refactor run execution user-message block to branch:
   - pre-persisted path (reuse),
   - legacy append path.
5. Update Env App send retry logic to typed RPC `409` detection.
6. Add/adjust tests for:
   - conflict no-side-effect,
   - no duplicate transcript write in RPC path,
   - retry behavior compatibility.

## 6. Acceptance Criteria

1. `expected_run_id` mismatch in `sendUserTurn` does not create a new transcript row.
2. One send request in RPC path creates exactly one user transcript row.
3. Conversation-turn linking uses the correct user `message_id` in both steer and start flows.
4. Env App no longer relies on plain-text error substring for run conflict retry.
5. Existing build/test/lint gates pass:
   - `./scripts/build_assets.sh`
   - `go test ./...`
   - `golangci-lint run ./...`

## 7. Non-goals

1. Removing legacy HTTP NDJSON run endpoint in this patch.
2. Full event-schema redesign for `ai_run_events` in this patch.
3. Broad protocol additions requiring cross-repo coordinated release.

