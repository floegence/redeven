---
type: Architecture Contract
title: AI readiness and service generation lifecycle
tags: [architecture, ai, readiness, lifecycle, floret]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Floret owns durable Agent/Store facts; Redeven's single process-local readiness controller owns AI construction, retry, publication, request leases, drain and close. Non-AI surfaces remain usable through startup/migration/recovery. Requests use one generation. Unavailable startup returns sanitized typed state without publishing a partial service, repairing Store data or creating durable Agent state.

# Contract

- Startup recovers unfinished replacements, opens the Floret owner with bounded waiting, migrates product data, activates and publishes. Floret's worker prepares historical threads.
- After activation, recovery pages settings by 200, retains complete media inventories and resumes eligible admitted queues. Per-thread failure cannot starve later pages; ownership review follows. Incomplete recovery gates destructive maintenance and retries next maintenance pass. Waiters retain their own attempt's result.
- Background phases cannot regress a published generation or unmount Flower. Orphan discovery updates degraded/retry state; successful reconciliation or explicit repair clears issues. Shutdown cancels/joins generation workers before storage close.
- Explicit asynchronous retry admits one startup owner. Replacement cancels long-lived generation work, waits for idempotent lease releases, closes once, then publishes the next monotonic generation.
- Unleasable AI routes return HTTP 503 `AI_SERVICE_UNAVAILABLE` with sanitized state. Readiness/retry/stop and admin snapshot/restore bypass service acquisition. Incomplete provider leases release supplied resources and cannot report ready.

# Boundaries

The controller imports no Floret/SQLite/threadstore packages, holds no Host/Backend or canonical Agent DTOs, and inspects no owner storage. Readiness history grants no recovery authority. [Startup presentation](flower-startup-presentation.md) owns UI admission, focus and drafts.

# Evidence

- `redeven:internal/codeapp/ai_readiness.go:1` - Owns serialized startup, sanitized state, generation cancellation, drain, replacement, and close.

- `redeven:internal/codeapp/appserver/server.go:2277` - Acquires one request lease and propagates its service through request context.
