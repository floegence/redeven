---
type: Authentication Contract
title: Local ChatGPT plan authentication
description: Admit official ChatGPT sign-in only through verified local host access and preserve provider history, credentials and billing choice.
tags: [ai, flower, authentication, openai, desktop, security]
timestamp: 2026-10-13T00:00:00Z
---

# Summary

OpenAI connections have one active authentication method: API key or ChatGPT
account. Omitted authentication fields retain API-key behavior. ChatGPT uses
OpenAI's public open-source sign-in and `/v1/responses` contracts; it never reads
Codex credentials or calls a private ChatGPT backend. Floret v7.30.0 owns the
engine, canonical conversation, provider-state lifecycle and compaction. Redeven
owns account admission, protected credentials, provider configuration and UI.

# Contract

## Local host admission

The authenticated Runtime settings response publishes `auth_capabilities` with
an `openai_chatgpt` availability, disabled reason and connection binding. The
shared dialog consumes that result directly. Desktop identity, loopback URL text,
renderer headers and client declarations cannot establish local access.

Native Desktop main strips renderer-supplied host-access headers. Only the
actual local-environment native bridge adds local proof alongside its private
bridge credential. SSH, Gateway, remote Desktop, remote Web, forwarded services
and missing proof remain disabled. Start, status, cancel, reauthorization,
sign-out, acknowledgement, model discovery and provider-bundle writes enforce
this same boundary. API-key operations retain their existing permission policy.
Remote provider-bundle edits may preserve an existing account binding while
editing API-key connections. They cannot create, replace, remove, rename or copy
ChatGPT authentication, and the current authentication schema remains required.

Desktop's existing **Open in browser** action can mint a one-use, one-minute
handoff for the actual local Runtime's published origin. Redemption sets an
HttpOnly, same-site cookie bound to that exact authority. The existing access
gate and authenticated session are still required. The in-memory proof expires
and disappears on Runtime restart; it is never restored from durable session
metadata. Opening an arbitrary localhost URL does not grant local authentication.

Remote conversations may use the existing Desktop model source. That source
executes against the local account store; the remote settings page exposes no
account login, credential transfer or account email.

## Registration and credentials

One `chatgpt.Client` owns bounded, five-minute in-memory attempts. The listener
binds a random `127.0.0.1` port before opening the system browser. Each attempt
has fresh state, nonce and S256 PKCE. Dynamic registration uses
`dynamic_agent_client`, the Redeven name hint and a persisted host UUID; only the
issued client ID survives a confirmed save. OIDC discovery and JWKS verify
signature, issuer, audience, expiry, nonce and subject.

A verified account remains a draft until the provider dialog saves successfully.
Changing accounts does not replace the configured binding before verification
and save. Missing plan permission prevents enablement and reconsent reuses the
issued registration, including an unsaved verified draft. Closing the dialog,
changing providers, changing authentication, switching connection bindings or
losing the admitted channel cancels attempts. Late callbacks cannot mutate a
new environment. UI responses contain only account ID, email and readiness.
Changing the trusted connection binding closes the old dialog and clears its
draft, including any in-flight model discovery.

The protected secrets file migrates contiguously from version 0 to 1 to 2 to 3,
retaining API keys and verified registration; future schemas fail without mutation.
The canonical account retains logout intent, session identity, terminal reason,
shared retry time and revocation confirmation. Retry counts and cancellation
handles remain in memory. Interrupted logout is completed at startup; normal
maintenance scans never clear a live logout.

[Account maintenance](../../internal/chatgpt/lifecycle.go) starts with the Runtime
service, independently of AI readiness and open windows. Every saved binding,
including disabled connections, counts once per account. Unsaved OAuth attempts
are excluded. Runtime shutdown cancels maintenance without signing out and never
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

