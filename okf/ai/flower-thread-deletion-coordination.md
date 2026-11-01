---
type: AI Persistence Contract
title: Flower thread deletion coordination
tags: [ai, threads, persistence, deletion, floret]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Floret owns canonical thread deletion and Redeven owns product settings, read state, execution authority, and attachment claims. One authenticated DELETE request performs those two owner operations in that order and returns success only after both complete. The operation is synchronous, idempotent, and retryable; it does not claim cross-database atomicity or persist a second lifecycle receipt.

# Contract

The service first reads endpoint-scoped Redeven product settings.

Canonical deletion runs before product cleanup.

Flower sends `force=true` after destructive confirmation, retires the local cache entry only after HTTP success, and has no pending, committed, failed, operation-id, or durable-intent UI state.

# Boundaries

Redeven never opens or edits Floret tables, never restores a deleted canonical thread, never reports asynchronous deletion progress, and never fabricates an atomic transaction across the two owners. Retry convergence is based only on typed Floret deletion/not-found errors and the current Redeven catalog row, not error text, polling, or a recovery projection.

# Evidence

- `redeven:internal/ai/threads.go` - Canonical delete then idempotent product cleanup.

- `redeven:internal/ai/threadstore/catalog_mutation.go` - Atomic Redeven-only thread-data cleanup.

- `redeven:internal/ai/thread_delete_test.go` - Cleanup failure/retry/absence without Floret reads.
