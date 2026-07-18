---
type: Gateway Contract
title: Gateway service
description: redeven-gateway is a separate Gateway service binary with managed lifecycle and Desktop bridge support.
tags: [gateway, desktop, release, runtime]
timestamp: 2026-06-18T00:00:00Z
---
# Summary

Gateway is no longer folded into the Runtime Service snapshot. It is a separate `redeven-gateway` binary and service surface that Desktop can manage, bridge, pair, and use for Gateway-owned environment profiles.

redeven-gateway is a separate Gateway service binary with managed lifecycle and Desktop bridge support.

# Contract

## Mechanism

The Gateway CLI exposes `serve`, `desktop-bridge`, `service-status`, `service-start`, `service-stop`, and `version`. Managed service start creates a bridge token, launches `serve` in the background, records a PID/listen status file, and waits for readiness. `desktop-bridge` verifies that the service is running and that the managed bridge token exists, then serves the Gateway protocol bridge over stdio. The release workflow builds and packages `redeven-gateway` alongside the main `redeven` binary.

The Gateway HTTP JSON protocol source contract is `spec/openapi/gateway-v1.yaml`. That OpenAPI file describes the `/gateway/v1/*` wire surface, request/response envelopes, schema variants, auth headers, the managed bridge token boundary, and the `redeven-gateway-v1` protocol version. The contract is checked by `internal/runtimegateway/protocol/openapi_contract_test.go` and by `scripts/check_gateway_protocol_contract.sh`, so Go service routes, Desktop client routes, enums, envelope shape, and protocol literals cannot drift silently.

Desktop coordinates managed Gateway Start, Stop, Restart, Update, background sync, and `start_if_needed` through the same physical-target lifecycle coordinator used for Env Runtime placement. Gateway retains its own service commands and does not enter Runtime Process Inventory, but lifecycle ownership is shared: identical starts coalesce, incompatible actions fail with the active operation key, and automatic ensure waits for Start, Restart, or Update while refusing to run through Stop. Gateway launcher progress uses the physical service target id for every lifecycle action rather than parallel action-suffixed keys. Bridge attachment has a separate same-target coalescing task because it is an attachment resource, not lifecycle authority.

For URL environment profiles, each open-session creates an isolated local-direct listener and returns a signed artifact URL rooted at a random profile access path on that listener. The main Gateway protocol host does not proxy profile traffic, and open-session does not install browser cookies. Requests must either use the random artifact path or prove a same-origin navigation chain from it, so probing the listener port without the artifact URL cannot reach the target. The listener lifetime is capped by the signed artifact expiry and it is also closed on profile update/delete or Gateway server shutdown. Target-site cookies are captured in a per-open-session server-side cookie jar, browser-supplied cookies and authorization headers are stripped before proxying, target `Set-Cookie` and service-worker scope headers are removed from browser responses.

# Boundaries

Gateway state, pairing, profile write enablement, private-profile-target allowance, and URL profile session listener lifecycle are Gateway service concerns. Runtime Service compatibility stays separate unless the runtime snapshot contract itself changes.

OpenAPI is intentionally limited to the Gateway HTTP JSON wire contract. It does not define the Desktop bridge stdio frame protocol, Env App proxy routes, Runtime Service compatibility windows, or a full state-machine DSL. Gateway semantics such as nonce lifetime, trust profile pinning, stale catalog invalidation after protocol failure, and managed-versus-external recovery actions are enforced by Go/TypeScript tests and documented in OKF rather than encoded as a new custom protocol language.

Gateway should not depend on the Flowersec DSL for this API contract. Flowersec remains a transport/session dependency boundary, while Gateway's control API is a small HTTP surface with explicit OpenAPI schemas and focused contract tests.

Gateway does not host plugin management APIs. The `/gateway/v1/*` protocol remains a standalone Gateway service surface for pairing, environment catalog, open-session artifacts, profile management, and environment lifecycle requests. Future plugin install, enable, surface bootstrap, asset, RPC, diagnostics, export/import, update, or uninstall routes belong to Local UI/AppServer-mounted ReDevPlugin handlers or thin wrappers, not to `redeven-gateway`. Gateway bridge tokens and open-session artifacts must not be reused as plugin grants or plugin capability credentials.

# Evidence

- `redeven:cmd/redeven-gateway/main.go:83` - `serve` accepts state root, listen address, private target, profile write, and pairing flags.
- `redeven:.github/workflows/release.yml:51` - Release validates the Gateway protocol contract before packaging.
- `redeven:internal/runtimeservice/compatibility_contract.json:32` - The current compatibility review records Gateway lifecycle as unchanged by the Runtime Service compatibility window.
- `redeven:spec/openapi/gateway-v1.yaml:1` - The Gateway OpenAPI contract declares OpenAPI 3.1.
- `redeven:internal/runtimegateway/protocol/openapi_contract_test.go:73` - The contract test rejects the old runtime-gateway protocol name.
- `redeven:internal/gatewayservice/server.go:643` - URL profile open-session creates an isolated profile session listener.
- `redeven:scripts/check_gateway_protocol_contract.sh:9` - The standalone contract check runs the Gateway OpenAPI and naming-boundary tests.
- `redeven:desktop/src/main/gatewayLifecycleManager.ts:336` - Gateway automatic ensure waits for ready-producing lifecycle work and rejects active Stop.
- `redeven:desktop/src/main/main.ts:6304` - Gateway foreground lifecycle progress uses the physical target id as its operation key.