Sign-out first records intent and stops related tasks through Floret's existing
immediate Cancel with descendants. The private Desktop model source observes
current account facts once per second and passes confirmed account stop reasons
to its owning Runtime; it never owns another task lifecycle. Logout waits for any
rotation, revokes the latest refresh token at the trusted issuer's advertised
HTTPS endpoint, then clears access/refresh/ID tokens, scopes and expiry. Revocation
tries network/5xx failures at most three times, with 0.5/1.5-second delays within a
15-second budget. Local cleanup and remote confirmation have independent results.
Registration and stable host ID remain. UI closure does not cancel accepted logout.

Configuration validates candidate accounts before writing, installs them as one
atomic credential batch only after the configuration succeeds, and restores the
configuration if credential installation fails. A failed save preserves the
current binding and verified draft. Only successful saves sign out orphaned old
accounts; removing one shared binding or pausing connections retains login.
An explicit empty provider list can clear the final connection. Removal clears
the selected draft model when it belonged to that connection; absent providers
remain invalid.
The local admin GET account route shares the existing verified-host admission.
Remote and unknown callers cannot read account identity or mutate credentials.
Compatibility epoch 55 covers the additive shared UI and private Desktop source
contracts; Floret's public API and domain migration remain unchanged.

## Model and request contracts

The public account model endpoint's listed models preserve server order and are
intersected with reviewed adapter capabilities. ChatGPT connections reject
custom endpoints, API credentials and custom model declarations. New catalog
models stay unselected; unavailable selections remain explicit.
Wire-name overrides must remain in the reviewed account inventory and inherit
the target model's capabilities while preserving local identity and parameters.

Requests use full canonical input, `store: false`, streaming, developer
instructions and the `redeven` function namespace. Unsupported API parameters
and server continuation IDs are omitted. Encrypted reasoning and native output
are retained only in opaque provider state bound to exact canonical history;
compaction and changed lineage prune ineligible native records. Authentication
method and account enter state compatibility identity. API-key identities retain
their previous hash. No separate conversation store or domain migration is added.
Only a completed response commits provider state; incomplete responses, stream
errors and disconnects fail explicitly.

The composer/model selector identifies ChatGPT plan usage and links to
[Manage usage](https://chatgpt.com/settings/usage). The initial account confirmation
explains eligible plan usage once before enablement. Usage errors expose Manage
usage and later retry without assuming a whole-plan limit or reset time. The
first-use confirmation stays in the existing provider modal with a Got it action.
Missing permission and expired credentials direct users to provider settings. No error
silently switches authentication or API billing.

# Boundaries

Floret owns canonical conversation, engine execution and opaque provider state.
Redeven owns local account admission, credentials and product configuration;
account fields never become engine domain records or a remote credential source.

Runtime/Desktop compatibility epoch 55 and provider-bundle
`auth_schema_version: 1` prevent an old client from erasing a saved account method.
Old API-key-only saves remain supported.

# Evidence

- `redeven:internal/chatgpt/client.go` - Registration, identity verification, ephemeral attempts and refresh.
- `redeven:internal/chatgpt/lifecycle_test.go` - Long-running renewal, backoff, rotation/logout races, storage faults and interrupted authorization.
- `redeven:internal/chatgpt/client_test.go` - Ownership, late callback, reconsent, cross-process refresh and failure recovery.
- `redeven:internal/settings/chatgpt_secrets.go` - Protected registration and serialized atomic updates.
- `redeven:internal/codeapp/appserver/chatgpt_auth.go` - One trusted local capability and authorization boundary.
- `redeven:internal/localui/local_runtime_browser_test.go` - Native handoff, public spoof rejection and exact authority.
- `redeven:internal/ai/model_gateway_chatgpt.go` - Responses namespace and canonical native replay.
- `redeven:internal/ai/model_gateway_chatgpt_floret_test.go` - Published-engine tool history, restart and compaction.
- `redeven:internal/envapp/ui_src/src/ui/FlowerProviderDialog.chatgpt.browser.test.tsx` - Themes, narrow translations, disabled keyboard behavior, cancellation and preserved drafts/focus.
- [Official open-source sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in).
- [Token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference).
- [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).
- [Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery).
- [Preview request limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
- [Official UI guidelines](https://developers.openai.com/siwc/ui-ux-guidelines).
