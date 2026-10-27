---
type: Protocol Contract
title: Gateway v6 protocol
description: Define signed pairing, member invitations, policy, reverse access and versioned Cloud association.
tags: [gateway, protocol, security, identity]
timestamp: 2026-10-10T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-26"
---
# Summary

Gateway serves only redeven-gateway-v6, defined by spec/openapi/gateway-v6.yaml. Signed invitations carry admin-confirmed addresses; authenticated exchange returns the signed descriptor/all endpoints. Gateway owns paired Desktop permissions and Runtime-initiated membership. Mismatch/old config fails unchanged; old URL-profile/HTTP-forward routes are absent. Cloud v3 remains separate.

# Contract

## Wire authority
The signed Desktop surface includes pairing, identity proof, catalog, invitation, member removal, member and default policy, reevaluation, member access offer and service description, and Cloud configuration/status.

A Runtime mTLS certificate must be current for that exact member and version.

Service descriptions are signed separately and bind the Runtime's TLS application identity.

## Compatibility ownership

`protocol.Version` and `protocol.CompatibilityEpoch` own Gateway wire and host-authority admission. Desktop mirrors these in `gatewayMembership.ts`; Runtime Service compatibility changes do not change either. Preserve the deployed signed `compatibility_epoch` value 69 independently of Runtime release cadence. It remains covered by identity and pairing signatures. Different binary releases/commits are allowed within this contract; incompatible wire or authority contracts still fail explicitly. Runtime member version metadata is descriptive, not a software-version admission condition.

## Version and persistence
Member version controls removal and replacement. Directory and policy revisions prevent stale messages from restoring permissions.

[Gateway Cloud access](../gateway/gateway-cloud-access.md) owns publication, recovery and revocation.

# Boundaries

The OpenAPI document and signed DTOs are the protocol authority. Unknown routes, stale generations, and legacy URL-profile requests remain rejected rather than silently translated.

# Evidence

- `redeven:spec/openapi/gateway-v6.yaml` — Closed OpenAPI surface.

- `redeven:internal/runtimegateway/protocol/membership.go` — Member identity, policy and application contracts.
