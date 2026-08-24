---
type: Protocol Contract
title: Gateway v2 protocol
description: Signed Gateway HTTP JSON contract for pairing, catalog, open-session, and access forwarding.
tags: [gateway, protocol, desktop, openapi, access]
timestamp: 2026-08-24T00:00:00Z
---
# Summary

`redeven-gateway-v2` is the signed access-plane protocol defined by `spec/openapi/gateway-v2.yaml`. It supports pairing, Gateway identity and capabilities, Environment profile/catalog operations, and open-session. It exposes no Runtime lifecycle operation, artifact, supervisor, checkpoint, recovery, or Provider management route. Unsupported or removed paths return the normal HTTP not-found response and never fall back to another lifecycle owner.

# Contract

## Wire surface

The protocol contains these route groups:

- pairing challenge and completion;
- Gateway capability and catalog reads;
- Environment profile upsert and delete;
- open-session artifact issuance;
- authenticated access forwarding used by the issued session.

Signed requests bind the protocol, HTTP method, route, body digest, Gateway identity, binding audience, nonce, and timestamp. Pairing credentials authorize only the declared Gateway access operations. There is no Runtime management grant or implicit process authority in a paired client.

Catalog entries describe how an Environment can be accessed. Access capabilities do not imply Start, Stop, Restart, Update, or Reinstall. Open-session creates a short-lived, scoped access artifact for an explicit profile and route; it does not inspect or mutate Runtime installation state.

The OpenAPI document is the machine-readable authority. Typed Go protocol structures must remain closed to Runtime lifecycle fields, and structural tests must fail when a Runtime or lifecycle route is introduced.

## Compatibility

Gateway protocol compatibility is independent from Runtime package identity. Gateway and Runtime may be released separately because this protocol does not coordinate Runtime upgrades. A client encountering a removed lifecycle path receives not found and must use a Desktop direct management channel, if one is registered; it must not retry through Provider or infer an access endpoint as a management channel.

# Boundaries

Desktop bridge IPC, Runtime Service APIs, Provider RCPP APIs, package manifests, and direct SSH/container execution are separate contracts. Gateway v2 authenticates and forwards access only. Runtime lifecycle progress is represented by Desktop Launcher Operations and never appears in Gateway protocol state.

# Evidence

- `redeven:spec/openapi/gateway-v2.yaml:1` - Canonical access-only OpenAPI contract.
- `redeven:internal/runtimegateway/protocol/protocol.go:1` - Typed Gateway access DTOs.
- `redeven:internal/runtimegateway/protocol/openapi_contract_test.go:1` - Rejects Runtime and lifecycle paths in the OpenAPI surface.
- `redeven:internal/gatewayservice/server.go:1` - Signed request validation and access route registration.
- `redeven:desktop/src/main/gatewayClient.ts:1` - Desktop Gateway access client.
