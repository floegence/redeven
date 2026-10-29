---
type: Security Contract
title: Single-administrator Web Center access
tags: [security, web, authentication, recovery]
lifecycle: contract
reviewed_at: "2026-10-29"
---
# Summary

Center has one administrator and multiple devices. Center, Gateway and Runtime retain independent authorization: Center permits directory/open actions, never Runtime login bypass or management authority. Device revocation cancels every derived admission.

# Contract

## Setup and storage

Owner command `redeven-center setup --state-root ...` issues the mandatory 15-minute setup credential. Password, verified TOTP and recovery-code confirmation commit together; partial setup grants nothing. Passwords use 12–72 UTF-8 bytes; recovery codes replace only the factor.

Unix owner socket authorization checks actual service UID or root. SSH accounts/tunnels, loopback and headers grant nothing. `recover` fences business and creates owner-authorized setup; `recover --offline --origin ...` requires exclusive stopped-state access. Unsupported peer verification fails closed.

An exclusive lock protects private AES-GCM SQLite state. `center.key` pins instance/origin/initialization; missing or corrupt committed state fails closed. Back up key and database together. Browser DTOs omit secrets/private keys; only owner commands print temporary credentials.

Audit records retain a closed sensitive-action category, never the request payload or its credential-derived digest. Exact action bindings remain only in expiring challenges/grants; password verifiers use bcrypt. Database version 2 atomically redacts version-1 audit references before readiness, preserves event facts and unrelated state, and rejects damaged or future stores unchanged.

## Authentication and devices

Password creates a five-minute browser/action/session/revision-bound challenge, with at most five factor failures. Password alone grants no business. Atomic TOTP-step/recovery consumption persists across restart. Login rotates device/browser sessions. Security changes revoke sessions, challenges, grants and derived connections.

Sessions allow one hour idle, twelve hours absolute and 16 devices. Only trusted visible input renews idle activity. Frozen pages, output, polling and heartbeat do not. Device revocation preserves other devices; restart invalidates all sessions, preserving credentials, directory and audit.

Sensitive mutations require fresh password/factor verification and ten-minute action/target/payload/revision grants. Password-change action bindings use PBKDF2-HMAC-SHA256 (600,000 iterations, 32 bytes) with a domain-separated random login-device ID salt, mirrored by browser Web Crypto; raw password SHA-256 fingerprints are forbidden. Expiry/revision/session checks run again after derivation. Bounded same-session/request retry receipts prevent repeated effects. Valid sessions need no extra MFA for viewing/opening.

## Admission and resource limits

Bounded authentication concurrency and persistent administrator/direct-peer budgets survive restart. Failures back off and expire instead of locking permanently. Forwarded headers cannot choose source identity.

Device revocation/recovery cancels catalog/pairing requests. Budgets allow two per device/source, eight per device and 32 globally, preserving logout and other sources.

Current limits: 16 Gateways, 128 routes, 128 operation receipts with at most 32 per device, 16 live root/child operations per device, 16 concurrent proxy requests per access owner, 48 per device, 192 total. Repeated opens cannot let one device fill the global receipt budget. Revocation removes live admission immediately; five-minute tombstones retain retry outcomes. JSON/header sizes are bounded, file streams incremental, private egress restricted to signed approved endpoints.

Reopening a child creates a fresh browser-bound handoff while reusing its live authority only for the exact parent, resource kind/ID, Runtime instance and Runtime login cookie name/value. Paths may differ within that resource. Canceling or expiring a repeated handoff preserves the existing owner; revoking that owner invalidates pending reuse. Reuse still consumes bounded handoff receipts and cannot bypass another resource's admission limit.

Runtime accessgate remains target authentication/channel authority. Binding+revision+device scopes prevent cross-route/device replay; children add resource scope. Binding revocation fences new admission and channels without changing unrelated paths. Children cannot invoke Env APIs, spend sibling artifacts or set parent cookies. Changed proofs fail closed without downgrade. Portal framing stays denied; child framing follows Runtime policy.

# Boundaries

The host administrator controls entry-server plaintext. SSH webpage login and remote OS administration are absent. Browser activity cannot extend the absolute server deadline.

# Evidence

- `internal/environmentcenter/auth_test.go`, `setup_retry_test.go`, `server_test.go`: factors, scoped retries, owner identity and recovery.
- `internal/environmentcenter/audit_security_test.go`: payload non-retention, version-1 redaction, stable reopen, credential preservation and failed-migration rollback.
- `internal/webbinding/store_test.go`: durable pinning and concurrent admission/revocation.
- `internal/accessgate/scope_test.go`, `internal/localui/web_application_test.go`: credential and artifact separation.
- `internal/environmentcenter/applications_test.go`: repeated child handoff reuse, receipt expiry and exact authority boundaries.
- `scripts/check_center_browser.mjs`: actual setup/MFA, logout, stale-cookie denial and key/binding/Gateway revocation.

Tests certify only their explicit scenarios.
