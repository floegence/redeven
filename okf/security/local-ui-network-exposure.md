---
type: Security Contract
title: Local UI network exposure
description: Local UI separates network scope, password authentication, explicit HTTP or HTTPS, and private Desktop access.
tags: [security, local-ui, desktop, env-app, flowersec]
timestamp: 2026-09-30T00:00:00Z
---
# Summary

Runtime owns a public client endpoint independently of the Desktop that starts it. New environments explicitly use HTTP on `localhost:23998`; HTTP needs no certificate. Network exposure retains local browser access and adds reachable network addresses; it requires a fixed port and an effective environment password. HTTPS is an independent explicit choice, with strict certificate validation and client trust. Pages and Flowersec WS/WSS share one public port. A TLS failure never downgrades to HTTP, and the authenticated private Desktop bridge never becomes a public fallback.

# Contract

## HTTPS certificate ownership

[Local UI certificates](local-ui-certificates.md) owns creation, import, replacement, removal, validation, and client trust. HTTPS startup requires a valid saved identity covering the exact listener hosts. It never creates or repairs certificate material, installs trust, or falls back to HTTP. Certificate replacement affects the next start; the running TLS identity and sessions remain intact.

## Listener and origin boundary

The public listener accepts only canonical authorities derived from its actual bound addresses. An IPv4 wildcard uses `tcp4` and supplements it with same-port IPv6 loopback; an IPv6 wildcard uses `tcp6` and supplements it with same-port IPv4 loopback. Only an unavailable optional address family may be omitted; an occupied port fails the entire start. Specific IP binds remain exact. One public address policy combines usable same-family network interfaces with `localhost` and the loopback IPs actually served. Network interface enumeration excludes unspecified, multicast, link-local, zoned, mapped, inactive, and duplicate addresses. A wildcard with no usable network interface still serves its local addresses. Network URLs retain their primary order and local aliases follow them. Display URLs, startup reports, Runtime status, health, and access status expose complete actual HTTP or HTTPS URLs rather than wildcard placeholders or saved next-start settings. No current URL exists before successful binding.

Each listener serves the common application handler and `/flowersec/v3/direct` through Flowersec's published server composition API. HTTP explicitly selects `flowersec-http-direct/1`, `IssueHTTPDirect`, and the public HTTPDirect browser connector. HTTPS uses normal `flowersec/3` artifacts and WSS with the CA TLS policy. Both protocols use the same product WebSocket admission callback: the Host must belong to the actual public address set and the Origin must match that request exactly after default-port normalization. Different public aliases cannot authorize each other. HTTPS uses Flowersec `AuthorizeWebSocketRequest` before protocol dispatch, upgrade, and session authorization, and its mutually exclusive dynamic `AcceptorOptions.CheckOrigin` instead of static `AllowedOrigins`. Both callbacks read the current public policy. TLS, current Origin policy, authorization, resource limits, spend transactions, and session ownership remain enforced. Sharing or opening an address never requires a second public port.

Trusted Desktop, SSH, and container traffic can enter through a separate exact numeric-loopback bridge while public clients connect concurrently. Every bridge request requires a fresh 256-bit token carried only by private runtime status, a `0600` launch report, or stdio hello. Desktop injects it only for the exact authorized bridge authority. Bridge addresses and tokens never join public display, clipboard, QR, diagnostics, renderer startup, or exposure projections. Its isolated `flowersec-private-loopback/1` profile is unchanged and cannot authorize public clients.

## Network changes and current reports

While network exposure is enabled, Runtime enumerates eligible interfaces every two seconds. One immutable snapshot owns public URLs, HTTP Host admission, WebSocket Origin admission, the serving leaf certificate, and optional address diagnostics. Each health, attach, and access report reads one complete snapshot. Its public list is explicit, including `[]`; private bridge endpoints cannot supply missing public addresses.

Wildcard listeners add current same-family addresses and withdraw removed addresses while retaining their actual loopback listeners. A specific IP listener never rebinds itself: when its IP disappears, its public list becomes empty with `bound_address_unavailable`, directing the user to change access settings and restart. Enumeration failure withdraws network addresses that cannot be confirmed and reports `interface_scan_failed`. Refresh recovers automatically and clears resolved diagnostics. Cancellation stops the task; shutdown joins it before clearing the snapshot, so a late refresh cannot republish addresses.

[Local UI certificates](local-ui-certificates.md) owns HTTPS coverage and signing failure behavior. Address failures affect public availability and never assert that the Runtime process has stopped or expose private management URLs.

## Admission and lifecycle

A network listener starts only for a concrete non-loopback IP or wildcard with a fixed nonzero port and an effective password. Network-reachable devices are not restricted to the local subnet by a wildcard bind. The listening address selects server interfaces, not a client allowlist. A password may also protect loopback access without changing its scope. `LocalUIExposure` projects `scope` as `loopback` or `network`, `transport` as `http` or `tls`, and the effective password requirement.

