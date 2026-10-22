---
type: Desktop Contract
title: Verified Environment access routes
description: Associate Gateway routes with a known Runtime without combining Cloud ownership, management rights or login sessions.
tags: [desktop, gateway, runtime, identity, access]
timestamp: 2026-10-10T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Desktop owns display association and default access selection. A Gateway member route
joins an existing Runtime card only after the main process matches its member ID,
Runtime public ID and paired Gateway key against the trusted Runtime management
snapshot. Public health observations remain independently verified. Names, URLs,
catalog availability and renderer claims never establish this relationship.
Existing Local / Redeven Cloud binding and ownership remain independent.
An unverified or changed route stays separate; a missing saved default requires
an explicit replacement. Association grants no login or management authority.

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
Members are discovered from the signed v5 directory and matched to trusted Runtime membership summaries.

Existing Cloud-only Runtime configurations must rejoin and cannot silently gain the new member delegation. [Gateway Cloud access](../gateway/gateway-cloud-access.md) owns proof-based preservation of a formal environment ID.

# Boundaries

This contract owns display association and route selection. Proof observation never upgrades those permissions.

[Gateway Desktop interactions](../gateway/gateway-desktop-interactions.md) owns the explicit environment connection, invitation and confirmation steps and the independent management, invitation and local consent boundaries; recovery reuses the original Runtime lifecycle owner.

# Evidence

- `redeven:internal/runtimeidentity/access_identity.go` - State identity, exclusive initialization and nonce proof.

- `redeven:internal/localui/access_identity_test.go` - Public/private identity agreement and independent Runtime authentication.

- `redeven:spec/openapi/gateway-v6.yaml` - Signed membership and service identity schemas.
