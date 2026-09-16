---
type: Security Contract
title: Local UI network exposure
description: Local UI separates network scope, password authentication, explicit HTTP or HTTPS, and private Desktop access.
tags: [security, local-ui, desktop, env-app, flowersec]
timestamp: 2026-09-16T00:00:00Z
---
# Summary

Runtime owns a public client endpoint independently of the Desktop that starts it. New environments explicitly use HTTP on `localhost:23998`; HTTP needs no certificate. Network exposure requires a fixed port and an effective environment password. HTTPS is an independent explicit choice, with strict certificate validation and client trust. Pages and Flowersec WS/WSS share one public port. A TLS failure never downgrades to HTTP, and the authenticated private Desktop bridge never becomes a public fallback.

# Contract

## Device CA lifecycle

The user explicitly creates the device CA with `redeven local-authority device-ca generate` and may inspect it with `status`. On macOS and Windows, `install --scope user` safely installs the public certificate for the current user. On Linux, `install --scope user` returns `manual_required`; the user exports only the public certificate with `export` and manually imports it into the trust store used by the actual browser or client. Redeven never generates a CA during Runtime startup, never exposes its private key, never writes a system-wide trust store, never invokes `sudo`, and never silently elevates privileges.

Certificate identity, client trust, and maintenance operation outcomes are separate facts. A valid but untrusted CA is a successful status query with `identity: ready` and `trust: untrusted`, not an invalid certificate. Expired, not-yet-valid, incomplete, and malformed identities remain distinct from permission, timeout, installation, and inspection failures. Generation never replaces an existing identity. A failed trust installation preserves the certificate; success must be followed by a fresh trust check. System trust applies only to the inspected OS user and does not prove trust in another device or a browser with a separate store.

The CA key and certificate live under the Local Environment state directory with private directory and key permissions. Runtime startup validates the CA identity, key match, CA constraints, validity, file type, and permissions. Each start then creates and validates an in-memory P-256 leaf certificate containing only the exact configured DNS and IP SANs; the leaf is not persisted. Missing, invalid, or expired CA identity and leaf creation failure prevent HTTPS/WSS startup. Runtime neither verifies nor establishes trust in a browser-specific or client-specific trust store. A client that does not trust the CA fails its TLS connection closed.

## Listener and origin boundary

The public listener accepts only canonical authorities derived from its actual bound addresses. Wildcard binds enumerate usable same-family interface addresses and exclude loopback, unspecified, multicast, link-local, zoned, mapped, inactive, and duplicate addresses. Display URLs, startup reports, Runtime status, health, and access status expose complete actual HTTP or HTTPS URLs rather than wildcard placeholders or saved next-start settings. No current URL exists before successful binding.

Each listener serves the common application handler and `/flowersec/v3/direct` through Flowersec's published server composition API. HTTP explicitly selects `flowersec-http-direct/1`, `IssueHTTPDirect`, and the public HTTPDirect browser connector. HTTPS uses normal `flowersec/3` artifacts and WSS with the CA TLS policy. The origin, Host, authorization, resource limits, spend transaction, and session ownership remain enforced in both protocols. Sharing or opening an address never requires a second public port.

Trusted Desktop, SSH, and container traffic can enter through a separate exact numeric-loopback bridge while public clients connect concurrently. Every bridge request requires a fresh 256-bit token carried only by private runtime status, a `0600` launch report, or stdio hello. Desktop injects it only for the exact authorized bridge authority. Bridge addresses and tokens never join public display, clipboard, QR, diagnostics, renderer startup, or exposure projections. Its isolated `flowersec-private-loopback/1` profile is unchanged and cannot authorize public clients.

## Admission and lifecycle

A network listener starts only for a concrete non-loopback IP or wildcard with a fixed nonzero port and an effective password. Network-reachable devices are not restricted to the local subnet by a wildcard bind. The listening address selects server interfaces, not a client allowlist. A password may also protect loopback access without changing its scope. `LocalUIExposure` projects `scope` as `loopback` or `network`, `transport` as `http` or `tls`, and the effective password requirement.

The saved `local_ui_protocol` is `http` or `https`. Missing protocol settings default to HTTP in both Desktop and Runtime, including existing catalogs, without requiring confirmation or certificate preparation. Reading that default does not rewrite the catalog, change the saved bind or port, or clear password protection; normal saves and starts persist the effective protocol. An explicit HTTPS choice remains HTTPS and certificate failures stop startup without downgrade. The one-start bind override changes only the actual listener, preserving the saved address. Occupied explicit ports fail with a startup error instead of silently selecting another port.

