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
Verified local admission is mandatory, billing choice never changes silently,
and private or remote callers cannot obtain account credentials. Account-lifecycle
failures remain explicit through the canonical owner linked below.

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

## Account lifecycle

The [ChatGPT account lifecycle](chatgpt-account-lifecycle.md) is the canonical
owner of registration, verified sign-in persistence, issued-client retry,
local saved-account selection, renewal, cancellation cleanup and logout.
Provider configuration binds canonical account IDs; it never owns OAuth tokens
or a credential draft. The local account API and every mutation retain the
verified-host/admin admission described above. Connection saves and explicit
logout have separate results.

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

Native web search uses the current `web_search` tool contract. Completed output
items retain their original provider bytes in output-index order. The terminal
response may omit its output snapshot; it still must reach `response.completed`.
When both item events and a terminal snapshot are present, they must agree.
Missing indices, conflicting items and oversized output fail without committing
provider state. Native history is never reconstructed from text deltas.

Per-tool `Strict` intent survives the internal Runtime/Desktop model-source DTO.
The OpenAI adapter copies canonical schemas before freezing the request, makes
all object properties required, and gives originally optional non-nullable
fields a null alternative. Objects and array elements are recursive; enum and
existing nullable restrictions remain intact. Open objects, references and
unsupported composition keywords fail preparation explicitly, without switching
strict mode off or acquiring remote schemas. Configured non-strict policies stay
explicit.

Each frozen request owns its argument-restoration rules. Streaming completion and
final tool calls remove only synthetic nulls, before Floret canonical validation.
Original null, false, zero and empty strings remain values. Malformed argument
JSON fails the model-source contract. Native output retains original provider
bytes, while canonical tool arguments and replay fingerprints use restored
values; restart, continuation and compaction retain one canonical meaning.

HTTP and stream errors become a bounded `redeven_provider_failure_v1` envelope
before entering Floret's existing failure record. It retains sanitized status,
code, parameter path, request ID and response shape, never upstream prose,
credentials, request payloads or response bodies. Standard API errors, detail
objects, empty/non-JSON bodies and SDK stream errors share this boundary. One
product projection reads canonical failures after live updates or restart,
classifies recovery actions and publishes collapsed, copyable diagnostics. Old
uncoded failures receive controlled guidance without fabricated evidence.

The composer has no permanent plan-allowance notice. Provider settings retain
[Manage usage](https://chatgpt.com/settings/usage), and the initial account
confirmation explains eligible plan usage once before enablement. Explicit usage
limit errors expose Manage usage; temporary usage/service failures offer deliberate
later retry without assuming a whole-plan limit or reset time. The
first-use confirmation stays in the existing provider modal with a Got it action.
Missing permission and expired credentials direct users to provider settings. No error
silently switches authentication or API billing.

# Boundaries

Floret owns canonical conversation, engine execution and opaque provider state.
Redeven owns local account admission, credentials and product configuration;
account fields never become engine domain records or a remote credential source.

Runtime/Desktop compatibility epoch 57 and provider-bundle
`auth_schema_version: 1` prevent an old client from erasing a saved account method.
Old API-key-only saves remain supported.

# Evidence

- `redeven:internal/codeapp/appserver/chatgpt_auth.go` - Trusted local admission for account access and management.
- `redeven:internal/localui/local_runtime_browser_test.go` - Native handoff, public spoof rejection and exact authority.
- `redeven:internal/ai/model_gateway_strict_test.go` - Real Flower strict wire contract, optional argument restoration and frozen-request rules.
- `redeven:internal/ai/provider_failure_test.go` - HTTP/stream evidence, bounded diagnostics and credential-leak rejection.
- `redeven:internal/ai/model_gateway_chatgpt.go` - Responses namespace and canonical native replay.
- `redeven:internal/ai/model_gateway_chatgpt_floret_test.go` - Published-engine tool history, restart and compaction.
- `redeven:internal/envapp/ui_src/src/ui/FlowerProviderDialog.chatgpt.browser.test.tsx` - Shared local UI, translations, cancellation and preserved selection/focus.
- [Official model and request contract](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).
- [Preview request limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
- [Official UI guidelines](https://developers.openai.com/siwc/ui-ux-guidelines).
