---
type: Gateway Contract
title: Gateway service
description: redeven-gateway is a separate Gateway service binary with managed lifecycle and Desktop bridge support.
tags: [gateway, desktop, release, runtime]
timestamp: 2026-06-18T00:00:00Z
---

Gateway is no longer folded into the Runtime Service snapshot. It is a separate `redeven-gateway` binary and service surface that Desktop can manage, bridge, pair, and use for Gateway-owned environment profiles.

# Mechanism

The Gateway CLI exposes `serve`, `desktop-bridge`, `service-status`, `service-start`, `service-stop`, and `version`. Managed service start creates a bridge token, launches `serve` in the background, records a PID/listen status file, and waits for readiness. `desktop-bridge` verifies that the service is running and that the managed bridge token exists, then serves the Gateway protocol bridge over stdio. The release workflow builds and packages `redeven-gateway` alongside the main `redeven` binary.

The Gateway HTTP JSON protocol source contract is `spec/openapi/gateway-v1.yaml`. That OpenAPI file describes the `/gateway/v1/*` wire surface, request/response envelopes, schema variants, auth headers, the managed bridge token boundary, and the `redeven-gateway-v1` protocol version. The contract is checked by `internal/runtimegateway/protocol/openapi_contract_test.go` and by `scripts/check_gateway_protocol_contract.sh`, so Go service routes, Desktop client routes, enums, envelope shape, and protocol literals cannot drift silently.

# Boundaries

Gateway state, pairing, profile write enablement, and private-profile-target allowance are Gateway service concerns. Runtime Service compatibility stays separate unless the runtime snapshot contract itself changes.

OpenAPI is intentionally limited to the Gateway HTTP JSON wire contract. It does not define the Desktop bridge stdio frame protocol, Env App proxy routes, Runtime Service compatibility windows, or a full state-machine DSL. Gateway semantics such as nonce lifetime, trust profile pinning, stale catalog invalidation after protocol failure, and managed-versus-external recovery actions are enforced by Go/TypeScript tests and documented in OKF rather than encoded as a new custom protocol language.

Gateway should not depend on the Flowersec DSL for this API contract. Flowersec remains a transport/session dependency boundary, while Gateway's control API is a small HTTP surface with explicit OpenAPI schemas and focused contract tests.

# Citations

[1] redeven:cmd/redeven-gateway/main.go:83 - `serve` accepts state root, listen address, private target, profile write, and pairing flags.
[2] redeven:cmd/redeven-gateway/main.go:116 - `desktop-bridge` exposes the Gateway protocol bridge over stdio.
[3] redeven:cmd/redeven-gateway/main.go:188 - `service-start` starts a managed Gateway service in the background.
[4] redeven:cmd/redeven-gateway/main.go:217 - Managed service start ensures a managed bridge token exists.
[5] redeven:cmd/redeven-gateway/main.go:227 - Managed service start launches `serve` with state and listener flags.
[6] redeven:cmd/redeven-gateway/main.go:254 - `service-stop` terminates a running managed Gateway service and removes managed state markers.
[7] redeven:cmd/redeven-gateway/main.go:293 - Gateway service construction receives Desktop bridge, profile target, profile write, pairing, and token options.
[8] redeven:cmd/redeven-gateway/main.go:495 - CLI help lists the Gateway command set.
[9] redeven:.github/workflows/release.yml:51 - Release validates the Gateway protocol contract before packaging.
[10] redeven:internal/runtimeservice/compatibility_contract.json:8 - The current compatibility review records Gateway service decoupling as outside the Runtime Service window.
[11] redeven:spec/openapi/gateway-v1.yaml:1 - The Gateway OpenAPI contract declares OpenAPI 3.1.
[12] redeven:spec/openapi/gateway-v1.yaml:24 - The Gateway OpenAPI contract declares the `redeven-gateway-v1` version.
[13] redeven:internal/runtimegateway/protocol/openapi_contract_test.go:73 - The contract test rejects the old runtime-gateway protocol name.
[14] redeven:internal/runtimegateway/protocol/openapi_contract_test.go:76 - The contract test rejects Runtime Service compatibility fields in Gateway OpenAPI.
[15] redeven:scripts/check_gateway_protocol_contract.sh:9 - The standalone contract check runs the Gateway OpenAPI and naming-boundary tests.
