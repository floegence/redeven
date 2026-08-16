---
type: Gateway Contract
title: Gateway service
description: Standalone Gateway supervisor, target binding, operation recovery, and Desktop transport integration.
tags: [gateway, desktop, release, runtime]
timestamp: 2026-08-17T00:00:00Z
---
# Summary

`redeven-gateway` is an independent process and component version. It is optional for Runtime access but is the only executor and durable authority for Redeven-managed Runtime lifecycle operations. It runs as the target OS user, owns target locks and recovery, and exposes ordinary Gateway open-session separately from lifecycle control.

# Contract

## Supervisor and compatibility

Gateway persists its supervisor identity, installation marker, target id/generation, binding, operation store, checkpoint, and quarantine state. Registration rejects an installation-root alias that names another target. Gateway and Runtime versions need not match; a signed compatibility manifest, stable Gateway protocol, Runtime service protocol/epoch, capabilities, and artifact digest decide compatibility. Gateway-first setup is performed by Desktop installer or an administrator and has no self-update state machine.

## Lifecycle

`prepare` validates its action-scoped permit and client key before build, upload, staging, stop, or lock acquisition. One target mutation lock serializes prepare with enrollment; a same-target rebind advances generation from `n` to `n+1` and is rejected while an active operation or quarantine exists. One target lock protects each durable operation. Checkpoints survive Gateway restart; pre-commit deadlines expire safely, while committing/recovering/quarantined operations do not silently expire. Atomic replacement, health verification, rollback, and persistent manual recovery are one Gateway state machine. Reconcile requires a separate binding-admin permit with no artifact or build scope; Gateway persists its one-time consumption before recovery, and response-loss retry can only return the same terminal result.

## Access boundary

Catalog and explicit open-session continue to provide Gateway-card access. Terminal, files, web, and workspace data do not pass through the lifecycle operation store. Gateway is not a container/Provider Environment lifecycle manager, and Runtime continues to start and serve ordinary access without a Gateway process.

# Evidence

- `redeven:cmd/redeven-gateway/main.go:1` - Independent Gateway CLI and persistent service identity.
- `redeven:internal/gatewayservice/server.go:188` - Signed request and operation endpoint validation.
- `redeven:internal/runtimegateway/supervisor/` - Target lock, durable operation, checkpoint, deadline, and recovery implementation.
- `redeven:spec/openapi/gateway-v2.yaml:1` - Gateway v2 machine contract.
- `redeven:desktop/src/main/gatewayLifecycleManager.ts:1` - Desktop installer/setup and service readiness adapter.