Connect artifacts are one-shot admission state. Each client authenticates independently with the shared environment password, without contacting the first Desktop or obtaining its bridge token. Pending metadata becomes an active binding only after Flowersec authenticates the session. Transport termination, logout, access expiry, and plugin-scope revoke affect the exact owning session; Runtime shutdown ends all sessions. Closing a Desktop window does not stop Runtime. Flowersec owns admission, session establishment, liveness, handler dispatch, close, and lease release; Redeven does not copy those loops.

## Server-owned access configuration

Runtime retains only a bcrypt password verifier in its private `local-ui-password.bcrypt` file. An omitted startup secret preserves it, allowing independent restarts without the first Desktop. Password replacement uses explicit secret input; clearing requires `--password-clear` or an authorized settings operation and is rejected for network exposure. A missing verifier for a catalog marked password-protected, a malformed verifier, a symlink, or unsafe file permissions fails startup closed. Oversized bcrypt inputs never disable authentication. Existing installations supply their password once to establish the verifier; no plaintext is added to the Environment catalog.

Authenticated private runtime-control `GET/PUT /v2/runtime/access` reads or saves next-start settings while Runtime is running. A URL login cannot call this interface. When Runtime is stopped, the same registered SSH/WSL/container management channel invokes `local-authority access get|set --state-root`; set reads a closed JSON object from stdin and requires the Runtime state lock. Both paths validate the same bind, protocol, and password contract. A rejected CLI save returns a nonzero exit status with the failure on stderr and no success payload on stdout. The live listener and existing sessions remain unchanged until an explicit restart. This is not a concurrent lifecycle-management coordination service.

Access reports include whether saved configuration or the password verifier differs from the running instance, bound to its process start identity. Reopening settings retains this pending state; a replacement Runtime cannot inherit a stale pending flag. Native Desktop saves through the same server authority before updating its client preferences. An ordinary catalog write failure restores the previous verifier and returns an error; this rollback does not claim crash-atomicity across the two files.

A `keep` settings operation may supply a retained password solely to establish a missing verifier for an existing installation. An existing verifier remains byte-for-byte unchanged, even when the supplied Desktop credential is stale. A password-protected catalog with no verifier or retained credential fails closed instead of silently clearing authentication. Failed catalog saves roll back verifier initialization as well as replacement and clearing.

# Boundaries

Installing trust in each HTTPS client is an explicit user action outside Runtime startup. CA validation proves the serving identity, not client trust. Password authentication controls application access; HTTP does not encrypt pages or login data. Standard SHA-256 and cryptographically secure randomness remain required in HTTP contexts, including plugin and terminal integrity checks. Browser capabilities requiring a secure context remain unavailable with feature-specific guidance; browser security is never disabled. URL access conveys no SSH or lifecycle management authority. The private Desktop profile still requires exact preload provenance and numeric loopback, independently of explicit public HTTP support.

# Evidence

- `redeven:internal/config/catalog_test.go` - Preserves saved addresses, password protection, and explicit HTTPS while defaulting a missing protocol to HTTP without rewriting catalog bytes.
- `redeven:internal/localui/device_ca.go` - Creates and validates the durable device CA and ephemeral exact-SAN leaf.
- `redeven:internal/localui/device_ca_install.go` - Installs current-user trust on macOS and Windows and returns manual-required guidance on Linux without elevation.
- `redeven:cmd/redeven/local_authority.go` - Exposes generate, status, export, and install commands.
- `redeven:internal/localui/network_server.go` - Composes public HTTP/WS or HTTPS/WSS on one listener.
- `redeven:internal/localui/http_security.go` - Derives exact actual public authorities.
- `redeven:internal/localui/localui.go` - Issues one-shot v3 artifacts and binds accepted sessions.
- `redeven:internal/envapp/ui_src/src/ui/security/localTransportSecurity.ts` - Distinguishes public HTTP, public TLS, and exact Desktop private provenance.
- `redeven:internal/runtimemanagement/local_ui_exposure.go` - Projects independent scope, protocol, and password requirements.
- `redeven:internal/localui/localui_e2e_test.go` - Validates public and private authenticated sessions and same-port transport.
- `redeven:internal/accessgate/credential.go` - Persists only a private bcrypt verifier and rejects damaged credentials.
- `redeven:internal/localui/runtime_access_test.go` - Verifies exact management authorization, password independence, and secret-free settings reports.
