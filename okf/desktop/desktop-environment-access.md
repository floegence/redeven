---
type: Desktop Contract
title: Verified Environment access routes
tags: [desktop, gateway, runtime, identity, access]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Desktop associates Gateway routes only after matching member ID, Runtime public ID and paired Gateway key against trusted management facts. Health is independently verified; names/URLs/catalogs/renderer claims grant no association. Local/Cloud ownership remains separate. Changed/unverified routes stay separate; missing default requires explicit replacement, never login/management authority.

# Contract

## Runtime state identity
Each Runtime state directory owns an immutable Ed25519 seed in `access-identity.key`. Invalid or symlinked existing material fails closed and is never replaced.

Existing TLS, Gateway trust and Runtime authentication remain authoritative.

## Observation and grouping
Main-process observations bind an entry ID to its configured connection and verified identity.

Runtime membership summaries use the Gateway pairing fingerprint: SHA-256 of the canonical, trimmed Ed25519 SubjectPublicKeyInfo PEM, encoded as unpadded base64url with `SHA256:`.

Existing registrations, Gateway member and Cloud binding authority remain in their respective stores.

## Explicit default and one-time opening
The existing main Open button uses the saved default. Implicit defaults use stable registration / first-observation order, never probe completion order or a newly rebuilt Gateway catalog timestamp.

[Gateway access sessions](../gateway/gateway-access-sessions.md) owns transport isolation and same-route session reuse.

## Membership discovery and migration
Members are discovered from the signed v6 directory and matched to trusted Runtime membership summaries.

Existing Cloud-only Runtime configurations must rejoin and cannot silently gain the new member delegation. [Gateway Cloud access](../gateway/gateway-cloud-access.md) owns proof-based preservation of a formal environment ID.

# Boundaries

Desktop shares host-neutral environment contracts, projection/controller and Gateway list UI with [Web Center](../architecture/web-environment-center.md). Existing lifecycle/window owners and user interactions remain authoritative; no Center login/service dependency is introduced.

This contract owns display association and route selection. Proof observation never upgrades those permissions.

[Gateway Desktop interactions](../gateway/gateway-desktop-interactions.md) owns the explicit environment connection, invitation and confirmation steps and the independent management, invitation and local consent boundaries; recovery reuses the original Runtime lifecycle owner.

# Evidence

- `redeven:internal/runtimeidentity/access_identity.go` - State identity, exclusive initialization and nonce proof.

- `redeven:internal/localui/access_identity_test.go` - Public/private identity agreement and independent Runtime authentication.