The saved `local_ui_protocol` is `http` or `https`. Missing protocol settings default to HTTP in both Desktop and Runtime, including existing catalogs, without requiring confirmation or certificate preparation. Reading that default does not rewrite the catalog, change the saved bind or port, or clear password protection; normal saves and starts persist the effective protocol. An explicit HTTPS choice remains HTTPS and certificate failures stop startup without downgrade. The one-start bind override changes only the actual listener, preserving the saved address. Occupied explicit ports fail with a startup error instead of silently selecting another port.

Connect artifacts are one-shot admission state. Every public entry, including loopback in network mode, authenticates independently with the environment password and any enabled second factor, without contacting the first Desktop or obtaining its bridge token. Pending metadata becomes an active binding only after Flowersec authenticates the session. Transport termination, logout, access expiry, and plugin-scope revoke affect the exact owning session; Runtime shutdown ends all sessions. Closing a Desktop window does not stop Runtime. Flowersec owns admission, session establishment, liveness, handler dispatch, close, and lease release; Redeven does not copy those loops.

## Server-owned access configuration

[Runtime two-factor authentication](runtime-two-factor-authentication.md) owns the persistent credential authority, one-time bcrypt verifier migration, TOTP enrollment, recovery, replay protection, and ordinary-session revocation. An omitted startup secret preserves the committed password. Explicit password changes remain next-start settings when MFA is disabled; MFA-enabled settings cannot clear/replace that password or downgrade HTTPS. Missing or damaged committed credentials fail startup closed.

Authenticated private runtime-control `GET/PUT /v2/runtime/access` reads or saves next-start settings while Runtime is running. A URL login cannot call this interface. When Runtime is stopped, the same registered SSH/WSL/container management channel invokes `local-authority access get|set --state-root`; set reads a closed JSON object from stdin and requires the Runtime state lock. Both paths validate the same bind, protocol, and password contract. A rejected CLI save returns a nonzero exit status with the failure on stderr and no success payload on stdout. The live listener and existing sessions remain unchanged until an explicit restart. This is not a concurrent lifecycle-management coordination service.

Access reports include whether saved configuration, the password verifier, or the HTTPS certificate fingerprint differs from the running instance, bound to its process start identity. Reopening settings retains this pending state; a replacement Runtime cannot inherit a stale pending flag. Native Desktop saves through the same server authority before updating its client preferences. An ordinary catalog write failure restores the previous verifier and returns an error; this rollback does not claim crash-atomicity across the two files.

A `keep` settings operation may supply a retained password solely to establish a missing verifier for an existing installation. An existing verifier remains byte-for-byte unchanged, even when the supplied Desktop credential is stale. A password-protected catalog with no verifier or retained credential fails closed instead of silently clearing authentication. Failed catalog saves roll back verifier initialization as well as replacement and clearing.

# Boundaries

Installing trust in each HTTPS client is an explicit user action outside Runtime startup. CA validation proves the serving identity, not client trust. Password authentication controls application access; HTTP does not encrypt pages or login data. Standard SHA-256 and cryptographically secure randomness remain required in HTTP contexts, including plugin and terminal integrity checks. Browser capabilities requiring a secure context remain unavailable with feature-specific guidance; browser security is never disabled. URL access conveys no SSH or lifecycle management authority. The private Desktop profile still requires exact preload provenance and numeric loopback, independently of explicit public HTTP support.

# Evidence

- `redeven:internal/localui/public_address_refresh.go` - Publishes one current address and certificate snapshot and owns refresh cancellation.
- `redeven:internal/localui/public_address_refresh_test.go` - Covers network replacement, loss/recovery, fixed binds, reports, certificates, and authenticated WSS across refresh.

- `redeven:internal/config/catalog_test.go` - Preserves saved addresses, password protection, and explicit HTTPS while defaulting a missing protocol to HTTP without rewriting catalog bytes.
- `redeven:internal/localui/network_server.go` - Composes public HTTP/WS or HTTPS/WSS on one listener.
- `redeven:internal/localui/public_addresses.go` - Owns explicit listener families and shared startup/preflight host resolution.
- `redeven:internal/localui/http_security.go` - Enforces exact actual public authorities and same-origin admission.
- `redeven:internal/localui/localui.go` - Issues one-shot v3 artifacts and binds accepted sessions.
- `redeven:internal/envapp/ui_src/src/ui/security/localTransportSecurity.ts` - Distinguishes public HTTP, public TLS, and exact Desktop private provenance.
- `redeven:internal/runtimemanagement/local_ui_exposure.go` - Projects independent scope, protocol, and password requirements.
- `redeven:internal/localui/localui_e2e_test.go` - Validates public and private authenticated sessions and same-port transport.
- `redeven:internal/accessgate/credential.go` - Reads the committed authentication authority and supports one-time legacy verifier migration.
- `redeven:internal/localui/runtime_access_test.go` - Verifies exact management authorization, password independence, and secret-free settings reports.
