---
type: Architecture Contract
title: Native container operation observation
tags: [architecture, containers, operations, reconciliation]
lifecycle: contract
reviewed_at: "2026-10-27"
---
# Summary

Every native Containers mutation has one durable Redeven operation identity and
one resource-local lock. Submission, cancellation, progress events, restart
recovery, and terminal reconciliation flow through `containerresource`.
Inventory refreshes and UI observation never become a second lifecycle owner.
Lost submissions, stale plans, runtime restarts, and unavailable engines are
reported explicitly and are never hidden behind automatic replay.

# Contract

## Admission and serialization
The operation key contains engine, opaque endpoint ID, resource kind, and canonical identity.

Reusing a request ID with different hashes produces an idempotency conflict instead of a second operation.

## Execution, cancellation, and events
The service owns an operation context from queued state through reconciliation. Cancellation is an explicit API action; closing Activity, Workbench, an inspector, an event stream, or the browser never implies cancellation.

Terminal errors use a small public taxonomy for storage, registry availability, rate limiting, not-found, and access denial; the drawer maps known codes to localized guidance alongside the durable timeline. Unknown codes use a localized generic failure; codes and backend messages remain diagnostic evidence, not visible UI copy. Timeout guidance acknowledges that host work may still be in progress. Desktop service cards direct users to its native application for setup/startup recovery and expose status revalidation. Service history shows state transitions without generic execution stages or a synthetic percentage bar.

## Authoritative terminal observation
After engine execution returns, the service reloads the exact endpoint-bound resource or relevant bounded inventory.

The operation is never replayed, regardless of whether the resource appears present or absent.

## UI observation
Inventory requests and streams are fenced by source runtime, endpoint, resource view, and request generation. A superseded response cannot replace current data.

Mobile and desktop expose the same state and cancellation authority. Service lifecycle feedback stays on its card; history is secondary. Polling terminal transitions refresh authoritative service/runtime facts even when the event stream was lost. The portaled history drawer owns its responsive container and independent scrolling. Desktop uses a history sidebar; narrow drawers place a horizontal history strip above details. Rows use stable operation IDs and pressed selection; polling preserves focus and detail nodes. Details separate identity, live cancellation, duration/current health and timeline. The active final timeline step uses a pending indicator, never a completed check.

# Boundaries

- The database is operation evidence, not a mutation queue or replay journal. - UI inventory and SSE consumers observe service authority; they do not own   lifecycle state or reconciliation. - A runtime restart converts active work to interrupted after read-only   observation; it never assumes success or retries the command. - The full native container ownership contract is defined in   [Native container resources](container-resources-capability.md).

# Evidence

- `redeven:internal/containerresource/service.go` - Admits operations and observes interrupted startup state without replay.

- `redeven:internal/containerengine/cli_client.go` - Parses bounded image pull phase and layer evidence without retaining raw output.
