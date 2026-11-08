---
type: Security Contract
title: Single-administrator Web Center access
tags: [security, web, authentication, recovery]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Center has one administrator and multiple devices. Unix socket checks service UID/root, never SSH/tunnel/loopback/header claims. recover fences business and authorizes setup; recover --offline --origin needs stopped exclusive state. Exclusive lock protects AES-GCM SQLite. center.key pins instance/origin/initialization; missing/corrupt committed state fails.

# Contract

## Setup/storage
Owner redeven-center setup --state-root issues a mandatory15-minute credential. Password/verified TOTP/recovery-code confirmation commit atomically; partial setup grants nothing. Passwords:12–72 UTF-8 bytes; recovery codes replace only factor.

Unsupported peer checks fail.

Back up key/database together. DTOs omit secrets/private keys; only owner commands print temporary credentials. Audit keeps closed sensitive-action categories, never payload/credential-derived digest. Expiring challenges/grants alone bind exact actions; bcrypt verifies passwords. Schema2 atomically redacts v1 audit refs before readiness, preserving events/unrelated state; damaged/future stores stay unchanged.

## Authentication
Password creates a five-minute browser/action/session/revision challenge, <=five factor failures; password alone grants nothing. Atomic TOTP-step/recovery consumption survives restart. Login rotates device/browser sessions; security changes revoke sessions/challenges/grants/connections.

Limit16 devices, one-hour idle/twelve-hour absolute sessions. Only trusted visible input renews idle, never frozen pages/output/polls/heartbeat. Revocation preserves other devices; restart invalidates sessions but retains credentials/directory/audit.

Sensitive changes need fresh password/factor and ten-minute action/target/payload/revision grants. Password-change bindings use PBKDF2-HMAC-SHA256,600000 iterations/32 bytes, domain-separated random login-device-ID salt, mirrored in Web Crypto; no raw-password SHA256. Recheck expiry/revision/session after derivation. Bounded same-session/request receipts prevent repeated effects. Viewing/opening valid sessions needs no extra MFA.

## Admission
Bound auth concurrency and persist administrator/direct-peer budgets through restart. Failures back off/expire, never permanently lock. Forwarded headers cannot select identity. Revocation/recovery cancels catalog/pairing; limits2/device/source,8/device,32 global preserve logout/other sources.

Limits:16 Gateways,128 routes,128 receipts (<=32/device),16 live root/child operations/device; concurrent proxy16/access-owner,48/device,192 total. Reopening cannot monopolize receipts. Revoke live admission immediately; five-minute tombstones retain outcomes. Bound JSON/headers, stream files, restrict egress to signed approved endpoints.

Child reopen makes fresh browser handoff and reuses authority only for exact parent/resource-kind/ID/Runtime-instance/login-cookie-name/value; paths may vary within resource. Cancel/expire repeated handoff preserves existing owner; owner revoke invalidates pending reuse. Reuse consumes bounded receipts and cannot bypass resource limits.

Runtime accessgate owns login/channels. Binding/revision/device scope prevents cross-route/device replay; children add resource scope. Binding revoke fences admission/channels, not unrelated paths. Children cannot invoke Env APIs, spend sibling artifacts or set parent cookies. Changed proofs fail without downgrade. Deny portal framing; child framing follows Runtime.

# Boundaries

Host administrator controls entry-server plaintext. No SSH webpage login/remote OS administration. Browser activity never extends absolute server deadlines.

# Evidence

- `internal/environmentcenter/auth_test.go`, `setup_retry_test.go`, `server_test.go`
- `internal/environmentcenter/audit_security_test.go`: payload exclusion/v1 redaction/stable reopen/credential retention/migration rollback.
