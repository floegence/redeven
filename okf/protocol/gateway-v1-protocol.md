---
type: Protocol Contract
title: Gateway v2 protocol
description: OpenAPI and signed HTTP JSON contract for Gateway access and Runtime lifecycle operations.
tags: [gateway, protocol, desktop, openapi, runtime]
timestamp: 2026-08-17T00:00:00Z
---
# Summary

`redeven-gateway` exposes the stable `redeven-gateway-v2` HTTP JSON protocol. Gateway is an optional Runtime lifecycle supervisor and an independent process; it is not required for Runtime Connect, Workspace, or Runtime UI access. Gateway owns Runtime operation progress, target locking, checkpoints, fencing, and recovery. Desktop is a client that observes or starts an operation and never represents Runtime lifecycle ownership.

# Contract

## Wire surface

The machine-readable source is `spec/openapi/gateway-v2.yaml`. It defines pairing, catalog, open-session, profile writes, capability discovery, operation prepare/list/get/confirm/artifact/commit/cancel/deadline/reconcile, and event reads under `/gateway/v2/*`. Signed requests bind protocol, method, route, body digest, gateway identity, binding audience, nonce, and timestamp. Pairing and profile-write bridge tokens are transport credentials, not Runtime operation authority.

Runtime lifecycle requests require an exact `lifecycle_target_id`, `target_generation`, authorized client key, operation scope, and (for updates) a published-release or custom-build artifact policy. `prepare` is the authorization linearization point and occurs before staging, upload, process stop, or local build. Repeating the same normalized scope attaches to the durable operation; a conflicting operation returns `operation_in_progress` instead of queueing or reassigning control.

`operation_id` is a canonical 1-128 character token using only letters, digits, dot, underscore, colon, and hyphen. Gateway derives artifact staging directories from its digest and rejects path syntax before persistence.

The Gateway operation store is the only lifecycle progress authority. It persists pre-commit deadlines, workload snapshots, distinct archive/executable digests, artifact staging, lifecycle fence tokens, durable commit checkpoints, exact candidate process identity, recovery phases, and `manual_recovery_required` quarantine. Commit rechecks target generation and exact workload identities; unknown inventory is never treated as empty. A successful commit verifies staged executable bytes before activation and running identity afterward. Recovery terminates a recorded failed candidate before idempotently restoring the previous installation; an unverifiable result remains quarantined until a binding administrator reconciles it with a new exact permit.

List, Get, and Events authorize before exposing operation existence. The original authorized client receives the full operation needed for mutation; any other current `manage_runtime` client receives a redacted DTO without actor, client key, idempotency, build, artifact, workload-identity, checkpoint, or desired-runtime details. Reconcile is not an ownership takeover and never accepts force unlock.

Gateway and Runtime versions are independent. Lifecycle compatibility is decided by the signed compatibility manifest, Gateway protocol, Runtime service protocol/epoch, and capabilities. A version string match is neither necessary nor sufficient. Cross-epoch updates additionally require the signed manifest to list the discovered current Runtime epoch in `upgrade_from_runtime_epochs`; the v0.11.0 release contract explicitly admits the reviewed epoch 8 to epoch 9 transition. Gateway updates are performed by Desktop installer or administrator setup; the Gateway protocol contains no self-update operation.

Catalog/open-session and ordinary terminal, files, web, and workspace traffic remain separate from lifecycle operations. An explicit Gateway card may use its own open-session transport, but ordinary data never enters the Runtime operation store and does not consume a lifecycle permit.

# Boundaries

The contract excludes Desktop bridge stdio frames, Env App proxy routes, Runtime Service schemas, installer metadata, and Provider authorization. Portal grants and permits are consumed by Gateway at prepare; Portal records only authorization and binding audit facts and does not mirror operation state. URL environments remain access-only for Runtime lifecycle management.

# Evidence

- `redeven:spec/openapi/gateway-v2.yaml:1` - OpenAPI 3.1 Gateway v2 contract and signed payload fields.
- `redeven:internal/runtimegateway/protocol/openapi_contract_test.go:69` - Structural contract test compares protocol, paths, routes, security, enums, and closed schemas.
- `redeven:internal/gatewayservice/server.go:188` - Gateway validates protocol, target, authorization, and operation scope before lifecycle execution.
- `redeven:internal/runtimegateway/protocol/lifecycle_v2.go:283` - Typed prepare, confirmation, deadline, artifact, and recovery request contracts.
- `redeven:internal/runtimegateway/supervisor/` - Durable operation authorization, target locking, checkpoint, and recovery implementation.
- `redeven:desktop/src/main/gatewayClient.ts` - Desktop uses the Gateway v2 route and protocol literal.
