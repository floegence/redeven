---
type: Architecture Contract
title: AI readiness and service generation lifecycle
description: Keep Code App available while a process-local controller serializes AI startup, retry, and request-scoped service generations.
tags: [architecture, ai, readiness, lifecycle, floret]
timestamp: 2026-07-25T00:00:00Z
---
# Summary

- Authority: Floret remains the only authority for durable Agent lifecycle and Store facts; Redeven owns only current-process AI availability and product presentation.
- Outcome: Code App, Settings, Notes, Workbench, terminal, files, and Codex start and remain usable when AI startup is inspecting, migrating, verifying, or blocked.
- Invariants: one controller owns AI service construction, retry serialization, generation publication, request leases, draining, and close; each AI request uses one generation for its complete lifetime.
- Failure boundary: a blocked generation returns one typed unavailable envelope, never publishes partial runtime authority, never repairs Store data, and never turns readiness into durable Agent state.

# Contract

## Process-local readiness

The Code App composition layer owns the only AI readiness controller. Its
closed state set is `unavailable`, `inspecting`, `migrating`, `verifying`,
`ready`, and `blocked`. Maintenance phases are reported only by the actual
public Floret Inspect, Migrate, and Verify calls. Failures are mapped from the
typed Redeven startup projection into sanitized product reason codes plus
`retryable`, `safe_to_retry`, `committed`, and `rolled_back` facts. Generic
service construction failures use `ai_service_startup_error`; raw errors,
paths, schema identities, fingerprints, SQL, and Store content are not exposed.
An old generation close failure is terminal for the process: the controller
publishes a sanitized blocked snapshot, refuses retry, and never opens another
service against a Store whose previous owner did not close successfully.

Readiness is memory-only. It is not written to threadstore, audit records, or a
Floret Store, and it cannot reconstruct a thread, turn, approval, todo, tool,
provider, or Activity lifecycle. `GET /_redeven_proxy/api/ai/readiness` returns
the sanitized snapshot. Settings includes the same snapshot while keeping its
non-AI configuration readable. Retry is explicit, asynchronous, and admits at
most one startup owner.

## Generation leases

Every ready service is published as one monotonically identified generation.
An HTTP AI request, ordinary RPC call, runtime snapshot, or Desktop model-source
call acquires exactly one scoped lease and reuses its service and generation
context in all helpers. A realtime RPC subscription keeps one separate binding
lease for as long as its current generation remains active. A generation
entering drain stops new leases and cancels its shared generation context. The
controller waits for every idempotent release, closes the old service once, and
only then constructs and publishes a replacement. Two `NewServiceContext`
calls therefore cannot compete for the same Floret Store.

The controller derives its lifecycle from Code App rather than a background
context. Parent cancellation stops startup, cancels the generation, drains
leases, and closes the service. Redeven Settings publishes the latest model
configuration, effective home, shell, and filesystem scope into a versioned
process-local startup snapshot. Every attempt reads that snapshot; a service
created from an obsolete revision is closed before the controller retries with
the latest values.

RPC routes are registered against the provider rather than one service. A
connection established while AI is blocked can use a later ready generation
without reconnecting. When an active subscription's generation context is
cancelled, its manager detaches the sink while it still owns the binding lease,
releases that lease, and retries acquisition until it can replay the summary
and thread subscriptions on a ready replacement. Connection cleanup uses the
same idempotent detach-and-release ownership path; no service pointer remains
after its lease ends. Long-lived model-source calls receive the generation
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

Env App shares one Redeven-owned readiness controller across its Activity,
Workbench, and Settings consumers. A Flower surface keeps the same component
instance mounted, but hides that local subtree from layout, focus, and assistive
technology until the sanitized snapshot is `ready`. A flat sibling maintenance
section occupies only the Flower slot. It never sets `inert`, `aria-hidden`, a
modal role, or a pointer trap on the Env App shell, Workbench canvas, terminal,
files, Settings, or any shared ancestor. Only the visible Flower placement may
move or restore focus; a retained Activity placement cannot compete with the
active Workbench placement.

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

