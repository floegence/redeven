---
type: Security Contract
title: Runtime two-factor authentication
description: Configure independent environment TOTP, sign in, recover access, and revoke ordinary sessions without changing SSH authentication.
tags: [security, authentication, runtime, desktop, totp]
timestamp: 2026-09-23T00:00:00Z
---
# Summary

Runtime `accessgate` owns environment authentication independently of Redeven Cloud. Enabling two-factor authentication requires the environment password followed by a TOTP or single-use recovery code for ordinary browser, direct URL, and Cloud data sessions. A password-only challenge grants no file, terminal, editor, plugin, or forwarding access. Authenticated native/SSH management retains its separate private host authority; loopback addresses, Cloud administrator claims, and forwarded headers do not establish that authority. Missing or damaged committed authentication state fails closed. Host recovery locks ordinary access until a new password and authenticator are committed.

# Enrollment and management

Desktop Environment Settings / Access presents one two-factor row. A running Runtime is required for Desktop management. If a different environment password has been saved for the next start, restart before configuring MFA; the old running verifier cannot overwrite the newer saved authority. Security operations take effect immediately and never save a pending address/certificate draft. Apply HTTPS and restart before enrollment: the owner endpoint checks the running public listener, and MFA-enabled startup rejects a public HTTP listener. The independently authenticated private bridge retains its isolated transport.

Desktop reads `https_ready` from the owner security response before offering enrollment. It reflects the running public listener, never the private bridge URL or the saved HTTPS draft. HTTP environments show an inline HTTPS prerequisite with a direct **Configure HTTPS** action instead of a password form. That action selects HTTPS and moves keyboard focus to the existing connection-security section; it does not create a certificate, save settings, or restart automatically. Guidance uses the existing certificate and **Save and restart** controls. A confirmed HTTPS status after restart returns focus to two-factor setup. Ordinary snapshot refreshes retain this guidance. Servers without a valid readiness field require a Runtime update; Desktop never guesses eligibility. The projection is additive to the owner response and does not change compatibility epoch 32, authentication payloads, or server-side enforcement.

Security failures use a themed, icon-marked inline alert above the active form. A late HTTPS rejection closes the obsolete credential form and restores the actionable prerequisite. Secrets are discarded, and writes are never automatically replayed.

First enrollment uses the existing environment password verifier. If none exists, the owner sets an environment password. Scan the Runtime-generated QR in an authenticator, or reveal the manual key; enter its six-digit code. The two-step enrollment view distinguishes authenticator connection from recovery-code storage. A single paste-friendly numeric input preserves leading zeroes; verification requires an explicit action. Manual keys stay collapsed until requested. The next view shows eight numbered recovery codes with copy-success feedback and download actions. The setting row wraps as a complete identity/control group, and the modal retains readable spacing at 320px in light and dark themes. Copy/download and acknowledge saving them, then enable. Merely generating or verifying a pending authenticator does not change active protection. Pending operations expire after five minutes and are bound to the owner control service and exact operation. Replacing an authenticator retains the previous one until commit.

Changing an authenticator, replacing recovery codes, and turning MFA off require the current environment password and a fresh factor. Verification authorizes only that pending operation; the commit does not ask for the same already consumed code again. Ordinary environment login cannot call `POST /v2/runtime/security`; only the existing private Runtime control authority exposes that route. A loopback address alone is insufficient. Password and HTTP downgrade changes through next-start settings are rejected while MFA is active. Disable MFA through its authenticated operation before changing that password, or use explicit host recovery to replace lost credentials.

## Headless owner workflow

Run these commands as the owner of the exact Runtime state directory, locally or through authenticated SSH. Stop that Runtime first so the command can acquire its state lock:

```sh
redeven security setup --state-root /path/to/environment --recovery-file /private/new-recovery-codes.txt
redeven security recover --state-root /path/to/environment
```

Setup requires saved HTTPS configuration. It reads secrets from an attached terminal, shows a manual authenticator key only on that terminal, verifies a code, writes a new recovery file with exclusive creation and mode 0600, and requires explicit activation. It never prints secrets into redirected stdout or accepts them as command arguments. Recovery requires explicit confirmation and sets `recovery_pending`; it does not downgrade to password-only access. Run setup again to set a new password and authenticator before restarting ordinary access. These commands do not alter SSH keys, sshd policy, PAM, host passwords, or execution identity.

# Sign-in and session contract

The gate alone decides channel authorization when registering the channel and its lifetime cancellation callback under one lock. Callers supply verified private-management identity or an ordinary login session ID, never an `unlocked` assertion. Without authentication, ordinary channels remain registered and authorized with no authentication expiry timer; enabling protection revokes those existing channels. Trusted private-management channels retain their independent authority and have no ordinary login deadline. With authentication enabled, a direct channel requires a currently valid local login and inherits that login's exact deadline; registration cannot create or extend authorization. Direct activation rejects missing, revoked, expired, or cancelled access before announcing plugin readiness. Remote channels may remain connected while locked to complete authentication, but their business resources stay denied. Revocation and expiry always reach the callback registered with the channel; there is no separate lifetime-binding phase or authorization inference from a nonempty session ID.

Password success creates a five-minute authentication-only challenge. Local browser challenges bind a separate Secure/HttpOnly/SameSite cookie; encrypted remote challenges bind the Runtime-verified channel. The same form accepts an authenticator or recovery code. A successful retry of the same live challenge returns the original session result instead of consuming a second factor. Changing the challenge, IP, or channel does not reset factor throttling.

