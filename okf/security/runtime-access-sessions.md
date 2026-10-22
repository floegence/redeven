---
type: Security Contract
title: Runtime access sessions
description: Keep browser sign-in continuous across refresh while enforcing one absolute session lifetime and Runtime-owned Cookie scope.
tags: [security, authentication, runtime, desktop, cookies]
timestamp: 2026-09-23T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Runtime `accessgate` is the sole authority for ordinary session validity and revocation. A valid browser session survives refresh, new tabs and temporary disconnects without another password prompt. Cookie names isolate HTTP, HTTPS and Runtime ports; they never grant or extend authorization. Expiry, logout, security changes and Runtime restart require authentication again. Invalid authorities and incompatible Desktop peers fail closed. [Runtime two-factor authentication](runtime-two-factor-authentication.md) owns credential persistence, factor verification and owner management.

# Contract

## Session authority and lifetime
The gate alone decides channel authorization when registering the channel and its lifetime cancellation callback under one lock. Callers supply verified private-management identity or an ordinary login session ID, never an `unlocked` assertion.

Runtime restart clears in-memory sessions and incomplete operations; it preserves committed authentication state.

## Browser Cookie scope and continuity
Local UI alone issues, reads and clears `redeven_local_access_<http|https>_<port>`. Forwarded headers cannot select the scope.

Only an incorrect password or factor produces input validation feedback; transport failures and cooldowns retain their own messages.

## Desktop consumption and forwarding
Desktop Flower retains the complete Runtime-issued access-cookie `name=value` pair and returns it unchanged. It never derives the name from a bridge or forwarded client port.

No upstream platform capability changes are required for this product authentication policy.

# Boundaries

Desktop Web Service handoff cookies are HttpOnly and SameSite=Strict.

Cookies isolate presentation scopes but cannot extend or create authorization.

Native transport never acquires trusted Desktop management identity.

# Evidence

- `redeven:internal/localui/access_cookie.go` - Owns name derivation, attributes and exact-scope deletion.

- `redeven:internal/localui/access_cookie_test.go` - Covers validated/default/IPv6 authorities, ignored forwarded headers and rejected foreign or retired names.

- `redeven:internal/localui/access_cookie_browser_test.go` - Runs production Go handlers and isolated state with real Chromium cookie storage, including legacy Secure cookies, refresh, tabs, reconnect, port isolation, MFA, expiry, restart and owner recovery.
