---
type: Architecture Contract
title: AI readiness and service generation lifecycle
description: Keep Code App available while a process-local controller serializes AI startup, retry, and request-scoped service generations.
tags: [architecture, ai, readiness, lifecycle, floret]
timestamp: 2026-09-08T00:00:00Z
---
# Summary

- Authority: Floret owns durable Agent and Store facts; Redeven owns process-local AI availability and presentation.
- Outcome: non-AI product surfaces remain usable while AI startup inspects, migrates, verifies, recovers, or blocks.
- Invariants: one controller owns construction, retry, generation publication, request leases, drain, and close; each AI request stays on one generation.
- Failure boundary: unavailable or blocked startup returns a sanitized typed envelope, publishes no partial service, repairs no Store data, and never becomes durable Agent state.

# Contract

## Process-local readiness

The Code App composition layer owns the only AI readiness controller. Its
closed state set is `unavailable`, `inspecting`, `backing_up`, `optimizing`,
`migrating`, `verifying`, `indexing`, `preparing`, `recovering`, `restoring`,
`stopping`, `stopped`, `ready`, `degraded`, and `blocked`. Core terminal, files, settings and diagnostics become available
independently of Flower preparation.

One generation owns the retained Floret Host, product database, read-state
path migration and database, view publisher, and attachment maintenance. The
startup order is unfinished replacement recovery, owner open and migration,
canonical validation and persistent index reuse or first build, product
preparation, explicit activation, then publication. Ordinary startup does not
call full read-only inspection before opening. Published inspection remains
available for explicit diagnosis and staged restore validation. The retained
Host opens with execution deferred; preparation cannot execute models or tools.

Published Floret v7.52.0 maintains its rebuildable SQLite search index in the
canonical write transaction. Ordinary reopening validates source correspondence
and reuses the index; a missing index builds before activation. Redeven neither
decodes canonical records nor owns another search projection. Startup queue
selection uses the optional canonical summary reader. Upload retention uses the
complete media descriptor inventory, including archived and inactive paths and
queues. Tool media collection runs in existing background maintenance with its
write gate, complete inventory and execution-idle constraint.

One attempt context belongs to the readiness controller. Stop immediately
publishes stopping and cancels that attempt. Stopped is published only after
rollback and owner close finish; retry is then explicit and cannot overlap the
previous attempt. Cancellation never triggers automatic recovery. A close
failure publishes generation_close_failed and requires application restart;
no later attempt may reopen those files. Known workload totals are shown as
counts; unknown totals remain indeterminate. Activated service generations have
their own controller-lifetime contexts.

Welcome renders each observed phase in its existing readiness boundary,
including canonical validation, index construction, product preparation,
recovery, restore and safe stopping. Flower mounts only for `ready` or `degraded`, while navigation and
the shell-owned draft remain available. Phase changes do not start provider
requests or create a second readiness timer. The controller records elapsed
phase and total startup durations from its transition timestamps; failure
classification and logs retain the actual owner phase rather than assuming
every runtime-open failure occurred during verification.

Failures carry a sanitized component (`floret`, `product`, `read_state`,
`uploads`, `backup`, or `recovery`), phase, typed reason, `retryable`, and
`safe_to_retry`. Supported reasons distinguish newer/unsupported formats,
integrity, migration, permissions, occupation, space, backup and restoration.
Generic construction failures use `ai_service_startup_error`. Raw errors,
paths, schema identities, fingerprints, SQL and database contents never appear
in the readiness response. Only temporary occupation uses bounded automatic
retry. A failure closing any previous or partly constructed generation is
terminal for the process: it stays blocked and cannot reopen potentially owned
files. A failed, cancelled or obsolete constructor cannot activate execution.

Readiness is memory-only. It is not written to threadstore, audit records, or a
Floret backend, and it cannot reconstruct a thread, turn, approval, todo, tool,
provider, or Activity lifecycle. `GET /_redeven_proxy/api/ai/readiness` returns
the sanitized snapshot. Settings includes the same snapshot while keeping its
non-AI configuration readable. Retry is explicit, asynchronous, and admits at
most one startup owner.

## Generation leases

Every ready service is published as one monotonically identified generation.
An HTTP AI request, RPC call, runtime snapshot, or Desktop model-source call
acquires exactly one scoped lease and reuses its service and generation context
in all helpers. A generation entering drain stops new leases and cancels its
shared generation context. The controller waits for every idempotent release,
closes the old service once, and only then constructs and publishes a
replacement. Shutdown also waits for admitted maintenance writers and view publishers. Read-state helpers obtain their store through the same scoped service lease; they never retain a bare database pointer or fabricate read records after failure. Two `NewServiceContext` calls therefore cannot compete for the
same Floret `runtime.Host` and backend.

