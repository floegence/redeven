---
type: Security Contract
title: Runtime two-factor authentication
tags: [security, authentication, runtime, desktop, totp]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Runtime accessgate owns authentication independently of Cloud. MFA requires password then TOTP/single-use recovery for browser/direct/Cloud sessions; password challenge grants no application access. Native/SSH management has separate authority, never inferred from loopback, Cloud admin or headers. Missing/corrupt state fails closed; recovery blocks access until new credentials commit.

# Contract

## Enrollment and management
Desktop Environment Settings / Access presents one two-factor row. If a different environment password has been saved for the next start, restart before configuring MFA; the old running verifier cannot overwrite the newer saved authority.

These commands do not alter SSH keys, sshd policy, PAM, host passwords, or execution identity.

## Session authority
[Runtime access sessions](runtime-access-sessions.md) owns ordinary session deadlines, browser Cookie scope and refresh continuity, challenge binding, native editor delegation, and revocation. MFA management changes revoke ordinary authority through that single gate; they do not create a second browser or Desktop authentication lifecycle.

## Persistence, replay and recovery
`access-auth.sqlite` is a versioned, private SQLite authority, separate from the transport authorization database. The committed database and initialized key become the sole authority; deletion, malformed data, unsafe modes, symlinks, unknown schema, or key loss cannot fall back to the retired verifier.

Authentication state and secrets are not diagnostic export inputs.

# Boundaries

Password-only challenges grant no ordinary product data access. Loopback addresses, Cloud administrator claims and forwarded headers cannot establish private host authority. Missing committed authentication state fails closed; host recovery locks ordinary access until new credentials are committed.

# Evidence

- `redeven:internal/accessgate/authentication_test.go` - Exercises real codes, replay, restart, recovery consumption, throttle persistence, collisions, revocation and child scope.