Ordinary access sessions have a twelve-hour absolute lifetime. Resume and child connections do not extend it. Cookies are HttpOnly, Secure on public TLS, and same-site. Header-based resume remains supported; full access credentials are never accepted from URL query parameters. Same-origin editor resources use the established cookie. Native remote editors consume a 30-second, one-shot delegation for their exact environment, owner, and CodeSpace, then receive an exact-scope resume credential bounded by the parent deadline. Each child still checks its own effective read/write/execute permissions. A parent logout revokes its descendants. Bookmarked CodeSpace and Web Service pages render the same Runtime-owned authentication gate before any resource data is forwarded. Direct URLs authenticate with the same-origin challenge cookie; isolated remote origins receive only an exact-resource resume credential held in session storage. Such a grant cannot authenticate the Env App, another resource, user, or environment. Unauthenticated static asset access terminates in the embedded Runtime UI rather than forwarding resource-owned paths.

MFA enable/replace/disable, recovery-code rotation, and owner recovery invalidate ordinary sessions, challenges, delegations, accepted/pending artifacts, plugin authority, and open data streams. Native host management remains scoped to its own authenticated bridge. Revocation cancels access/observers and preserves the existing background-task lifecycle. Runtime restart clears in-memory sessions and incomplete operations; it preserves committed authentication state.

# Persistence, replay and recovery

`access-auth.sqlite` is a versioned, private SQLite authority, separate from the transport authorization database. Startup imports the existing bcrypt verifier once. The complete credential state is AEAD encrypted under the independent private `access-auth.key`, with environment/schema binding. The committed database and initialized key become the sole authority; deletion, malformed data, unsafe modes, symlinks, unknown schema, or key loss cannot fall back to the retired verifier. The old verifier is removed only after the encrypted authority commits. Keep the original complete state for recovery from storage damage; do not delete authentication files to repair an environment.

TOTP uses published `pquerna/otp` with 20 random secret bytes, HMAC-SHA-1, six digits, 30-second steps, and at most one neighboring step. Runtime persists the greatest accepted step and a code fingerprint covering the full live window, including adjacent-step collisions. A clock rollback cannot clear consumption state. Factor consumption and recovery-code removal use a generation-checked atomic database update. Eight recovery codes each contain 128 random bits; only salted hashes are retained. Recovery replaces the second factor for one sign-in and does not disable MFA or grant management authority.

Factor failures and cooldowns persist across restart. A challenge allows at most five failures. Owner-wide cooldown grows through 30 seconds, one minute, two minutes, five minutes, and fifteen minutes; correct passwords do not reset factor failures. Pending challenge and management capacities are bounded. Enrollment/changes, factor success/failure, recovery use, and host recovery log only non-secret event, method, credential identity, and revision metadata.

Independent key encryption limits exposure from a database-only disclosure. It does not protect against the same host account, root, an already compromised client, full state theft/rollback, or live phishing. MFA neither changes permissions nor isolates an already authorized shell from the host state it can access. Authentication state and secrets are not diagnostic export inputs.

# Evidence

- `redeven:internal/accessgate/authentication_test.go` - Exercises real codes, replay, restart, recovery consumption, throttle persistence, collisions, revocation and child scope.
- `redeven:internal/accessgate/channel_registration_test.go` - Verifies open-access registration, authentication activation, inherited deadlines, revocation, and remote MFA admission.
- `redeven:internal/agent/local_direct_test.go` - Rejects unauthorized or cancelled direct activation before plugin readiness.
- `redeven:internal/localui/localui_e2e_test.go` - Shares the real gate between Local UI and Agent and exercises persistent RPC, HTTP, event streams, and independent browser sessions.
- `redeven:internal/accessgate/store_test.go` - Verifies interrupted migration, read-only startup probes, fail-closed corruption/schema checks and denied writes.
- `redeven:internal/accessproxy/authentication_test.go` - Proves a password-only remote challenge cannot reach business routes or delegate an editor.
- `redeven:internal/accessgate/store.go` - Owns encrypted schema initialization, migration and generation-checked persistence.
- `redeven:internal/localui/runtime_security_test.go` - Exercises private management admission, actual-listener HTTPS, two-step public authentication and response-loss retry.
- `redeven:internal/agent/native_codespace.go` - Applies the shared authentication contract before editor streams.
- `redeven:desktop/src/welcome/TwoFactorSettings.client.test.tsx` - Verifies HTTPS preflight, stale enrollment rejection, scan, save-code acknowledgement, commit and unavailable status.
- `redeven:desktop/src/welcome/EnvironmentAccessSettingsForm.client.test.tsx` - Exercises HTTPS navigation, explicit certificate preparation, save/restart, and focus returning only after actual readiness.
- `redeven:desktop/scripts/check-two-factor.mjs` - Checks the real browser setup flow, password confirmation and 320px layout.
- `redeven:internal/envapp/ui_src/src/ui/EnvironmentAccessGate.browser.test.tsx` - Checks keyboard operation, leading zeroes, recovery input, locales and viewport sizes.
- `redeven:internal/envapp/ui_src/src/ui/ResourceAccessGate.browser.test.tsx` - Verifies isolated-resource factor completion, scoped resume and local cookie transport.
- `redeven:cmd/redeven/security.go` - Implements terminal-only owner setup and recovery.