Transient inspection waits briefly before presenting progress, does not invent
a percentage, and shows the next bounded check without announcing a countdown
every second. Automatic retries are limited to typed safe temporary or I/O
failures, require current product admin authority, slow down while the document
is hidden, and reset their allowance only after that blocked episode settles.
Manual retry is single-flight and is offered only when the current user and the
mapped reason policy allow a new generation. Update and environment-access actions route
to Redeven-owned Settings. No force, reset, repair, ignore, or Store mutation
action exists. Returning to `ready` reveals the same Flower DOM and restores the
previous valid target without a success notification.

Displayed diagnostics and clipboard output iterate the same projection of the
six sanitized readiness fields. The projection maps reason codes to localized
copy and never includes a raw reason, path, schema or SQL detail, credential,
message, provider state, or tool output. Unknown states, reasons, and
contradictory retry, commit, or rollback facts become one non-retryable contract
failure. Settings groups the Floret Store separately from Redeven product stores
and other upstream stores; only Floret receives a readiness result, while the
other owners are explicitly marked as outside this check instead of receiving a
fabricated health claim. All interactive controls publish pending state in the
input turn, keep visible focus and pointer/disabled cursors, and provide explicit
localized copy for clipboard failure.

# Boundaries

The readiness controller must not import Floret, SQLite, or threadstore
packages; inspect storage; hold a Store or `HostBootstrap`; or retain canonical
Agent DTOs. AppServer must not hold `*ai.Service`, and Code App must not expose
a raw `AI()` pointer. Service construction and closure belong to the controller;
callers receive only scoped leases.

Unavailable presentation cannot infer corruption, compatibility, or retry
safety from error strings. It must use the typed startup projection and fail
closed for unknown outcomes. Readiness history is not recovery authority.

# Evidence

- `redeven:internal/codeapp/ai_readiness.go:1` - Owns serialized startup, sanitized state, generation cancellation, drain, replacement, and close.
- `redeven:internal/codeapp/appserver/ai_readiness.go:1` - Defines the narrow lease provider, readiness DTO, route classification, and unavailable envelope.
- `redeven:internal/codeapp/appserver/server.go:2277` - Acquires one request lease and propagates its service through request context.
- `redeven:internal/ai/rpc.go:123` - Registers AI RPC handlers against scoped call and realtime-subscription leases.
- `redeven:internal/agent/desktop_model_source.go:10` - Holds one generation lease for each Desktop model-source operation.
- `redeven:internal/codeapp/ai_readiness_test.go:16` - Covers drain ordering, close failure, parent cancellation, current startup options, replacement, duplicate release, late startup, phases, and sanitized failures.
- `redeven:internal/codeapp/appserver/ai_readiness_test.go:78` - Covers unified unavailable responses, optional Settings projection, exact permission ordering, invalid leases, and secrets-only routes.
- `redeven:internal/ai/rpc_readiness_test.go:15` - Covers dynamic recovery, generation lease counts, invalid leases, and concurrent connection cleanup.
- `redeven:internal/envapp/ui_src/src/ui/flower/aiReadiness.ts:1` - Strictly normalizes the sanitized wire facts and owns bounded, permission-aware polling and retry state.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.localAccess.e2e.test.tsx:1` - Verifies initial lock, grant, revocation, stable Activity ownership, and one fresh readiness request after local or remote regrant.
- `redeven:internal/envapp/ui_src/src/ui/flower/AIReadinessBoundary.tsx:1` - Keeps maintenance presentation local to Flower with focus restoration and same-source diagnostics.
- `redeven:internal/envapp/ui_src/src/ui/pages/settings/AIReadinessSettingsSection.tsx:1` - Groups store owners without claiming health for stores outside the readiness check.
- `redeven:internal/envapp/ui_src/src/ui/flower/AIReadinessBoundary.browser.test.tsx:1` - Verifies narrow reflow, zoom, forced colors, reduced motion, overflow, and local interaction behavior in Chromium.
- `redeven:scripts/check_floret_dependency_boundary.sh:1` - Rejects fixed service pointers, raw accessors, misplaced constructors, and readiness storage coupling.
