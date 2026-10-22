---
type: Authentication Contract
title: Local ChatGPT plan authentication
description: Admit official ChatGPT sign-in only through verified local host access and preserve provider history, credentials and billing choice.
tags: [ai, flower, authentication, openai, desktop, security]
timestamp: 2026-10-14T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

OpenAI connections have one active authentication method: API key or ChatGPT
account. Omitted authentication fields retain API-key behavior. ChatGPT uses
OpenAI's public open-source sign-in and `/v1/responses` contracts; it never reads
Codex credentials or calls a private ChatGPT backend. Floret v7.30.0 owns the
engine, canonical conversation, provider-state lifecycle and compaction. Redeven
owns account admission, protected credentials, provider configuration and UI.
Verified local admission is mandatory, billing choice never changes silently,
and private or remote callers cannot obtain account credentials. Account-lifecycle
failures remain explicit through the canonical owner linked below.

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

- `redeven:internal/ai/model_gateway_strict_test.go` - Real Flower strict wire contract, optional argument restoration and frozen-request rules.
