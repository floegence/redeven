---
type: Security Contract
title: Single-administrator Web Center access
description: Bind host-authorized setup and independent password/MFA to derived entries.
tags: [security, web, authentication, recovery]
timestamp: 2026-10-28T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-28"
---
# Summary

Center has one administrator and multiple device sessions. Center, Gateway and Runtime authorization remain independent. Center login permits directory/open actions, without bypassing Runtime login or creating management authority. Server-owned cancellation scopes fence every derived admission when its device loses authority.

# Contract

## Setup and storage

The owner invokes `redeven-center setup --state-root ...` for a 15-minute credential. Network visitors cannot initialize without it. Password, verified TOTP and saved-recovery-code confirmation commit together. Partial setup grants no business. Passwords use 12–72 UTF-8 bytes; recovery codes replace only the factor.

Unix owner socket authorization checks actual service UID or root. SSH accounts/tunnels, loopback and headers grant nothing. `recover` fences business and creates owner-authorized setup; `recover --offline --origin ...` requires exclusive stopped-state access. Unsupported peer verification fails closed.

State uses an exclusive lock, private files and AES-GCM encrypted SQLite. `center.key` pins instance/origin/initialization. Missing/corrupt committed key/database fails closed. Back up both together. Browser DTOs omit auth secrets and private route keys; only an explicit owner command prints its temporary credential.

## Authentication and devices

Password creates a five-minute browser/action/session/revision-bound challenge, with at most five factor failures. Password alone grants no business. Atomic TOTP-step/recovery consumption persists across restart. Login rotates device/browser sessions. Security changes revoke sessions, challenges, grants and derived connections.

Limits are one hour idle, twelve hours absolute and 16 devices. Trusted visible input reports activity; output/polling/heartbeat does not renew it. Frozen pages cannot extend authority. One-device revocation preserves other devices. Restart invalidates all devices but preserves credentials, directory and audit facts.

Sensitive mutations require fresh password/factor verification and a ten-minute grant for exact action/target/payload/revision. Bounded retry receipts belong to the same session/request and cannot repeat side effects. Normal viewing/opening requires no extra Center MFA while the session remains valid.

## Admission and resource limits

Bounded authentication concurrency and persistent administrator/direct-peer budgets survive restart. Failures back off and expire instead of locking permanently. Forwarded headers cannot choose source identity.

Gateway catalog/pairing requests inherit their authenticated device context: logout, recovery and security changes cancel pending network activity. Separate request budgets permit two per device/source, eight per device and 32 globally, preserving logout and another source's capacity.

Current limits: 16 Gateways, 128 routes, 128 operation receipts with at most 32 per device, 16 live root/child operations per device, 16 concurrent proxy requests per access owner, 48 per device, 192 total. Repeated opens cannot let one device fill the global receipt budget. Revocation removes live admission immediately; five-minute tombstones retain retry outcomes. JSON/header sizes are bounded, file streams incremental, private egress restricted to signed approved endpoints.

Runtime accessgate remains target authentication/channel authority. Binding+revision+device scopes prevent cross-route/device replay; children add resource scope. Binding revocation fences new admission and channels without changing unrelated paths. Children cannot invoke Env APIs, spend sibling artifacts or set parent cookies. Changed proofs fail closed without downgrade. Portal framing stays denied; child framing follows Runtime policy.

# Boundaries

The host administrator controls the trusted entry server. Center authentication does not protect plaintext against that host. SSH webpage login and remote OS administration are not implemented. Browser activity reports preserve ordinary idle behavior; they cannot extend the absolute server deadline.

# Evidence

- `internal/environmentcenter/auth_test.go`, `setup_retry_test.go`, `server_test.go`: factors, scoped retries, owner identity and recovery.
- `internal/webbinding/store_test.go`: durable pinning and concurrent admission/revocation.
- `internal/accessgate/scope_test.go`, `internal/localui/web_application_test.go`: credential and artifact separation.
- `scripts/check_center_browser.mjs`: actual setup/MFA, logout, stale-cookie denial and key/binding/Gateway revocation.

Tests certify their explicit scenarios, not every race or deployment variant by inference.
