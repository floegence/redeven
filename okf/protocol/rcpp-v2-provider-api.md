---
type: Protocol Contract
title: RCPP v3 provider API
description: Provider access, Runtime grants, supervisor enrollment, permit, and readiness contract.
tags: [protocol, provider, openapi, desktop, runtime]
timestamp: 2026-08-17T00:00:00Z
---
# Summary

RCPP v3 is the Provider-side authorization contract in `docs/openapi/rcpp-v3.yaml` and `shared/contracts/providerprotocol/rcpp.go`. Connect and Workspace access are separate from Runtime management. The Portal exposes `manage_runtime`, `deploy_custom_runtime`, and `manage_runtime_binding` independently, signs a precise one-time permit, and stores only binding and audit facts. The target Gateway remains the sole Runtime operation authority.

# Contract

## Access and Runtime link

RCPP v3 open-session is Access/Open only and rejects any response that contains the frozen v2 `bootstrap_ticket` field. Runtime link uses a separate one-time authorization and exchange. Lifecycle traffic uses the Provider Environment's signed management tunnel and never asks for another Gateway card, paired key, SSH credential, container credential, or public Runtime URL. The tunnel permits only Gateway lifecycle routes; ordinary access and data-plane traffic remain outside it.

## Capability projection

Environment list and capability responses expose `support`, `authorization`, and `readiness` as independent dimensions. Projection always evaluates support first, authorization second, and readiness third. Unsupported URL access returns `unsupported`; an authorized but unbound local, SSH, or container target returns `setup_required`; an existing binding with a stale heartbeat returns `temporarily_unavailable`. An unauthorized response does not reveal target, generation, installation, or last-seen facts.

## Authorization and permits

`POST .../runtime-management/authorizations` signs an explicit `prepare` or binding-admin `reconcile` action. Prepare binds the exact actor, access point, environment, lifecycle target, generation, operation, desired Runtime version, artifact policy, build-input digest, authorized client key, current Gateway binding, and expiry. Gateway exchanges that permit once during prepare; later Provider token expiry or revocation does not re-authorize an already linearized operation. Reconcile carries only `manage_runtime_binding`, has no desired-version, artifact-policy, or build-input scope, and is durably consumed by Gateway before recovery. Any action or scope mismatch is rejected.

## Enrollment and fencing

Enrollment is either an explicitly selected direct card or an interactive one-time code. The challenge persists a proof nonce, target generation, and the full `ControlChannelFence`: logical binding, control binding generation, artifact sequence, authorization lease, and control owner instance. The supervisor signs the canonical proof payload with its Ed25519 key. Existing control bindings require a live same-scope RPC proof and an unchanged fence; first binding has no prior fence and establishes a new trust record. Rebinding the same target advances its generation from `n` to `n+1`; Gateway serializes it with prepare under one target mutation lock and rejects it while an operation is active or the target is quarantined. A challenge is single-use, expires, and cannot be replayed.

The binding records lifecycle target/generation, supervisor identity, installation digest, independent Gateway and Runtime versions, protocol, compatibility epoch, capabilities, artifact digest, and heartbeat freshness. These observations determine readiness only; Portal does not store operation steps, checkpoints, locks, or recovery projections.

# Boundaries

RCPP v2 remains a frozen access/bootstrap protocol, but v3 has its own DTOs and never falls back to v2 bootstrap. Provider cards never borrow Gateway/SSH/container credentials or use a public Environment URL as a control fallback. Runtime Connect, Workspace, and open-session continue when lifecycle support is unavailable.

# Evidence

- `redeven:desktop/src/main/controlPlaneProviderClient.ts:1` - RCPP v3 capability, authorization, enrollment, and heartbeat client adapter.
- `redeven:desktop/src/main/controlPlaneProviderClient.test.ts:1` - Provider response parsing and request-scope coverage.
- `redeven:internal/runtimegateway/supervisor/authorizer.go:1` - Provider permit verification and explicit Runtime grant enforcement.
- `redeven:internal/runtimegateway/supervisor/authorizer_test.go:1` - Permit scope, pinned key, and grant-isolation tests.
