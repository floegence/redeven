---
type: Protocol Contract
title: Gateway v4 protocol
description: Define signed pairing, member invitations, policy, reverse access and versioned Cloud association.
tags: [gateway, protocol, security, identity]
timestamp: 2026-10-07T00:00:00Z
---
# Summary

`redeven-gateway-v4` is the only served Gateway protocol. Its machine-readable authority is `spec/openapi/gateway-v4.yaml`. Gateway owns paired Desktop permissions and Runtime-initiated membership. Protocol mismatch fails explicitly; old URL-profile routes and HTTP forwarding are absent. Gateway Cloud v2 is a separate, shared business contract referring to these same members.

# Contract

## Wire authority

The signed Desktop surface includes pairing, identity proof, catalog, invitation, member removal, member and default policy, reevaluation, member access offer and service description, and Cloud configuration/status. Signed requests bind method, route, body digest, protocol, Gateway identity, audience, nonce and time. Access, member management and Cloud configuration are independent grants.

The member TLS endpoint serves invitation redemption, rotation, cancellation, leaving, member connection admission, Cloud context and the closure-only relay. A Runtime mTLS certificate must be current for that exact member and version. Admission artifacts are one-use. Reverse streams target only the fixed Runtime application; no Runtime address or arbitrary dial request exists in the protocol.

Gateway ID derives from the persisted machine key, not a URL audience. Address changes prove the original key before changing trust coordinates. Member delegation binds Runtime, Gateway, member and explicit access/publication consent. Service descriptions are signed separately and bind the Runtime's TLS application identity.

## Version and persistence

Member version controls removal and replacement. Cloud binding generation controls publication and recovery. Network connection generation only distinguishes live observations. Directory and policy revisions prevent stale messages from restoring permissions. None of these versions substitutes for another.

Gateway Cloud v2 DTOs are maintained in Portal shared contracts and mirrored with common fixtures in Runtime. The legacy wire protocol is not served during migration. Historical local readers only remove old execution state and preserve explicitly permitted migration evidence. Runtime Service epoch 41 identifies the matching Runtime management contract.

[Gateway service](../gateway/gateway-service.md) owns membership and policy. [Gateway access sessions](../gateway/gateway-access-sessions.md) owns stream and TLS behavior. [Gateway Cloud access](../gateway/gateway-cloud-access.md) owns publication, recovery and revocation.

# Boundaries

The OpenAPI document and signed DTOs are the protocol authority. This concept defines wire compatibility and version fencing; implementation concepts own membership, stream handling, and Cloud behavior. Unknown routes, stale generations, and legacy URL-profile requests remain rejected rather than silently translated.

# Evidence

- `redeven:spec/openapi/gateway-v4.yaml` — Closed OpenAPI surface.
- `redeven:internal/runtimegateway/protocol/protocol.go` — Signed management DTOs.
- `redeven:internal/runtimegateway/protocol/membership.go` — Member identity, policy and application contracts.
- `redeven:internal/runtimegateway/protocol/openapi_contract_test.go` — Router and schema conformance.
- `redeven:internal/gatewaycloud/protocol/wire_test.go` — Cloud fixture parity.
