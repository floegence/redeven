---
type: Security Contract
title: Runtime access sessions
tags: [security, authentication, runtime, desktop, cookies]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Runtime accessgate alone owns ordinary validity/revocation. Valid browser sessions survive refresh/tabs/disconnect; cookie names isolate HTTP/HTTPS/ports without extending authority. Expiry/logout/security changes/restart require reauthentication. Invalid authority/incompatible Desktop fails closed; two-factor contract owns credentials and host recovery.

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

Owner-approved Web entry binds ordinary credentials and artifact/resume admission to binding revision and Center device; child artifacts add exact resource scope. Center login cannot replace Runtime accessgate or create Desktop management. [Center security](web-center-access.md) owns the independent entry authority.

Desktop Web Service handoff cookies are HttpOnly and SameSite=Strict.

Cookies isolate presentation scopes but cannot extend or create authorization.

Native transport never acquires trusted Desktop management identity.

# Evidence

- `redeven:internal/localui/access_cookie.go` - Owns name derivation, attributes and exact-scope deletion.

- `redeven:internal/localui/access_cookie_test.go` - Covers validated/default/IPv6 authorities, ignored forwarded headers and rejected foreign or retired names.
