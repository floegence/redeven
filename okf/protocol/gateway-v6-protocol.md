---
type: Gateway Contract
title: Gateway v6 independent device protocol
tags: [gateway, protocol, identity]
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

Gateway v6, authority epoch 70, defines independent client-device trust and Runtime attachments. The public protocol and private host API are separate surfaces on the same service, with independently verified device access and host authority. Cloud machine management and publication are absent.

# Contract

## Identities and wire fields
The stable gateway_id is independent of Desktop connection_id. RuntimeAttachment uses attachment_id and attachment_version. Catalogs contain attachments; Gateway metadata contains endpoints and tls_root_pem shared by clients and Runtimes. Device identities are not user memberships. Internal package/file names do not add a Cloud or user authority.

Client public routes are pairing/challenge, pairing/complete, identity, catalog, access/open and access/service under /gateway/v6. Runtime-owned routes use /v6/attachment for invitation-exchange, join, cancel-join, update-endpoints, rotate, leave and connect. Current attachment certificate/version and signed Runtime service identity are required.

Host-only routes issue invitations/client codes, list/revoke devices, update addresses/network/egress policy, remove or reevaluate attachments and query operation results. They are not registered on the public listener. ManageAttachments and ManageNetwork are request capabilities from verified host context, never device roles. Host proof grants both together; network settings, shared endpoint edits and attachment egress reevaluation consistently check ManageNetwork. Client trust administration requires current private host proof. OpenAPI declares each route surface explicitly. This alignment changes no route or signed payload, so protocol v6, epoch 70 and attachment schema 6 remain unchanged. Trust schema 4 retires historical host classification without replacing identities. Private host authentication is independent of device access; supplied signatures must still verify and address proofs retain their requested binding audience.

## Freshness and state
Runtime metadata versions do not gate attachment admission. Wire/authority mismatches fail explicitly; no old protocol translator or Cloud fallback is installed. Schema 6 attachment state rejects unsupported input unchanged. Expected attachment and policy versions fence relevant mutations; operation IDs recover known results and preserve uncertainty.

# Boundaries

[Device trust and operations](../gateway/gateway-client-access.md) owns credential bootstrap and private result recovery. [Optional Runtime Cloud egress](../gateway/gateway-cloud-access.md) owns network policy and route isolation.

# Evidence

- redeven:spec/openapi/gateway-v6.yaml — Current route and DTO inventory.
- redeven:internal/runtimegateway/protocol/openapi_contract_test.go — Go, Desktop and OpenAPI authority/field alignment.
- redeven:internal/runtimegateway/protocol/membership.go — RuntimeAttachment and local egress policy.
