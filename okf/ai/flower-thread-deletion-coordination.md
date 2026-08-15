---
type: AI Persistence Contract
title: Flower thread deletion coordination
description: Synchronous, idempotent convergence across Floret canonical deletion and Redeven product cleanup.
tags: [ai, threads, persistence, deletion, floret]
timestamp: 2026-08-15T00:00:00Z
---
# Summary

Floret owns canonical thread deletion and Redeven owns product settings, routing, read state, and attachment claims. One authenticated DELETE request performs those two owner operations in that order and returns success only after both complete. The operation is synchronous, idempotent, and retryable; it does not claim cross-database atomicity or persist a second lifecycle receipt.

# Contract

The service first reads Redeven product settings. An absent product row is already converged and returns success. For an existing product row, the service reads the typed Floret `ThreadView`; an active thread requires `force=true`, which requests typed cancellation before deletion. Without force, active work returns the busy result without changing either owner.

Canonical deletion runs before product cleanup. Floret typed deleted or not-found results mean canonical deletion has already converged, so Redeven continues its own cleanup. This is required when an earlier request deleted Floret successfully but product cleanup failed. Other Floret errors stop the request and preserve Redeven product data.

After canonical deletion, one Redeven transaction releases attachment claims and removes thread settings, pending-input migration staging, and routing rows. Read-state retirement is best-effort asynchronous presentation cleanup and cannot change the canonical deletion result. A product cleanup failure is returned directly; retrying the same DELETE observes the Floret tombstone/not-found result and resumes product cleanup without creating an operation row.

The HTTP boundary accepts only an absent query or one exact `force=true|false` pair. Success is HTTP 200 with `{"ok":true}`. Busy without force is HTTP 409. Other failures use the normal product error envelope and preserve the Flower dialog and current selection. Flower sends `force=true` after destructive confirmation, retires the local cache entry only after HTTP success, and has no pending, committed, failed, operation-id, or durable-intent UI state.

# Boundaries

Redeven never opens or edits Floret tables, never restores a deleted canonical thread, never reports asynchronous deletion progress, and never fabricates an atomic transaction across the two owners. Retry convergence is based only on typed Floret deletion/not-found errors and the current Redeven catalog row, not error text, polling, or a recovery projection.

# Evidence

- `redeven:internal/ai/threads.go` - Performs typed canonical delete followed by idempotent product cleanup.
- `redeven:internal/ai/threadstore/catalog_mutation.go` - Removes only Redeven-owned thread product data in one transaction.
- `redeven:internal/ai/thread_delete_v4_test.go` - Covers product cleanup failure after canonical deletion and successful retry convergence.
- `redeven:internal/codeapp/appserver/server.go` - Exposes the synchronous DELETE response and strict force query.
- `redeven:internal/codeapp/appserver/server_test.go` - Covers success, idempotent absence, read-state retirement, and force parsing.
- `redeven:internal/flower_ui/src/runtimeFlowerSurfaceAdapter.ts` - Maps deletion to `Promise<void>` without lifecycle receipts.
