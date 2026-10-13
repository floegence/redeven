---
type: Authentication Contract
title: ChatGPT account lifecycle
description: Persist verified local sign-ins, reuse issued registrations and complete renewal, cancellation and logout independently of connection editing.
tags: [ai, flower, authentication, openai, runtime, security]
timestamp: 2026-10-13T00:00:00Z
---

# Summary

Redeven's canonical protected account store owns verified ChatGPT registrations
and sessions. OAuth completion persists sign-in independently of connection
editing; identity-only grants never admit inference. Retry reuses issued client
identity with fresh OAuth inputs. Renewal and logout serialize rotating tokens.
Cancellation never installs usable credentials after its commit boundary, and
interrupted cleanup uses the existing durable logout journal. Storage failure
stops account use; local cleanup and remote revocation remain separate outcomes.
Local admission is owned by the [authentication contract](chatgpt-local-authentication.md).

# Contract

## Sign-in and registration

One `chatgpt.Client` owns bounded, five-minute in-memory attempts. The listener
binds a random `127.0.0.1` port before opening the system browser. Each attempt
has fresh state, nonce and S256 PKCE. Dynamic registration uses
`dynamic_agent_client`, the Redeven name hint and a persisted host UUID; only the
issued client ID is retained for code-exchange recovery. OIDC discovery and JWKS verify
signature, issuer, audience, expiry, nonce and subject.

A verified OAuth result is committed immediately to the canonical local account
store, including a valid identity-only grant without ChatGPT plan permission.
Connection editing selects an account; it never owns another credential draft.
Closing the dialog keeps a completed sign-in. Explicit sign-out revokes it.
Changing accounts does not replace the configured binding until the connection
save succeeds. Missing plan permission prevents inference; reconsent uses the
saved issued client ID and the complete scope set with supported prompt=consent.
A failed code exchange retains its issued client ID for the same bounded attempt;
retry opens a fresh authorization with new state, nonce, PKCE and one-time code.

Closing the dialog, changing providers or authentication, changing trusted
connection bindings, or losing the admitted channel cancels incomplete attempts.
A per-attempt commit lock orders cancellation against the short atomic credential
write, without holding the attempt-map mutex during disk or network operations.
An accepted exchange completes within a bounded deadline even after cancellation
so received tokens can be revoked. Rejected identity or installation also revokes
received refresh tokens. A canceled, verified new registration uses the existing
durable signing_out journal, so startup can finish interrupted cleanup; it is
never installed as usable. Cleared registration records retain remote revocation
confirmation for local review. Existing sessions are not overwritten by cleanup.
Late callbacks cannot install usable credentials after cancellation or
restore a newer logout. Failed revocation is reported independently of sign-in.
Changing the trusted binding closes the old editor and invalidates its pending
account-list and model-discovery results. UI responses never contain tokens,
client IDs, token hints, PKCE secrets, subjects or authorization URLs.

The trusted local account list projects all saved registrations separately from
provider-bound statuses, including signed-out accounts after the last connection
is removed. Same-email registrations remain distinct by opaque account ID and
are labeled distinctly in the picker. Choosing a saved registration does not
start OAuth; a signed-out selection reauthorizes with its retained client ID.
Adding another account explicitly creates a new registration. Saved unbound
accounts support the same local sign-out, acknowledgement and retry actions.

The protected secrets file migrates contiguously from version 0 to 1 to 2 to 3,
retaining API keys and verified registration; future schemas fail without mutation.
The canonical account retains logout intent, session identity, terminal reason,
shared retry time and revocation confirmation. Retry counts and cancellation
handles remain in memory. Interrupted logout is completed at startup; normal
maintenance scans never clear a live logout.

## Renewal and credential coordination

[Account maintenance](../../internal/chatgpt/lifecycle.go) starts with the Runtime
service, independently of AI readiness, connection bindings and open windows.
Every saved sign-in counts once per account, including unbound and identity-only
grants. Incomplete OAuth attempts are excluded. Runtime shutdown cancels maintenance without signing out and never
schedules OS background work. A one-second wake detects configuration changes,
clock resume and peer-written credential facts. Refresh runs at expiry minus two
minutes and 0–30 seconds of deterministic jitter, respecting earliest refresh.
It uses the issued client ID, latest refresh token and public resource, omitting
scope. New ID tokens undergo OIDC verification; an old ID token's expiry alone
never ends a session.

Each account has an OS operation lock for refresh, installation and revocation.
The global file lock covers only canonical reads and atomic 0600 replacement,
never a network request. Rotation results compare the exact source credentials
before installation, retaining a concurrent logout's intent. Failed replacement
writes retry briefly, then deny use while retaining the latest replacement and
operation lock for repair or revocation. Old refresh tokens are never retried
while that replacement awaits storage.

Network failures, 429 and 5xx preserve credentials, use 15/30/60/120/300-second
backoff and respect Retry-After. Canonical retry time prevents another process
from bypassing the same failure. Valid access may continue; expired access cannot
dispatch. Ordinary 401 and invalid-user responses retain tokens and report review,
with safe status/code/request-ID evidence bound to the exact bearer sent. Only
terminal refresh rejection clears tokens and requires authorization. Models,
settings, discovery and execution consume one credential state projection.
Account updates use model_directory.changed and merge independently of drafts.

## Logout and connection changes

Sign-out first records intent and stops related tasks through Floret's existing
immediate Cancel with descendants. The private Desktop model source observes
current account facts once per second and passes confirmed account stop reasons
to its owning Runtime; it never owns another task lifecycle. Logout waits for any
rotation, revokes the latest refresh token at the trusted issuer's advertised
HTTPS endpoint, then clears access/refresh/ID tokens, scopes and expiry. Revocation
tries network/5xx failures at most three times, with 0.5/1.5-second delays within a
15-second budget. Local cleanup and remote confirmation have independent results.
Registration and stable host ID remain. UI closure does not cancel accepted logout.

Configuration validates canonical accounts before writing, preserves its existing
configuration/API-key rollback, and never reinstalls OAuth credentials. Failed
connection saves leave verified sign-ins available in the saved account picker.
Only successful saves sign out orphaned old accounts; removing one shared binding
or pausing connections retains login. Final removal retains the registration for
future account selection and reauthorization.
An explicit empty provider list can clear the final connection. Removal clears
the selected draft model when it belonged to that connection; absent providers
remain invalid.
The local account API enforces the
[verified-host admission contract](chatgpt-local-authentication.md#local-host-admission).
Compatibility epoch 56 covers the additive shared UI and private Desktop source
contracts; Floret's public API and domain migration remain unchanged.

# Evidence

- `redeven:internal/chatgpt/client.go` - Bounded OAuth attempts, verified credential commit, issued-client recovery and canceled-session cleanup.
- `redeven:internal/chatgpt/account_lifecycle_contract_test.go` - Repeated code failures, identity-only persistence, cancellation during exchange/installation, unconfirmed revocation and unbound renewal.
- `redeven:internal/chatgpt/lifecycle_test.go` - Clock resume, cross-process rotation, logout races, storage faults and startup recovery.
- `redeven:internal/settings/chatgpt_secrets.go` - Stable host identity and atomic protected account writes.
- `redeven:internal/codeapp/appserver/chatgpt_registry_test.go` - Saved unbound registrations, distinct same-email identities, safe projections and local management.
- [Official open-source sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in).
- [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).
- [Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery).
