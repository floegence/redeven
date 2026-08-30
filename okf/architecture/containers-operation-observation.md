---
type: Architecture Contract
title: Native container operation observation
description: Keep endpoint-bound native mutations locked until authoritative reconciliation proves a terminal outcome.
tags: [architecture, containers, operations, reconciliation]
timestamp: 2026-08-28T00:00:00Z
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

The operation key contains engine, opaque endpoint ID, resource kind, and
canonical identity. Compose Project and Pod operations use canonical IDs;
creation uses the stable requested name. One key admits one mutation at a time,
while unrelated keys may proceed concurrently.

Preflight returns normalized impact, risk, exact target, confirmation text,
`request_hash`, and `plan_hash`. Operation creation recomputes the plan against
current inventory. Any changed input, endpoint, target, risk, or plan produces a
stale-preflight error. Reusing a request ID with different hashes produces an
idempotency conflict instead of a second operation.

## Execution, cancellation, and events

The service owns an operation context from queued state through reconciliation.
Cancellation is an explicit API action; closing Activity, Workbench, an
inspector, an event stream, or the browser never implies cancellation. Process
group termination prevents detached Docker or Podman children.

Operation events are ordered by durable sequence. SSE reconnect uses the last
observed sequence and cannot create or repeat work. Events contain sanitized
state and redacted reconciliation only. UI progress is based on reported
phases or terminal state, never fabricated elapsed-time percentages.

## Authoritative terminal observation

After engine execution returns, the service reloads the exact endpoint-bound
resource or relevant bounded inventory. Create and lifecycle operations prove
presence and desired state; removal proves absence; cleanup records an
authoritative inventory snapshot. Partial, stale, wrong-endpoint, or unavailable
inventory cannot prove success.

At process startup, queued, running, and canceling records are inspected using
read-only engine calls. The observed evidence is written in the same transaction
that marks each record interrupted with `runtime_restarted`. The operation is
never replayed, regardless of whether the resource appears present or absent.

## UI observation

Inventory requests and streams are fenced by source runtime, endpoint, resource
view, and request generation. A superseded response cannot replace current
data. Cached data may remain visible while its exact runtime refreshes, but
stale data cannot enable a mutation or release an operation lock.

Runtime rediscovery, resource-view changes, and detail-tool changes close every
stream that lost ownership and fence prior responses. List metrics are opt-in
and use one endpoint-wide batch statistics process per ready runtime and sample
instead of one process per row. Detail statistics select their container from
the same endpoint-wide engine primitive rather than relying on inconsistent
targeted CLI output. Statistics and logs retain only a bounded browser window.
The Operations drawer persists within its native surface instance and shows the
internal source target only where exact operation identity is necessary. Mobile
and desktop expose the same state and cancellation authority.

# Boundaries

- The database is operation evidence, not a mutation queue or replay journal.
- UI inventory and SSE consumers observe service authority; they do not own
  lifecycle state or reconciliation.
- A runtime restart converts active work to interrupted after read-only
  observation; it never assumes success or retries the command.
- The full native container ownership contract is defined in
  [Native container resources](container-resources-capability.md).

# Evidence

- `redeven:internal/containerresource/service.go` - Admits operations and observes interrupted startup state without replay.
- `redeven:internal/containerresource/store.go` - Atomically records interrupted state and redacted evidence.
- `redeven:internal/containerresource/service_test.go` - Proves preflight integrity, idempotency, managed-resource protection, reconciliation, and restart behavior.
- `redeven:internal/codeapp/appserver/container_resources.go` - Streams durable operation events and handles explicit cancellation.
- `redeven:internal/envapp/ui_src/src/ui/services/containerResourcesApi.ts` - Fences native inventory and event consumers by explicit API identity.
