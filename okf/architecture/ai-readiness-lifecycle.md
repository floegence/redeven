---
type: Architecture Contract
title: AI readiness and service generation lifecycle
description: Keep Code App available while a process-local controller serializes AI startup, retry, and request-scoped service generations.
tags: [architecture, ai, readiness, lifecycle, floret]
timestamp: 2026-07-25T00:00:00Z
---
# Summary

- Authority: Floret owns durable Agent and Store facts; Redeven owns process-local AI availability and presentation.
- Outcome: non-AI product surfaces remain usable while AI startup inspects, migrates, verifies, recovers, or blocks.
- Invariants: one controller owns construction, retry, generation publication, request leases, drain, and close; each AI request stays on one generation.
- Failure boundary: unavailable or blocked startup returns a sanitized typed envelope, publishes no partial service, repairs no Store data, and never becomes durable Agent state.

# Contract

## Process-local readiness

The Code App composition layer owns the only AI readiness controller. Its
closed state set is `unavailable`, `inspecting`, `migrating`, `verifying`,
`recovering`, `ready`, and `blocked`. Store inspection, automatic domain migration, and
verification occur only inside the single published Floret `runtime.Open` call
that creates the actual Host retained by the new service generation. Redeven
reports `inspecting` before that call and `verifying` after it returns while
product composition and startup recovery finish; it must not open and close a
disposable probe Host before opening the retained Host. Failures are mapped from
the typed Redeven startup projection into sanitized product reason codes plus
`retryable`, `safe_to_retry`, `committed`, and `rolled_back` facts. Generic
service construction failures use `ai_service_startup_error`; raw errors,
paths, schema identities, fingerprints, SQL, and backend content are not exposed.
An old generation close failure is terminal for the process: the controller
publishes a sanitized blocked snapshot, refuses retry, and never opens another
service against a Floret backend whose previous owner did not close successfully.

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
replacement. Two `NewServiceContext` calls therefore cannot compete for the
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
Readiness and retry never acquire a service. Provider-key and web-search-key
status/update routes remain Redeven secrets operations and do not acquire AI,
so users can repair credentials while runtime AI is blocked.

Settings and every unrelated product route remain available. Settings may use
an optional lease to project current runtime details, but absence of a lease
does not hide product configuration or fail the request. This isolation does
not create a second Agent source of truth: ready thread and lifecycle reads
still call the exact Floret-backed `ai.Service` generation.

HTTP acquisition happens only after the exact route permission succeeds.
Denied admin or full-access requests and unknown AI routes never obtain a
generation lease. Incomplete provider leases fail closed, release any supplied
resource, and cannot be presented as `ready`.

## Env App maintenance presentation

Env App shares one readiness controller across Activity, Workbench, and
Settings. Flower stays mounted while a sibling maintenance section occupies
only its visible slot. The boundary never disables or hides the shell,
Workbench, terminal, files, Settings, or a shared ancestor. Only the visible
Flower placement may move or restore focus.

Env App begins readiness inspection only after the HTTP access status has been
checked and access is granted. The readiness HTTP route remains available while
the encrypted direct RPC transport connects, resumes, or reconnects, so
readiness refresh must not wait for RPC or access-resume UI state. Initial lock
and every later grant revocation pause the controller, invalidate in-flight
publication, clear polling and automatic retry state, and reject manual refresh
or retry without issuing HTTP requests. A later grant resumes exactly one fresh
inspection. When a Runtime restart invalidates local access, the password gate
replaces the recovery presentation while the existing Activity Flower component
remains mounted and inert; a successful regrant may complete the prior failed
recovery generation.

Transient inspection delays progress presentation and never invents a
percentage. Typed busy or temporary I/O failures enter bounded `recovering`;
unsafe failures block. The process-level `agent.lock` remains the state-root
owner, so another runtime attaches or reports conflict instead of opening an
empty Store. Automatic retry requires typed safety and current admin authority;
manual retry is single-flight. No force, reset, repair, ignore, or backend
mutation action exists. Returning to `ready` reveals the retained Flower DOM.

Displayed diagnostics and clipboard output use the same sanitized projection.
A bounded trace id, startup phase, and retry reason may support diagnosis, but
raw paths, schema or SQL details, credentials, provider state, and tool output
never cross the boundary. Unknown or contradictory facts become one
non-retryable contract failure. Settings reports only Floret readiness and marks
other store owners outside the check instead of fabricating health.

# Boundaries

The readiness controller must not import Floret, SQLite, or threadstore
packages; inspect storage; hold `runtime.Host` or `storage.Backend`; or retain canonical
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
- `redeven:internal/envapp/ui_src/src/ui/flower/aiReadiness.ts:1` - Strictly normalizes the sanitized wire facts and owns bounded, permission-aware polling and retry state.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.localAccess.e2e.test.tsx:1` - Verifies initial lock, grant, revocation, stable Activity ownership, and one fresh readiness request after local or remote regrant.
- `redeven:internal/envapp/ui_src/src/ui/flower/AIReadinessBoundary.tsx:1` - Keeps maintenance presentation local to Flower with focus restoration and same-source diagnostics.
- `redeven:internal/envapp/ui_src/src/ui/pages/settings/AIReadinessSettingsSection.tsx:1` - Groups store owners without claiming health for stores outside the readiness check.
- `redeven:internal/envapp/ui_src/src/ui/flower/AIReadinessBoundary.browser.test.tsx:1` - Verifies narrow reflow, zoom, forced colors, reduced motion, overflow, and local interaction behavior in Chromium.
- `redeven:scripts/check_floret_dependency_boundary.sh:1` - Rejects fixed service pointers, raw accessors, misplaced constructors, and readiness storage coupling.
