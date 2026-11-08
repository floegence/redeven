---
type: AI Persistence Contract
title: Flower thread Fork and deletion coordination
tags: [ai, threads, persistence, floret]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Floret owns canonical Fork and deletion; Redeven authorizes endpoint scope and coordinates product settings, read state and file claims. Convergence uses typed canonical outcomes without a saga, compensating deletion or cross-database atomicity claim.

# Contract

## Fork
`ForkThreadWithOptions` validates RWX access, the source ThreadID, endpoint identity, and a stable `client_request_id`. The shared endpoint/thread authority boundary must find a live product settings row for that exact endpoint before any Floret call.

An optional `source_item_id` selects a committed assistant answer on the active path. Floret retains that answer and its preceding history while excluding later items. Answer-level Fork supplies this anchor; thread-list Fork omits it and retains the current full path. Invalid or uncommitted anchors fail explicitly.

Detail recovery retains the created destination and retries loading only.

## Deletion
The service first reads endpoint-scoped Redeven product settings.

Canonical deletion runs before product cleanup.

Flower sends `force=true` after destructive confirmation, retires the local cache entry only after HTTP success, and has no pending, committed, failed, operation-id, or durable-intent UI state.

# Boundaries

Redeven never stores a fork saga, source/destination turn or run identity mapping, Floret fork result, canonical title, or Agent lifecycle snapshot. Product adoption cannot authorize a foreign source, choose a different destination, reconstruct canonical content, or compensate by deleting a valid Floret destination.

Redeven never opens or edits Floret tables, never restores a deleted canonical thread, never reports asynchronous deletion progress, and never fabricates an atomic transaction across the two owners. Retry convergence is based only on typed Floret deletion/not-found errors and the current Redeven catalog row, not error text, polling, or a recovery projection.

# Evidence

- `redeven:internal/ai/threads.go` - Source.
- `redeven:internal/ai/threadstore/orphan_adoption_test.go` - Tests.
