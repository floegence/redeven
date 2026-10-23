---
type: Architecture Contract
title: AI readiness and service generation lifecycle
description: Keep Code App available while a process-local controller serializes AI startup, retry, and request-scoped service generations.
tags: [architecture, ai, readiness, lifecycle, floret]
timestamp: 2026-09-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

- Authority: Floret owns durable Agent and Store facts; Redeven owns process-local AI availability and presentation.
- Outcome: non-AI product surfaces remain usable while AI startup inspects, migrates, verifies, recovers, or blocks.
- Invariants: one controller owns construction, retry, generation publication, request leases, drain, and close; each AI request stays on one generation.
- Failure boundary: unavailable or blocked startup returns a sanitized typed envelope, publishes no partial service, repairs no Store data, and never becomes durable Agent state.

# Contract

## Process-local readiness
The Code App composition layer owns the only AI readiness controller.

Startup performs unfinished replacement recovery, bounded Floret owner open, product database migration, explicit activation, then generation publication. Historical thread preparation continues in Floret's worker. Product recovery begins only after activation, pages settings in batches of 200, retains each thread's complete media inventory and resumes eligible admitted queues. One thread failure does not starve later pages; ownership review runs afterward. Incomplete recovery gates destructive maintenance and retries on the next maintenance pass. Each waiter retains the result of its own recovery attempt; a concurrent retry cannot turn a failed attempt into successful readiness.

Background phase callbacks cannot return a published generation to startup or unmount Flower. Background orphan discovery updates the controller's degraded state and retry path; known issues clear only after successful reconciliation or explicit repair. Shutdown cancels and joins generation workers before closing storage.

Retry is explicit, asynchronous, and admits at most one startup owner.

## Generation leases
Every ready service is published as one monotonically identified generation. The controller waits for every idempotent release, closes the old service once, and only then constructs and publishes a replacement.

Long-lived model-source calls receive the generation context so replacement can cancel their work before waiting for release.

## Route availability
AI lifecycle routes return HTTP 503 with machine code `AI_SERVICE_UNAVAILABLE` and the current sanitized snapshot when no generation can be leased. Readiness, retry, stop, and administrator-only snapshot and restore routes never acquire a service.

Incomplete provider leases fail closed, release any supplied resource, and cannot be presented as `ready`.

## Maintenance presentation
See [Flower startup and recovery presentation](flower-startup-presentation.md) for Env App and Desktop admission, phase progress, stop/retry, focus and draft continuity.

# Boundaries

The readiness controller must not import Floret, SQLite, or threadstore packages; perform owner storage inspection; hold `runtime.Host` or `storage.Backend`; or retain canonical Agent DTOs.

Readiness history is not recovery authority.

# Evidence

- `redeven:internal/codeapp/ai_readiness.go:1` - Owns serialized startup, sanitized state, generation cancellation, drain, replacement, and close.

- `redeven:internal/codeapp/appserver/ai_readiness.go:1` - Defines the narrow lease provider, readiness DTO, route classification, and unavailable envelope.

- `redeven:internal/codeapp/appserver/server.go:2277` - Acquires one request lease and propagates its service through request context.
