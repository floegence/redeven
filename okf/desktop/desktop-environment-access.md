---
type: Desktop Contract
title: Verified Environment access routes
description: Associate Gateway routes with a known Runtime without combining Cloud ownership, management rights or login sessions.
tags: [desktop, gateway, runtime, identity, access]
timestamp: 2026-10-10T00:00:00Z
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
verified identity. Gateway bindings include Gateway and member IDs, logical origin,
Gateway key fingerprint, and signed service identity; direct bindings include the saved
connection owner. Display labels and transient health do not invalidate a
binding. Editing coordinates or changing trust invalidates it immediately.
An asynchronous probe commits only while its configured binding still matches.
A later valid proof for another identity separates the route. Reachability is
not inferred from a retained identity observation.

Gateway access members attach to the chosen original Runtime card, preferring
an owner already linked to Cloud. Original registrations, lifecycle owners and
Cloud perspectives remain intact. Independently registered direct management
owners keep their cards and settings. Gateway members share one Gateway tab inside the original card, extending its
existing split menu and connection settings without adding a duplicate card.
The trusted association is available before public health probing and does not
fabricate or persist a public health identity.
Runtime membership summaries use the Gateway pairing fingerprint: SHA-256 of the canonical, trimmed Ed25519 SubjectPublicKeyInfo PEM, encoded as unpadded base64url with `SHA256:`. The enrollment descriptor's raw base64url public key is converted to that representation before projection. Hashing its encoded text would produce a different identity and leave a valid member on a separate card.
Catalog and open-window observations for the same Gateway registration/member become one entry before ownership projection. The directory retains identity, trust, policy and access availability; the window contributes only its route URL, lifecycle and focus target. Opening or closing a window cannot create another Runtime card or overwrite membership proof. Window counts retain every actual session. Without a verified counterpart, the Gateway entry retains its own card.
After a Runtime confirms removal, Desktop immediately retires only that member's cached directory observation when the registration and pinned Gateway identity still match. It preserves other Gateway members and learned trust; a mismatched or stale identity is left untouched.
[Environment library](desktop-environment-library.md) owns Local / Cloud exact
binding, card layout, search and perspective selection.

Desktop preferences version 15 adds optional versioned observations and route
defaults. Missing access state preserves existing behavior. Malformed access
state is rejected with the original file preserved. Existing registrations,
Gateway member and Cloud binding authority remain in their respective stores.

## Explicit default and one-time opening

The existing main Open button uses the saved default. The menu exposes explicit
route choices, marks the default, and applies another choice only to that open.
Connection settings commit a new default only on Save; closing the dialog drops
its unsaved selection. Adding a verified route preserves an established default. Implicit defaults use
stable registration / first-observation order, never probe completion order or
a newly rebuilt Gateway catalog timestamp.
Gateway member routes always use the joined Gateway. Desktop's explicit default is local to this Desktop and cannot rewrite member or Cloud policy.

A Gateway environment row always opens through its own Gateway. Its catalog
capabilities govern availability. Independently registered direct routes remain explicit alternatives in the
environment access menu. A Gateway member itself has no direct URL mode.
Failures never trigger another route, start Runtime, or change Cloud selection.
Missing or detached default routes disable the default Open action while
allowing explicit choices and connection settings.

Deleting the default registration while alternatives remain requires an explicit
replacement. Desktop saves that choice only after deletion succeeds. Removing
an entire Gateway is blocked until affected environments choose replacement
defaults in their connection settings. Member removal and session closure
retain their existing owner scope. Changing the default neither closes nor
shares existing sessions. [Gateway access sessions](../gateway/gateway-access-sessions.md)
owns transport isolation and same-route session reuse.

## Membership discovery and migration

Members are discovered from the signed v5 directory and matched to trusted Runtime membership summaries. Desktop can verify public
Runtime health only through an authorized reverse connection with the signed
member TLS identity. No draft URL probe or target enrollment form exists.
Public health proof remains an observation; neither it nor the management display association can merge
Cloud environments, approve publication, or grant Runtime management.

The one-time Gateway schema migration removes legacy URL entries, observations
and route preferences. Installation coordinates and valid paired access identity
survive; larger administrative grants require new pairing consent. Existing
Cloud-only Runtime configurations must rejoin and cannot silently gain the new
member delegation. [Gateway Cloud access](../gateway/gateway-cloud-access.md)
owns proof-based preservation of a formal environment ID.

# Boundaries

This contract owns display association and route selection. Runtime health,
Runtime login, direct management, Gateway trust and Cloud ownership retain their
existing authorities. Proof observation never upgrades those permissions.

# Evidence

- `redeven:internal/runtimeidentity/access_identity.go` - State identity, exclusive initialization and nonce proof.
- `redeven:internal/localui/access_identity_test.go` - Public/private identity agreement and independent Runtime authentication.
- `redeven:spec/openapi/gateway-v5.yaml` - Signed membership and service identity schemas.
- `redeven:desktop/src/main/runtimeAccessIdentity.test.ts` - Signature verification, tampering and replay rejection.
- `redeven:desktop/src/main/environmentAccess.test.ts` - Binding invalidation, explicit defaults, persistence and malformed-state preservation.
- `redeven:internal/agent/runtime_service_test.go` - Real enrolled member summaries match the Gateway pairing fingerprint.
- `redeven:desktop/src/main/gatewayStore.test.ts` - Confirmed member retirement is scoped to the same pinned Gateway.
- `redeven:desktop/src/welcome/environmentRelation.test.ts` - Existing Cloud perspective ownership with Gateway membership.
- `redeven:desktop/scripts/check-environment-access-routes.mjs` - Production components, ten locales, explicit routes, Save/Cancel, narrow dark layouts and enlarged text.
- `redeven:desktop/scripts/fixtures/gateway-access-electron.ts` - Real member access over reverse TLS with independent Runtime login and session lifetimes.
