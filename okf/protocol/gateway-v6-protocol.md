---
type: Protocol Contract
title: Gateway v6 protocol
description: Define signed pairing, member invitations, policy, reverse access and versioned Cloud association.
tags: [gateway, protocol, security, identity]
timestamp: 2026-10-10T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

`redeven-gateway-v6` is the only served Gateway membership protocol. Its machine-readable authority is `spec/openapi/gateway-v6.yaml`. A signed invitation-code delivery carries administrator-confirmed share addresses. The authenticated exchange returns the signed internal enrollment descriptor with all confirmed Runtime connection endpoints. Gateway owns paired Desktop permissions and Runtime-initiated membership. Protocol mismatch fails explicitly; old URL-profile routes and HTTP forwarding are absent. Old Gateway configuration is rejected read-only; it is never silently rewritten. Gateway Cloud v3 is a separate, shared business contract referring to these same members.

# Contract

## Wire authority
The signed Desktop surface includes pairing, identity proof, catalog, invitation, member removal, member and default policy, reevaluation, member access offer and service description, and Cloud configuration/status.

A Runtime mTLS certificate must be current for that exact member and version.

Service descriptions are signed separately and bind the Runtime's TLS application identity.

## Version and persistence
Member version controls removal and replacement. Directory and policy revisions prevent stale messages from restoring permissions.

[Gateway Cloud access](../gateway/gateway-cloud-access.md) owns publication, recovery and revocation.

# Boundaries

The OpenAPI document and signed DTOs are the protocol authority. Unknown routes, stale generations, and legacy URL-profile requests remain rejected rather than silently translated.

# Evidence

- `redeven:spec/openapi/gateway-v6.yaml` — Closed OpenAPI surface.

- `redeven:internal/runtimegateway/protocol/protocol.go` — Signed management DTOs.

- `redeven:internal/runtimegateway/protocol/membership.go` — Member identity, policy and application contracts.
