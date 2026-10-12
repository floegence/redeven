---
type: Authentication Contract
title: Local ChatGPT plan authentication
description: Admit official ChatGPT sign-in only through verified local host access and preserve provider history, credentials and billing choice.
tags: [ai, flower, authentication, openai, desktop, security]
timestamp: 2026-10-12T00:00:00Z
---

# Summary

OpenAI connections have one active authentication method: API key or ChatGPT
account. Omitted authentication fields retain API-key behavior. ChatGPT uses
OpenAI's public open-source sign-in and `/v1/responses` contracts; it never reads
Codex credentials or calls a private ChatGPT backend. Floret v7.29.2 owns the
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

The protected secrets file migrates contiguously from version 0 to 1 to 2,
retaining API keys; future schemas fail without mutation. Runtime and Desktop
share the same resolver and store. An in-process mutex plus OS file lock
serializes rotating refresh across processes, including atomic 0600 replacement.
Refresh omits scopes and honors `earliest_refresh_at`. Transient failures retain
credentials. Terminal refresh errors clear tokens while preserving registration
and host identity. Sign-out clears local tokens and reports unconfirmed remote
revocation. A failed account/configuration save retains the current configured
binding and keeps the verified attempt available for retry.

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

Runtime/Desktop compatibility epoch 53 and provider-bundle
`auth_schema_version: 1` prevent an old client from erasing a saved account method.
Old API-key-only saves remain supported.

# Evidence

- `redeven:internal/chatgpt/client.go` - Registration, identity verification, ephemeral attempts and refresh.
- `redeven:internal/chatgpt/client_test.go` - Ownership, late callback, reconsent, cross-process refresh and failure recovery.
- `redeven:internal/settings/chatgpt_secrets.go` - Protected registration and serialized atomic updates.
- `redeven:internal/codeapp/appserver/chatgpt_auth.go` - One trusted local capability and authorization boundary.
- `redeven:internal/localui/local_runtime_browser_test.go` - Native handoff, public spoof rejection and exact authority.
- `redeven:internal/ai/model_gateway_chatgpt.go` - Responses namespace and canonical native replay.
- `redeven:internal/ai/model_gateway_chatgpt_floret_test.go` - Published-engine tool history, restart and compaction.
- `redeven:internal/envapp/ui_src/src/ui/FlowerProviderDialog.chatgpt.browser.test.tsx` - Themes, narrow translations, disabled keyboard behavior, cancellation and preserved drafts/focus.
- [Official open-source sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in).
- [Preview request limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
- [Official UI guidelines](https://developers.openai.com/siwc/ui-ux-guidelines).
