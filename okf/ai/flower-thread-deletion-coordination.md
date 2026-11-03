---
type: AI Persistence Contract
title: Flower thread deletion coordination
tags: [ai, threads, persistence, deletion, floret]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Floret deletes canonical threads; Redeven deletes settings, read state, authority and attachment claims. One authenticated request runs owners in that order and succeeds only after both. Synchronous idempotent retry creates no second lifecycle receipt or cross-database atomicity claim.

# Contract

The service first reads endpoint-scoped Redeven product settings.

Canonical deletion runs before product cleanup.

Flower sends `force=true` after destructive confirmation, retires the local cache entry only after HTTP success, and has no pending, committed, failed, operation-id, or durable-intent UI state.

# Boundaries

Redeven never opens or edits Floret tables, never restores a deleted canonical thread, never reports asynchronous deletion progress, and never fabricates an atomic transaction across the two owners. Retry convergence is based only on typed Floret deletion/not-found errors and the current Redeven catalog row, not error text, polling, or a recovery projection.

# Evidence

- `redeven:internal/ai/threads.go` - Source.
- `redeven:internal/ai/threadstore/catalog_mutation.go` - Source.
- `redeven:internal/ai/thread_delete_test.go` - Tests.
