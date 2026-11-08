---
type: Authentication Contract
title: Local ChatGPT admission and account lifecycle
tags: [ai, flower, authentication, openai, runtime, security]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Authenticated local capability and verified account facts govern ChatGPT registration, renewal and requests. Interrupted logout is completed at startup; normal maintenance scans never clear a live logout. Account updates use model_directory.changed and merge independently of drafts.

# Contract

## Account lifecycle
### Sign-in and registration
One `chatgpt.Client` owns bounded, five-minute in-memory attempts.

### Renewal and credential coordination
[Account maintenance](../../internal/chatgpt/lifecycle.go) starts with the Runtime service, independently of AI readiness, connection bindings and open windows. Runtime shutdown cancels maintenance without signing out and never schedules OS background work.

### Logout and connection changes
Sign-out first records intent and stops related tasks through Floret's existing immediate Cancel with descendants. The private Desktop model source observes current account facts once per second and passes confirmed account stop reasons to its owning Runtime; it never owns another task lifecycle.

The Runtime Service protocol, secrets schema, Floret public API and domain migration remain unchanged.

## Local admission
### Local host admission
The authenticated Runtime settings response publishes `auth_capabilities` with an `openai_chatgpt` availability, disabled reason and connection binding. Desktop identity, loopback URL text, renderer headers and client declarations cannot establish local access.

That source executes against the local account store; the remote settings page exposes no account login, credential transfer or account email.

### Account lifecycle
The [ChatGPT account lifecycle](#account-lifecycle) is the canonical owner of registration, verified sign-in persistence, issued-client retry, local saved-account selection, renewal, cancellation cleanup and logout. Connection saves and explicit logout have separate results.

### Model and request contracts
The public account model endpoint's listed models preserve server order and are intersected with reviewed adapter capabilities. ChatGPT connections reject custom endpoints, API credentials and custom model declarations.

No error silently switches authentication or API billing.

# Boundaries

This concept owns local registration and credential lifecycle. Connection configuration stores only account bindings; it cannot commit or roll back OAuth tokens. Cancellation cleanup may retain a verified signed-out registration, and remote revocation failure never becomes confirmed success.

Floret owns canonical conversation, engine execution and opaque provider state.

Old API-key-only saves remain supported.

# Evidence

- `redeven:internal/chatgpt/client.go` - Source.
- `redeven:internal/chatgpt/account_lifecycle_contract_test.go` - Tests.
