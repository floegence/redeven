---
type: Security Contract
title: Runtime access sessions
description: Keep browser sign-in continuous across refresh while enforcing one absolute session lifetime and Runtime-owned Cookie scope.
tags: [security, authentication, runtime, desktop, cookies]
timestamp: 2026-09-23T00:00:00Z
---
# Summary

Runtime `accessgate` is the sole authority for ordinary session validity and revocation. A valid browser session survives refresh, new tabs and temporary disconnects without another password prompt. Cookie names isolate HTTP, HTTPS and Runtime ports; they never grant or extend authorization. Expiry, logout, security changes and Runtime restart require authentication again. Invalid authorities and incompatible Desktop peers fail closed. [Runtime two-factor authentication](runtime-two-factor-authentication.md) owns credential persistence, factor verification and owner management.

# Contract

## Session authority and lifetime

The gate alone decides channel authorization when registering the channel and its lifetime cancellation callback under one lock. Callers supply verified private-management identity or an ordinary login session ID, never an `unlocked` assertion. Without authentication, ordinary channels remain registered and authorized with no authentication expiry timer; enabling protection revokes those existing channels. Trusted private-management channels retain their independent authority and have no ordinary login deadline. With authentication enabled, a direct channel requires a currently valid local login and inherits that login's exact deadline; registration cannot create or extend authorization. Direct activation rejects missing, revoked, expired, or cancelled access before announcing plugin readiness. Remote channels may remain connected while locked to complete authentication, but their business resources stay denied. Revocation and expiry always reach the callback registered with the channel; there is no separate lifetime-binding phase or authorization inference from a nonempty session ID.

When MFA is enabled, password success creates a five-minute authentication-only challenge. Local browser challenges bind a separate Cookie with the transport attributes below; encrypted remote challenges bind the Runtime-verified channel. The same form accepts an authenticator or recovery code. A successful retry of the same live challenge returns the original session result instead of consuming a second factor. Changing the challenge, IP, or channel does not reset factor throttling.

Ordinary access sessions have a twelve-hour absolute lifetime. Resume and child connections do not extend it. Header-based resume remains supported; full access credentials are never accepted from URL query parameters. Same-origin editor resources use the established cookie. Native remote editors consume a 30-second, one-shot delegation for their exact environment, owner, and CodeSpace, then receive an exact-scope resume credential bounded by the parent deadline. Each child still checks its own effective read/write/execute permissions. A parent logout revokes its descendants. Bookmarked CodeSpace and Web Service pages render the same Runtime-owned authentication gate before any resource data is forwarded. Direct URLs authenticate with the same-origin challenge cookie; isolated remote origins receive only an exact-resource resume credential held in session storage. Such a grant cannot authenticate the Env App, another resource, user, or environment. Unauthenticated static asset access terminates in the embedded Runtime UI rather than forwarding resource-owned paths.

MFA enable/replace/disable, recovery-code rotation, and owner recovery invalidate ordinary sessions, challenges, delegations, accepted/pending artifacts, plugin authority, and open data streams. Native host management remains scoped to its own authenticated bridge. Revocation cancels access/observers and preserves the existing background-task lifecycle. Runtime restart clears in-memory sessions and incomplete operations; it preserves committed authentication state.

## Browser Cookie scope and continuity

Local UI alone issues, reads and clears `redeven_local_access_<http|https>_<port>`. Protocol comes from the actual connection and port from the validated request authority, including default ports 80/443 and bracketed IPv6. Forwarded headers cannot select the scope. Cookies remain host-only, HttpOnly, SameSite=Lax, path `/`, and Secure on TLS, with the gate's absolute expiry. The five-minute MFA challenge uses `redeven_auth_challenge_<http|https>_<port>`, path `/api/local/access`, HttpOnly, SameSite=Strict and Secure on TLS.

The scheme/port suffix prevents a retained HTTPS Secure cookie from blocking an HTTP login and prevents one Runtime's login or logout from replacing another port's cookie. Cookie names prevent browser storage collisions, not cross-port security isolation: cookies are still host-scoped. Every protected request must pass the gate and existing authority, origin and permission checks.

The retired fixed names are never authentication inputs. There is no dual read, dual write or migration fallback. Historical cookies naturally expire; users need not clear site data. The Env App resume token remains page-memory-only. Reload restores access from the valid cookie; recovery, reconnection and resource access cannot renew the deadline. Session loss prompts sign-in without marking the password field invalid. Only an incorrect password or factor produces input validation feedback; transport failures and cooldowns retain their own messages.

## Desktop consumption and forwarding

Desktop Flower retains the complete Runtime-issued access-cookie `name=value` pair and returns it unchanged. The native CodeSpace descriptor supplies `access_cookie_name`; Desktop validates that contract and queries its Electron session by that name. It never derives the name from a bridge or forwarded client port. Native forwarding removes all cookies in the reserved access/challenge namespaces, including retired names, before reaching the editor. Recognition for stripping never permits legacy authentication.

Compatibility epoch 33 requires these synchronized Runtime/Desktop consumers. Epoch 32 and earlier supported peers use the existing upgrade path; the Runtime Service compatibility manifest is authoritative. No upstream platform capability changes are required for this product authentication policy.

# Boundaries

Cookies isolate presentation scopes but cannot extend or create authorization. Expiry, logout, security changes and Runtime restart require authentication again. Invalid authorities and incompatible Desktop peers fail closed through accessgate.

# Evidence

- `redeven:internal/localui/access_cookie.go` - Owns name derivation, attributes and exact-scope deletion.
- `redeven:internal/localui/access_cookie_test.go` - Covers validated/default/IPv6 authorities, ignored forwarded headers and rejected foreign or retired names.
- `redeven:internal/localui/access_cookie_browser_test.go` - Runs production Go handlers and isolated state with real Chromium cookie storage, including legacy Secure cookies, refresh, tabs, reconnect, port isolation, MFA, expiry, restart and owner recovery.
- `redeven:scripts/check_renderer_e2e.sh` - Includes the browser regression in renderer acceptance.
- `redeven:internal/accessgate/accessgate_test.go` - Checks absolute expiry, resume identity and lineage revocation.
- `redeven:internal/accessgate/channel_registration_test.go` - Enforces inherited channel deadlines and cancellation.
- `redeven:internal/localui/native_codespace_test.go` - Checks permissions, descriptor naming, revocation and credential stripping.
- `redeven:desktop/src/main/localAccessCookie.test.ts` - Checks complete-pair retention and rejects unsafe or ambiguous credentials.
- `redeven:desktop/src/main/codespaceNativeRoute.test.ts` - Checks Runtime-provided names across private and forwarded transports.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.localAccess.e2e.test.tsx` - Distinguishes invalid credentials from session and connection failures.
- `redeven:internal/runtimeservice/compatibility_contract.json` - Declares current and upgrade-only peers.
