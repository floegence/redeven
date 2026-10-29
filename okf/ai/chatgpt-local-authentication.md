---
type: Authentication Contract
title: Local ChatGPT plan authentication
tags: [ai, flower, authentication, openai, desktop, security]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

OpenAI uses one API-key or ChatGPT-account method; omission keeps API-key behavior. ChatGPT uses public sign-in/Responses contracts, never Codex secrets/private backend. Floret owns engine/history/provider state; Redeven owns verified local admission, protected accounts/config/UI. Billing never silently changes; callers cannot obtain credentials. Canonical lifecycle reports failures.

# Contract

## Local host admission
The authenticated Runtime settings response publishes `auth_capabilities` with an `openai_chatgpt` availability, disabled reason and connection binding. Desktop identity, loopback URL text, renderer headers and client declarations cannot establish local access.

That source executes against the local account store; the remote settings page exposes no account login, credential transfer or account email.

## Account lifecycle
The [ChatGPT account lifecycle](chatgpt-account-lifecycle.md) is the canonical owner of registration, verified sign-in persistence, issued-client retry, local saved-account selection, renewal, cancellation cleanup and logout. Connection saves and explicit logout have separate results.

## Model and request contracts
The public account model endpoint's listed models preserve server order and are intersected with reviewed adapter capabilities. ChatGPT connections reject custom endpoints, API credentials and custom model declarations.

No error silently switches authentication or API billing.

# Boundaries

Floret owns canonical conversation, engine execution and opaque provider state.

Old API-key-only saves remain supported.

# Evidence

- `redeven:internal/codeapp/appserver/chatgpt_auth.go` - Trusted local admission for account access and management.

- `redeven:internal/localui/local_runtime_browser_test.go` - Native handoff, public spoof rejection and exact authority.