The controller derives its lifecycle from Code App rather than a background
context. Parent cancellation stops startup, cancels the generation, drains
leases, and closes the service. Redeven Settings publishes the latest model
configuration, effective home, shell, and filesystem scope into a versioned
process-local startup snapshot. Every attempt reads that snapshot; a service
created from an obsolete revision is closed before the controller retries with
the latest values.

RPC routes are registered against the service provider rather than one fixed
service pointer. Each request acquires the then-current generation, so a
connection established while AI is blocked can use a later ready generation
without reconnecting. There is no realtime subscription binding or replay
lifecycle in this owner. Long-lived model-source calls receive the generation
context so replacement can cancel their work before waiting for release.

## Route availability

AI lifecycle routes return HTTP 503 with machine code
`AI_SERVICE_UNAVAILABLE` and the current sanitized snapshot when no generation
can be leased. Model-not-configured remains a distinct ready-service error.
Readiness, retry, stop, and administrator-only snapshot and restore routes never acquire a service. Provider-key and web-search-key
status/update routes remain Redeven secrets operations and do not acquire AI,
so users can repair credentials while runtime AI is blocked.

Settings and every unrelated product route remain available. Settings may use
an optional lease to project current runtime details, but absence of a lease
does not hide product configuration or fail the request. This isolation does
not create a second Agent source of truth: ready thread and lifecycle reads
still call the exact Floret-backed `ai.Service` generation.

Model directory discovery is also outside Flower admission. Runtime publishes
an offline baseline projection first; dynamic provider, platform, and Desktop
catalog checks run in one bounded complete read and report per-source status.
Flower may show history, canvas bindings, drafts, and static selected models
while a source is pending or unavailable. A directory refresh never changes
selection intent, authorizes a send, or creates a second readiness controller.

HTTP acquisition happens only after the exact route permission succeeds.
Denied admin or full-access requests and unknown AI routes never obtain a
generation lease. Incomplete provider leases fail closed, release any supplied
resource, and cannot be presented as `ready`.

## Maintenance presentation

See [Flower startup and recovery presentation](flower-startup-presentation.md) for
Env App and Desktop admission, phase progress, stop/retry, focus and draft continuity.

# Boundaries

The readiness controller must not import Floret, SQLite, or threadstore
packages; perform owner storage inspection; hold `runtime.Host` or `storage.Backend`; or retain canonical
Agent DTOs. AppServer must not hold `*ai.Service`, and Code App must not expose
a raw `AI()` pointer. Service construction and closure belong to the controller;
callers receive only scoped leases.

Unavailable presentation cannot infer corruption, compatibility, or retry
safety from error strings. It must use the typed startup projection and fail
closed for unknown outcomes. Only narrow SQLite busy/locked and temporary
resource signals may be mapped to safe automatic recovery; permission, schema,
integrity, and unknown I/O failures remain non-retryable and preserve the
upstream-owned file unchanged. Floret `runtime.ErrAuthorityCorrupt` is an
integrity failure, never a busy condition, even when SQLite's physical
integrity check succeeds. Readiness history is not recovery authority.

# Evidence

- `redeven:internal/codeapp/ai_readiness.go:1` - Owns serialized startup, sanitized state, generation cancellation, drain, replacement, and close.
- `redeven:internal/codeapp/appserver/ai_readiness.go:1` - Defines the narrow lease provider, readiness DTO, route classification, and unavailable envelope.
- `redeven:internal/codeapp/appserver/server.go:2277` - Acquires one request lease and propagates its service through request context.
- `redeven:internal/ai/rpc.go:103` - Registers stable AI RPC handlers that acquire one scoped service lease per request.
- `redeven:internal/agent/desktop_model_source.go:10` - Holds one generation lease for each Desktop model-source operation.
- `redeven:internal/codeapp/ai_readiness_test.go:16` - Covers drain ordering, close failure, parent cancellation, current startup options, replacement, duplicate release, late startup, phases, and sanitized failures.
- `redeven:internal/ai/floret_store_maintenance_test.go:1` - Proves that one service startup opens exactly one retained Floret Host and preserves typed failure classification.
- `redeven:internal/codeapp/appserver/ai_readiness_test.go:78` - Covers unified unavailable responses, optional Settings projection, exact permission ordering, invalid leases, and secrets-only routes.
- `redeven:internal/agent/ai_rpc_registration_test.go:13` - Proves the stable RPC inventory remains registered and returns structured unavailability without a service.
- `redeven:scripts/check_floret_dependency_boundary.sh:1` - Rejects fixed service pointers, raw accessors, misplaced constructors, and readiness storage coupling.
