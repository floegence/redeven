---
type: Desktop Contract
title: Verified Environment access routes
tags: [desktop, gateway, runtime, identity, access]
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

Desktop associates Gateway routes only through trusted attachment ID, Runtime public ID and Gateway-key matches; health is independent. Names/URLs/renderer claims grant nothing. Local/Cloud ownership stays separate; missing/unverified routes require explicit replacement.

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

Runtime attachment requires local consent and never adds Cloud enrollment delegation. Existing unsupported state is rejected unchanged. Optional Cloud binding and explicit transport route remain independent.

# Boundaries

Desktop shares host-neutral environment contracts, projection/controller and Gateway list UI with [Web Center](../architecture/web-environment-center.md). Existing lifecycle/window owners and user interactions remain authoritative; no Center login/service dependency is introduced.

This contract owns display association and route selection. Proof observation never upgrades those permissions.

[Gateway Desktop interactions](../gateway/gateway-desktop-interactions.md) owns the explicit environment connection, invitation and confirmation steps and the independent management, invitation and local consent boundaries; recovery reuses the original Runtime lifecycle owner.

# Evidence

- `redeven:internal/runtimeidentity/access_identity.go` - Source.
- `redeven:internal/localui/access_identity_test.go` - Tests.
