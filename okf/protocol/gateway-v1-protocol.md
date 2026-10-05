---
type: Protocol Contract
title: Gateway v3 protocol
description: Signed Gateway HTTP JSON contract for pairing, catalog, open-session, and access forwarding.
tags: [gateway, protocol, desktop, openapi, access]
timestamp: 2026-10-02T00:00:00Z
---
# Summary

`redeven-gateway-v3` is the signed access-plane protocol defined by `spec/openapi/gateway-v3.yaml`. It supports pairing, Gateway identity and capabilities, Environment profile/catalog operations, open-session, close-session, and fixed-endpoint proxy access. It exposes no Runtime lifecycle operation, supervisor, checkpoint, recovery, or Provider management route. Unsupported or removed paths return the normal HTTP not-found response and never fall back to another lifecycle owner.

# Contract

## Wire surface

The protocol contains these route groups:

- pairing challenge and completion;
- Gateway capability and catalog reads;
- Environment profile check, upsert and delete;
- open-session artifact issuance;
- owner-authenticated, idempotent close-session revocation;
- authenticated access forwarding used by the issued session.

Signed requests bind the protocol, HTTP method, route, body digest, Gateway identity, binding audience, nonce, and timestamp. Pairing credentials authorize only the declared Gateway access operations. There is no Runtime management grant or implicit process authority in a paired client.

The wire Gateway ID is the stable hash of the current binding audience, as
defined by Gateway security. Desktop's persisted registration ID is a local
reference and remains stable when its URL, host, container or data root is
edited. Pairing challenges, catalog identity, signed request headers and artifact
proofs all use the same audience-derived wire identity. Changing coordinates
invalidates old trust; it never relaxes fingerprint or signature verification.
The local trust record remains attached to the registration and separately pins
the audience and Gateway key. No extra persisted wire-ID projection is needed.

Pairing completion uses one normalized request for validation, capability policy,
and signature verification. A disabled profile-write policy rejects that grant
before any trust update, including equivalent whitespace-padded inputs.

Catalog entries describe how an Environment can be accessed. Access capabilities do not imply Start, Stop, Restart, Update, or Reinstall. Open-session creates a short-lived, scoped access artifact for an explicit profile and route; it does not inspect or mutate Runtime installation state.

Gateway capabilities are `env_catalog`, `env_direct_open`, `env_proxy_open`, and
independently granted `env_profile_write`. URL environments publish
`open_direct` and `open_via_gateway`. The internal aggregate `open` field is not
an opening decision. `access_mode` explicitly selects `direct_url` or
`gateway_proxy`. [Gateway access sessions](../gateway/gateway-access-sessions.md)
owns transport, Cookie, authentication, expiry, and migration behavior.

Direct artifacts carry the target URL. URL proxy artifacts carry a fixed
Gateway access URL and session ID. Managed bridge proxy artifacts bind that
same access path to the current bridge ID and route ID. Every artifact proof
binds kind, URL/path, Gateway, Environment, session, capability, nonce and expiry.

The OpenAPI document is the machine-readable authority. Typed Go protocol structures must remain closed to Runtime lifecycle fields, and structural tests must fail when a Runtime or lifecycle route is introduced.

## Unsaved URL verification

`POST /gateway/v3/env-profiles/check` requires the same independent profile-write
grant as profile mutation. It checks target health with the existing target and
DNS policy, forwards a fresh identity challenge, and returns optional Runtime
proof without publishing a profile or creating a session. It never forwards
credentials or follows redirects; target failure returns `TARGET_UNAVAILABLE`.
[Verified Environment access routes](../desktop/desktop-environment-access.md)
owns the proof and Desktop display-association boundary.

## Compatibility

Gateway protocol compatibility is independent from Runtime package identity. Gateway and Runtime may be released separately because this protocol does not coordinate Runtime upgrades. A client encountering a removed lifecycle path receives not found and must use a Desktop direct management channel, if one is registered; it must not retry through Provider or infer an access endpoint as a management channel.

The unpublished v2 wire protocol has no compatibility handler. Desktop and
Gateway use v3 together and display protocol mismatch for older endpoints.
Existing configuration and trust remain supported migration inputs; dropping
wire compatibility does not permit deleting local user state.

# Boundaries

Desktop bridge IPC, Runtime Service APIs, Provider RCPP APIs, package manifests, and direct SSH/container execution are separate contracts. Gateway v3 authenticates and forwards access only. Runtime lifecycle progress is represented by Desktop Launcher Operations and never appears in Gateway protocol state.

# Evidence

- `redeven:spec/openapi/gateway-v3.yaml:1` - Canonical access-only OpenAPI contract.
- `redeven:internal/runtimegateway/protocol/protocol.go:1` - Typed Gateway access DTOs.
- `redeven:internal/runtimegateway/protocol/openapi_contract_test.go:1` - Rejects Runtime and lifecycle paths in the OpenAPI surface.
- `redeven:internal/gatewayservice/server.go:1` - Signed request validation and access route registration.
- `redeven:desktop/src/main/gatewayClient.ts:1` - Desktop Gateway access client.
