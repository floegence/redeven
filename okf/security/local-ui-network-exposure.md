---
type: Security Contract
title: Local UI network exposure
description: Local UI uses explicit device trust, HTTPS, independent Flowersec WSS, and password-protected network admission.
tags: [security, local-ui, desktop, env-app, flowersec]
timestamp: 2026-08-26T00:00:00Z
---
# Summary

Every public Local UI listener uses trusted HTTPS. Flowersec direct sessions use an independent runtime-assigned WSS listener and v3 artifact. Loopback remains the default; network exposure additionally requires a fixed port and an effective Local UI password. Redeven never falls back to plaintext HTTP, `ws:`, a v2 route, or an alternate listener.

# Contract

## Device CA lifecycle

The user explicitly creates the device CA with `redeven local-authority device-ca generate`, inspects it with `status`, exports only the public certificate with `export`, and requests current-user trust with `install --scope user`. Redeven never generates a CA during Runtime startup, never exposes its private key, never writes a system trust store, never invokes `sudo`, and never silently elevates privileges. Platforms without a safe current-user installer return explicit manual instructions.

The CA key and certificate live under the Local Environment state directory with private directory and key permissions. Runtime startup validates identity, key match, CA constraints, validity, file type, and permissions, then verifies current-user trust. Missing, invalid, expired, or untrusted state fails closed with remediation. Each start creates an in-memory P-256 leaf certificate containing only the exact configured DNS and IP SANs; the leaf is not persisted.

## Listener and origin boundary

The public HTTPS listener accepts only canonical authorities derived from its actual bound addresses. Wildcard binds enumerate usable same-family interface addresses and exclude loopback, unspecified, multicast, link-local, zoned, mapped, inactive, and duplicate addresses. Display URLs, startup reports, Runtime status, health, and access status expose those HTTPS authorities rather than wildcard placeholders.

Each HTTPS listener has a separate dynamically assigned WSS listener served by Flowersec Go v3 `NewWebSocketHTTPServer` at `/flowersec/v3/direct`. Artifact issuance maps the already validated HTTPS authority to its exact WSS authority and uses a CA TLS policy. The browser requires `https:` before it requests an artifact; HTTP never selects a weaker transport or URL guess.

Trusted Desktop, SSH, and container traffic enters through a separate exact loopback bridge. The bridge authority is machine-only and never joins public display or exposure projections. It may obtain an artifact whose candidate is the independent WSS listener, but it cannot expose or reuse that listener as a public fallback.

## Admission and lifecycle

A network listener starts only for a concrete non-loopback IP or wildcard with a fixed nonzero port and an effective password. There is no plaintext-risk acknowledgement, compatibility flag, or bind-scoped review state. `LocalUIExposure` projects `scope` as `loopback` or `network`, `transport` as `tls`, and the effective password requirement.

Connect artifacts are one-shot v3 admission state. Pending metadata is consumed only after Flowersec authenticates the session and becomes an independent active binding. Unused expired artifacts are rejected. Transport termination, logout, access expiry, plugin-scope revoke, and shutdown remove their exact authorization, handler, and active-session state. Flowersec owns WSS admission, session establishment, liveness, handler dispatch, close, and lease release; Redeven does not copy those loops.

# Boundaries

Installing trust is an explicit user action outside Runtime startup. Password authentication controls application access but does not replace TLS identity. The private Desktop bridge is an exact loopback capability and is not a public transport.

# Evidence

- `redeven:internal/localui/device_ca.go` - Creates and validates the durable device CA and ephemeral exact-SAN leaf.
- `redeven:internal/localui/device_ca_install.go` - Implements explicit current-user trust without elevation.
- `redeven:cmd/redeven/local_authority.go` - Exposes generate, status, export, and install commands.
- `redeven:internal/localui/secure_server.go` - Owns HTTPS and independent Flowersec WSS listeners.
- `redeven:internal/localui/http_security.go` - Derives exact public HTTPS authorities.
- `redeven:internal/localui/localui.go` - Issues one-shot v3 artifacts and binds accepted sessions.
- `redeven:internal/envapp/ui_src/src/ui/security/localTransportSecurity.ts` - Requires trusted HTTPS without fallback.
- `redeven:internal/runtimemanagement/local_ui_exposure.go` - Projects the canonical TLS posture.
