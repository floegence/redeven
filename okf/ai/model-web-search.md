---
type: AI Capability Contract
title: Model web search
description: Resolve reviewed model search capabilities consistently across settings, admission, and provider transport.
tags: [ai, models, search, providers]
timestamp: 2026-10-05T00:00:00Z
---

# Summary

Redeven owns reviewed model search availability, endpoint and credential policy, and admission mapping into published Floret hosted tools. UI badges and actual tools must resolve through the same authority. Unsupported or unintegrated models cannot inherit search from their provider brand; provider rejection stays an execution error without a substitute implementation. Floret preserves the admitted Turn's canonical provider state.

# Contract

Search reviews in `scripts/model-catalog/overrides.json` enumerate wire model IDs,
status (`supported`, `unsupported`, or `not_integrated`), official source URLs,
and a review date. Supported entries identify an existing adapter protocol.
`unsupported` requires explicit supplier evidence; an unimplemented integration
uses `not_integrated`. Generation rejects missing reviews, unknown or mismatched
protocols, duplicate IDs, and missing evidence. No newly shipped model silently
inherits a disabled search default. Review the complete tool compatibility table;
accepting Responses syntax or HTTP 200 does not prove hosted execution. Before
marking a new search integration supported, qualify a real search result or
hosted event through normal Turn admission. If that fails, resolve the discrepancy
before enabling the capability. DeepSeek explicitly ignores built-in search, so
its reviewed models use `unsupported` and its adapter cannot declare hosted search. Extra reviewed snapshot IDs preserve already
supported Qwen configurations. User-owned OpenAI models retain the existing
official-endpoint search contract; compatible endpoints retain their explicit
`disabled`, `openai_builtin`, and `brave` choices.

`config.ResolveAIWebSearch` is the pure authority for catalog, wire identity,
endpoint, configuration, and Brave credential presence. `/api/ai/models` and
`/api/ai/model_catalog` expose only readonly `web_search.status` and
`web_search.reason`. Stable unavailable reasons distinguish `unsupported`,
`not_integrated`, `not_configured`, `needs_credentials`, and
`endpoint_not_supported`. Protocol names belong in internal diagnostics.

Turn preparation uses the same resolution to build its tools. All native search
modes become Floret `HostedToolDefinition`; Brave remains a local tool under
existing permission and credential checks. The prompt reads this final local and
hosted tool surface, distinguishing URL discovery from `web_fetch`. Adapters
render only the request's tools. Transport selection is independent of search in
one request, so automatic titles omit search without changing protocol. Attachment
routing shares that transport decision. Floret owns immutable provider checkpoints. Model, reasoning and hosted search
retain their Turn configuration across continuation and recovery; local tools
and permission instructions refresh from current thread policy. A new Turn
resolves current configuration.
Floret canonical user retry admits a new Turn, so it also resolves current
configuration. A restored native wire shape retains its required transport even
if search settings changed while the earlier Turn was waiting.
Provider rejection remains a real error, without a substitute search implementation.
A native tool returned as a local function call fails explicitly before local
dispatch. Tool restrictions apply to both local and hosted definitions.

Both hosts use the shared badge, availability type, and localized reason labels.
Settings aggregate actual model projections; brands and label existence never
imply support. Missing search credentials do not prevent ordinary chat or model
switching. Readonly projections are stripped from persisted selection preferences.
`web_search.config` records model and wire identity, reviewed and effective state,
mode, transport, and the disabling reason using the existing diagnostic channel.

# Boundaries

Model discovery and user-selected membership remain owned by [Model directory and selection](model-directory-and-selection.md).

# Evidence

- `redeven:internal/config/ai_web_search.go` - Search resolution and stable protocol selection.
- `redeven:internal/ai/web_search_turn_integration_test.go` - Normal admission through captured provider HTTP, including Vision image search and aliases.
- `redeven:scripts/model-catalog/test_generate.py` - New-model and invalid-review rejection.
