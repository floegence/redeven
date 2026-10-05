---
type: Desktop Contract
title: Verified Environment access routes
description: Associate Gateway routes with a known Runtime without combining Cloud ownership, management rights or login sessions.
tags: [desktop, gateway, runtime, identity, access]
timestamp: 2026-10-05T00:00:00Z
---
# Summary

Desktop owns display association and default access selection. A Gateway profile
joins an existing Runtime card only after the main process verifies possession
of the same Runtime state identity over the selected transport. Names, URLs,
catalog availability and renderer claims never establish this relationship.
Existing Local / Redeven Cloud binding and ownership remain independent.
An unverified or changed route stays separate; a missing saved default requires
an explicit replacement. Association grants no login or management authority.

# Contract

## Runtime state identity

Each Runtime state directory owns an immutable Ed25519 seed in
`access-identity.key`. Startup creates a complete, private temporary file and
publishes it exclusively; concurrent initializers read the winner. Invalid or
symlinked existing material fails closed and is never replaced. A Runtime
restart, update, display-name change or URL change preserves this identity.
Copying the entire state directory copies the identity: this is installation
state identity, not physical-host identity or an operator certificate.

Public Local UI health and the private Desktop bridge use the same health
handler. An optional `X-Redeven-Runtime-Identity-Challenge` contains a canonical,
unpadded base64url 32-byte random nonce. The uncached health response returns
`access_identity` with version `redeven-runtime-access-v1`, challenge, raw
Ed25519 public key and signature of UTF-8 `version + LF + challenge`. The
endpoint grants no Cookie, unlock, MFA bypass or management capability.

Desktop verifies the version, exact outstanding challenge, canonical lengths
and signature before deriving `runtime:<sha256(public key)>`. It never accepts
identity from startup JSON, a catalog field or the renderer. This is a
possession proof over the selected, already trusted transport. It does not
protect against a malicious trusted Gateway relaying a challenge to a different
Runtime and is never used for authorization. Existing TLS, Gateway trust and
Runtime authentication remain authoritative.

## Observation and grouping

Main-process observations bind an entry ID to its configured connection and
verified identity. Gateway bindings include Gateway and profile IDs, endpoint,
Gateway key fingerprint, and target route; direct bindings include the saved
connection owner. Display labels and transient health do not invalidate a
binding. Editing coordinates or changing trust invalidates it immediately.
An asynchronous probe commits only while its configured binding still matches.
A later valid proof for another identity separates the route. Reachability is
not inferred from a retained identity observation.

Gateway access members attach to the chosen original Runtime card, preferring
an owner already linked to Cloud. Original registrations, lifecycle owners and
Cloud perspectives remain intact. Independently registered direct management
owners keep their cards and settings. Gateway members extend the existing split
menu and connection settings; they never add owner tabs or a new card row.
Without a verified counterpart, the Gateway entry retains its own card.
[Environment library](desktop-environment-library.md) owns Local / Cloud exact
binding, card layout, search and perspective selection.

Desktop preferences version 15 adds optional versioned observations and route
defaults. Missing access state preserves existing behavior. Malformed access
state is rejected with the original file preserved. Existing registrations,
Gateway profiles and Cloud bindings remain in their current stores.

## Explicit default and one-time opening

The existing main Open button uses the saved default. The menu exposes explicit
route choices, marks the default, and applies another choice only to that open.
Connection settings commit a new default only on Save; closing the dialog drops
its unsaved selection. Adding a verified route preserves an established default. Implicit defaults use
stable registration / first-observation order, never probe completion order or
a newly rebuilt Gateway catalog timestamp.
New Gateway profiles use proxy access; existing direct-mode profiles retain
their setting. Desktop's explicit default is local to this Desktop and does not
rewrite shared Gateway profile access modes.

A Gateway environment row always opens through its own Gateway. Its catalog
capabilities govern availability. Direct URL remains an explicit option in the
environment access menu where advertised, including retained direct profiles.
Failures never trigger another route, start Runtime, or change Cloud selection.
Missing or detached default routes disable the default Open action while
allowing explicit choices and connection settings.

Deleting the default registration while alternatives remain requires an explicit
replacement. Desktop saves that choice only after deletion succeeds. Removing
an entire Gateway is blocked until affected environments choose replacement
defaults in their connection settings. Profile deletion and session revocation
retain their existing owner scope. Changing the default neither closes nor
shares existing sessions. [Gateway access sessions](../gateway/gateway-access-sessions.md)
owns transport isolation and same-route session reuse.

## Gateway draft verification

The contextual profile dialog stays over its Gateway page. It fixes the Gateway
identity and asks for a Runtime URL reachable from that Gateway. It has no
Direct / Proxy choice. Verify connection calls the signed v3
`env-profiles/check` endpoint with a fresh nonce. Independent profile-write
permission and the Gateway enable-profile-write policy are required on both URL
and managed bridge transports.

The Gateway uses its existing HTTP/HTTPS target policy, DNS checks and TLS
validation to request health. It forwards no credentials, follows no redirects,
bounds response size and time, publishes no profile and creates no access
session. The Desktop verifies the returned proof and reports whether it matches
a known environment. Reachable targets without proof remain separate.

New or changed targets require verification before Save. Saving performs a fresh
check, preventing a stale preview from establishing an association. Label-only
edits retain existing access mode and do not require target availability.
Changing the target invalidates the visible preview. Failure retains the draft;
a stopped Gateway offers the existing explicit Start-and-retry continuation.
A late result cannot reopen or modify another dialog. Local default selection
remains available even without permission to edit the shared Gateway profile.

# Boundaries

This contract owns display association and route selection. Runtime health,
Runtime login, direct management, Gateway trust and Cloud ownership retain their
existing authorities. Proof observation never upgrades those permissions.

# Evidence

- `redeven:internal/runtimeidentity/access_identity.go` - State identity, exclusive initialization and nonce proof.
- `redeven:internal/localui/access_identity_test.go` - Public/private identity agreement and independent Runtime authentication.
- `redeven:internal/gatewayservice/profile_check.go` - Authorized, bounded target check with no publication or session.
- `redeven:spec/openapi/gateway-v3.yaml` - Signed check and proof schemas.
- `redeven:desktop/src/main/runtimeAccessIdentity.test.ts` - Signature verification, tampering and replay rejection.
- `redeven:desktop/src/main/environmentAccess.test.ts` - Binding invalidation, explicit defaults, persistence and malformed-state preservation.
- `redeven:desktop/src/welcome/environmentRelation.test.ts` - Existing Cloud perspective ownership with Gateway membership.
- `redeven:desktop/scripts/check-environment-access-routes.mjs` - Production components, ten locales, explicit routes, Save/Cancel, narrow dark layouts and enlarged text.
- `redeven:desktop/scripts/fixtures/gateway-access-electron.ts` - Real Runtime proof through signed Gateway verification and Desktop proxy readiness, separate login and session lifetimes.
