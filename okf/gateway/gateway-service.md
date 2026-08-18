---
type: Gateway Contract
title: Gateway service
description: Standalone Gateway supervisor, target binding, operation recovery, and Desktop transport integration.
tags: [gateway, desktop, release, runtime]
timestamp: 2026-08-17T00:00:00Z
---
# Summary

`redeven-gateway` is an independent process and component version. It is optional for Runtime access but is the only executor and durable authority for Redeven-managed Runtime lifecycle operations. It runs as the target OS user, owns target locks and recovery, and exposes ordinary Gateway open-session separately from lifecycle control.

The service uses one state-root lock so two Gateway supervisors cannot control the same target concurrently. Its status record is accepted only when the PID still has the recorded executable and process start time; a stale or reused PID is treated as not running.

# Contract

## Supervisor and compatibility

Gateway persists its supervisor identity, installation marker, target id/generation, binding, operation store, checkpoint, and quarantine state. Registration rejects an installation-root alias that names another target. Gateway and Runtime versions need not match; a signed compatibility manifest, stable Gateway protocol, Runtime service protocol/epoch, capabilities, and artifact digest decide compatibility. Gateway-first setup is performed by Desktop installer or an administrator and has no self-update state machine.

For a Provider binding, the Gateway process itself maintains the signed RCPP v3 supervisor poll/respond transport and dispatches accepted lifecycle frames directly to the Gateway-owned operation service. This transport remains available while Runtime and its Agent are stopped. An offline heartbeat may reuse persisted Runtime compatibility facts only when exact process inventory is empty and the managed executable digest still matches those facts; external byte replacement stops readiness projection. There is no Runtime control RPC, local management socket, or self-RPC fallback for Provider lifecycle. A transport disconnect does not cancel an already authorized durable operation; reconnect resumes polling and authorized clients attach to Gateway state.

## Lifecycle

`prepare` validates its action-scoped permit and client key before build, upload, staging, stop, or lock acquisition. One target mutation lock serializes prepare with enrollment; a same-target rebind advances generation from `n` to `n+1` and is rejected while an active operation or quarantine exists. One target lock protects each durable operation. Checkpoints survive Gateway restart; pre-commit deadlines expire safely, while committing/recovering/quarantined operations do not silently expire. Atomic replacement, health verification, rollback, and persistent manual recovery are one Gateway state machine. Reconcile requires a separate binding-admin permit with no artifact or build scope; Gateway persists its one-time consumption before recovery, and response-loss retry can only return the same terminal result.

Published artifacts carry distinct archive and executable digests. Gateway verifies the archive before extraction, verifies the final executable bytes in staging before activation, and compares the running Runtime identity with that executable digest after start. The complete recovery plan, previous-installation identity, verified staging root, and exact candidate process identity are durably persisted and parent-directory synced before shutdown. Recovery first terminates only the recorded candidate process, then advances idempotent phases to restore and verify the previous installation; an unverifiable result remains `manual_recovery_required` instead of unlocking or accepting mixed state.

Operation identifiers are canonical bounded tokens and staging paths are derived from their digest, so request data cannot select an arbitrary filesystem path. Failed extraction, cancellation, expiry, and interrupted staging remove the durable artifact directory before the operation is released.

Authorized managers list active operations by exact environment, target, and generation. The original authorized client receives the mutation fields it needs to resume confirmation, artifact upload, or commit. Another current manager receives only a redacted observation DTO and can attach to progress without inheriting mutation authority. A binding administrator can reconcile a quarantined operation with a new exact permit; historical Desktop client identity is not required for that separate action.

## Access boundary

Catalog and explicit open-session continue to provide Gateway-card access. Terminal, files, web, and workspace data do not pass through the lifecycle operation store. Gateway is not a container/Provider Environment lifecycle manager, and Runtime continues to start and serve ordinary access without a Gateway process.

# Boundaries

Gateway owns only Redeven-managed Runtime lifecycle state for its registered target and generation. Ordinary session access, terminal, files, web, workspace traffic, Runtime service execution, and Provider or container environment lifecycle remain outside that operation store. Desktop and Provider transports may authorize or observe Gateway operations, but they cannot bypass its target lock, permits, checkpoints, or recovery state.

# Evidence

- `redeven:cmd/redeven-gateway/main.go:1` - Independent Gateway CLI and persistent service identity.
- `redeven:internal/gatewayservice/server.go:188` - Signed request and operation endpoint validation.
- `redeven:internal/runtimegateway/supervisor/` - Target lock, durable operation, checkpoint, deadline, and recovery implementation.
- `redeven:internal/runtimegateway/supervisor/provider.go:1` - Gateway-owned Provider heartbeat and signed reverse management transport.
- `redeven:internal/gatewayservice/provider_tunnel.go:1` - Direct dispatch into the single Gateway operation authority.
- `redeven:internal/runtimegateway/lifecycle/store.go:390` - Exact active-operation listing, observer redaction, and binding-admin reconciliation.
- `redeven:spec/openapi/gateway-v2.yaml:1` - Gateway v2 machine contract.
- `redeven:desktop/src/main/gatewayLifecycleManager.ts:1` - Desktop installer/setup and service readiness adapter.
