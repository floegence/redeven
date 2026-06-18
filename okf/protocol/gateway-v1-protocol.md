---
type: Protocol Contract
title: Gateway v1 protocol
description: Gateway v1 uses OpenAPI as the machine-readable HTTP JSON wire contract for /gateway/v1/*.
tags: [gateway, protocol, desktop, openapi]
timestamp: 2026-06-18T00:00:00Z
---

Gateway v1 is the `redeven-gateway-v1` HTTP JSON protocol used by Desktop and `redeven-gateway` for pairing, catalog reads, open-session artifacts, Gateway-owned profile writes, and lifecycle requests. Its machine-readable source contract is `spec/openapi/gateway-v1.yaml`.

# Mechanism

The OpenAPI document defines seven `POST /gateway/v1/*` endpoints, one success envelope shape, one error envelope shape, the protocol version const, signed Gateway auth headers, the managed bridge token security boundary for profile writes, `Set-Cookie` as an HTTP response header for local-direct open-session artifacts, `GatewayConnectArtifact` variants, and the conditional profile access route variants.

The OpenAPI contract is kept consistent with code by a focused Go contract test. The test parses YAML structurally, compares `info.version` with `internal/runtimegateway/protocol.Version` and the Desktop `GATEWAY_PROTOCOL_VERSION`, compares OpenAPI paths against Go server registrations and Desktop routes, verifies security requirements, checks required fields and enums, confirms closed object schemas, validates profile route variants, and rejects old `redeven-runtime-gateway-v1` residue or Runtime Service compatibility fields.

Gateway v1 does not expose `ssh_secret` in OpenAPI and accepts only key-agent SSH profile auth. Incoming `ssh_secret`, SSH password auth, unknown `client_capability`, and access-route fields outside the selected route variant are rejected by executable protocol and service validation instead of being ignored or treated as compatibility fallbacks.

Desktop treats Gateway protocol mismatch as a Gateway protocol failure, not as trust repair, pairing, reachability, or Runtime Service compatibility. Managed Gateway mismatches can recommend updating the managed Gateway package; URL/access-only Gateway mismatches remain facts-only and must not promise that Desktop can update a remote host. Protocol mismatch also invalidates cached Gateway catalog environments and capabilities so stale catalog entries cannot be opened after a failed protocol check.

# Boundaries

OpenAPI is sufficient for the Gateway HTTP wire contract, but it is not used as a complete workflow DSL. Nonce lifetime, proof verification, trust profile persistence, stale catalog invalidation, recovery action selection, and debug redaction remain executable Go/TypeScript behavior with tests.

No new custom Gateway protocol specification language is introduced. Flowersec DSL is also not used for this API contract because the Gateway API is a compact HTTP control surface, while Flowersec remains in the transport/session dependency boundary.

The contract excludes Desktop bridge stdio hello/frame schemas, Env App proxy routes, direct proxy surfaces, Runtime Service compatibility windows, release installer metadata, and human Markdown protocol descriptions that are not active source contracts.

# Citations

[1] redeven:spec/openapi/gateway-v1.yaml:1 - The OpenAPI document declares version 3.1.
[2] redeven:spec/openapi/gateway-v1.yaml:24 - `info.version` is `redeven-gateway-v1`.
[3] redeven:spec/openapi/gateway-v1.yaml:38 - The path set starts with `/gateway/v1/pairing/challenge`.
[4] redeven:spec/openapi/gateway-v1.yaml:239 - Gateway auth headers are declared as OpenAPI security schemes.
[5] redeven:spec/openapi/gateway-v1.yaml:286 - The protocol version schema is a string const.
[6] redeven:spec/openapi/gateway-v1.yaml:751 - Profile access routes are closed `oneOf` variants.
[7] redeven:spec/openapi/gateway-v1.yaml:789 - SSH profile auth mode is limited to key-agent auth.
[8] redeven:internal/runtimegateway/protocol/openapi_contract_test.go:69 - The focused contract test parses and validates the OpenAPI file.
[9] redeven:internal/runtimegateway/protocol/openapi_contract_test.go:173 - Desktop protocol literals are checked against the Go protocol version.
[10] redeven:internal/runtimegateway/protocol/openapi_contract_test.go:197 - OpenAPI paths are compared with Go server routes and Desktop routes.
[11] redeven:internal/runtimegateway/protocol/openapi_contract_test.go:445 - The contract test keeps `ssh_secret` out of Gateway v1 OpenAPI.
[12] redeven:internal/runtimegateway/protocol/openapi_contract_test.go:483 - The contract test checks the profile access route schema variants.
[13] redeven:desktop/src/main/main.ts:3808 - Gateway sync errors build a source record from the current error and previous catalog state.
[14] redeven:desktop/src/main/main.ts:3855 - Protocol mismatch invalidates cached Gateway catalog data.
