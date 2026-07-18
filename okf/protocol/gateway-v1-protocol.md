---
type: Protocol Contract
title: Gateway v1 protocol
description: Gateway v1 uses OpenAPI as the machine-readable HTTP JSON wire contract for /gateway/v1/*.
tags: [gateway, protocol, desktop, openapi]
timestamp: 2026-06-18T00:00:00Z
---
# Summary

Gateway v1 is the `redeven-gateway-v1` HTTP JSON protocol used by Desktop and `redeven-gateway` for pairing, catalog reads, open-session artifacts, Gateway-owned profile writes, and lifecycle requests. Its machine-readable source contract is `spec/openapi/gateway-v1.yaml`.

# Contract

## Mechanism

The OpenAPI document defines seven `POST /gateway/v1/*` endpoints, one success envelope shape, one error envelope shape, the protocol version const, signed Gateway auth headers, the managed bridge token security boundary for profile writes, `GatewayConnectArtifact` variants, and the conditional profile access route variants. Open-session responses do not declare or depend on browser `Set-Cookie`; local-direct profile sessions are represented by a signed artifact URL whose listener port and random access path are session-specific service state, not a protocol cookie.

The OpenAPI contract is kept consistent with code by a focused Go contract test. The test parses YAML structurally, compares `info.version` with `internal/runtimegateway/protocol.Version` and the Desktop `GATEWAY_PROTOCOL_VERSION`, compares OpenAPI paths against Go server registrations and Desktop routes, verifies security requirements, checks required fields and enums, confirms closed object schemas, validates profile route variants, and rejects old `redeven-runtime-gateway-v1` residue or Runtime Service compatibility fields.

Gateway v1 does not expose `ssh_secret` in OpenAPI and accepts only key-agent SSH profile auth. Incoming `ssh_secret`, SSH password auth, unknown `client_capability`, and access-route fields outside the selected route variant are rejected by executable protocol and service validation instead of being ignored or treated as compatibility fallbacks.

Desktop treats Gateway protocol mismatch as a Gateway protocol failure, not as trust repair, pairing, reachability, or Runtime Service compatibility. Managed Gateway mismatches can recommend updating the managed Gateway package; URL/access-only Gateway mismatches remain facts-only and must not promise that Desktop can update a remote host. Protocol mismatch also invalidates cached Gateway catalog environments and capabilities so stale catalog entries cannot be opened after a failed protocol check.

# Boundaries

OpenAPI is sufficient for the Gateway HTTP wire contract, but it is not used as a complete workflow DSL. Nonce lifetime, proof verification, trust profile persistence, isolated local-direct listener lifecycle, artifact-path request gating, stale catalog invalidation, recovery action selection, and debug redaction remain executable Go/TypeScript behavior with tests.

No new custom Gateway protocol specification language is introduced. Flowersec DSL is also not used for this API contract because the Gateway API is a compact HTTP control surface, while Flowersec remains in the transport/session dependency boundary.

The contract excludes Desktop bridge stdio hello/frame schemas, Env App proxy routes, direct proxy surfaces, Runtime Service compatibility windows, release installer metadata, and human Markdown protocol descriptions that are not active source contracts.

# Evidence

- `redeven:spec/openapi/gateway-v1.yaml:1` - The OpenAPI document declares version 3.1.
- `redeven:internal/runtimegateway/protocol/openapi_contract_test.go:69` - The focused contract test parses and validates the OpenAPI file.
- `redeven:desktop/src/main/main.ts:3808` - Gateway sync errors build a source record from the current error and previous catalog state.
