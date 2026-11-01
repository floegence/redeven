---
type: Security Contract
title: Local UI network exposure
tags: [security, local-ui, desktop, env-app, flowersec]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

New Runtime endpoints explicitly use HTTP localhost:23998; network exposure retains local access and requires fixed port/effective password. HTTPS is separate with strict certificate/trust checks. Pages and WS/WSS share the public port. TLS failure never downgrades; private Desktop bridge cannot become public fallback.

# Contract

## HTTPS certificate ownership
[Local UI certificates](local-ui-certificates.md) owns creation, import, replacement, removal, validation, and client trust. It never creates or repairs certificate material, installs trust, or falls back to HTTP. Certificate replacement affects the next start; the running TLS identity and sessions remain intact.

## Listener and origin boundary
The public listener accepts only canonical authorities derived from its actual bound addresses.
An HTTP loopback listener also routes the exact plugin child origins derived
from its current parent authority and port exclusively to ReDevPlugin's Web
resource handler. Child routing strips parent credentials and never enters
Local UI management. A removed parent, different port, network-only address,
or HTTPS listener cannot use this loopback resource route. The platform still
validates each asset session, origin, ticket, and surface lifetime.

Its isolated `flowersec-private-loopback/1` profile is unchanged and cannot authorize public clients.

## Native Desktop default-port recovery
Only native Desktop launches with saved default `localhost:23998` and no explicit one-start bind override opt in through `--local-ui-default-port-fallback`. Other errors, custom ports, numeric loopback overrides, network binds, and wildcard binds never silently select another port.

External bookmarks containing the old fixed port cannot follow the temporary address.

## Network changes and current reports
While network exposure is enabled, Runtime enumerates eligible interfaces every two seconds. Its public list is explicit, including `[]`; private bridge endpoints cannot supply missing public addresses.

Address failures affect public availability and never assert that the Runtime process has stopped or expose private management URLs.

## Admission and lifecycle
A network listener starts only for a concrete non-loopback IP or wildcard with a fixed nonzero port and an effective password.

Occupied explicit ports fail with a startup error instead of silently selecting another port.

Flowersec owns admission, session establishment, liveness, handler dispatch, close, and lease release; Redeven does not copy those loops.

## Server-owned access configuration
[Runtime two-factor authentication](runtime-two-factor-authentication.md) owns the persistent credential authority, one-time bcrypt verifier migration, TOTP enrollment, recovery, replay protection, and ordinary-session revocation. Explicit password changes remain next-start settings when MFA is disabled; MFA-enabled settings cannot clear/replace that password or downgrade HTTPS.

Failed catalog saves roll back verifier initialization as well as replacement and clearing.

# Boundaries

Installing trust in each HTTPS client is an explicit user action outside Runtime startup. Browser capabilities requiring a secure context remain unavailable with feature-specific guidance; browser security is never disabled. The private Desktop profile still requires exact preload provenance and numeric loopback, independently of explicit public HTTP support.

# Evidence

- `redeven:internal/localui/public_address_refresh.go` - Single address/certificate snapshot and canceled refresh.

- `redeven:internal/localui/public_address_refresh_test.go` - Network changes/recovery, fixed binds, reports, certificates and authenticated WSS.

- `redeven:internal/config/catalog_test.go` - Saved addresses/password/HTTPS preserved; absent protocol defaults HTTP without writes.
