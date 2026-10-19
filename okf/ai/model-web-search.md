---
type: AI Capability Contract
title: Model web search
description: Resolve provider and model search intent once for settings, admission, and provider transport.
tags: [ai, models, search, providers]
timestamp: 2026-10-15T00:00:00Z
---

# Summary

Redeven owns provider and model search preferences. One backend resolver supplies
settings projections and Turn preparation; the final tool surface drives prompts
and wire declarations. Floret v7.40.2 validates hosted events against the actual
frozen provider request. Undeclared hosted execution remains a provider failure
because its remote effects cannot be assumed absent.

# Contract

Provider configuration is web_search with enabled and source fields; source is
native or brave. Model intent is optional web_search_enabled in existing model
overrides or custom-model configuration. Both switches must be enabled. Missing
model intent uses the backend recommendation; explicit true or false wins without
another catalog allowlist. Authenticated account membership, adapter availability,
credentials, tool restrictions and permissions still apply.

OpenAI, including custom endpoints, Moonshot, Z.ai, DeepSeek and Qwen default provider search
on. Generic OpenAI-compatible defaults off and alone supports Brave. Unintegrated
adapters stay off and cannot be enabled. Reviewed supported models default on;
other reviewed models default off. Unknown custom OpenAI/compatible models default
on, while other custom models default off. The reviewed catalog records supplier
evidence and adapter protocols; it supplies recommendations rather than overriding
explicit preferences. DeepSeek uses the published Floret capability query for
Flash independent Search and Pro hosted search; unknown wire identities cannot
be enabled. No second host routing catalog exists.

config.ResolveAIWebSearchPolicy supplies provider defaults, the default page-reader
source and editor capability;
config.ResolveAIWebSearch resolves the configured model identity, aliases,
provider/model intent and Brave key presence. Directory responses include provider
policies and model web_search projections with status, reason,
recommended_enabled and model_enabled. Reasons identify provider or model
disablement, missing credentials, unsupported and unintegrated adapters. Frontends
do not infer support from brands, endpoints or model names. Draft changes show a
pending badge until the backend projects the saved state.

Only configuration decoding accepts the released mode shape. Startup atomically
writes the canonical shape before publishing configuration; failed persistence
publishes no upgraded configuration. Migration preserves explicit disablement,
Brave selection, keys, model selection and overrides. Runtime has one decision
path. Disabling search or changing its source retains stored keys. Only explicit
key deletion or removal of the provider deletes a stored key.

Turn preparation freezes hosted search as Floret HostedToolDefinition; Brave and
DeepSeek independent Search are native Floret local tools under existing
permission checks. With provider search enabled, an omitted page-reader setting
uses the backend default: DeepSeek Fetch for DeepSeek connections and Direct for
other connections. With search disabled, omission selects Direct. An explicit
Direct or DeepSeek Fetch choice remains authoritative across search toggles.
Source bindings live only in the canonical
first-provider surface annotations; keys resolve at dispatch. The prompt reads the final local
and hosted tools. Browser search is an alternative only when computer/browser
tools are present and the existing authorized target discovery and selection
protocol permits it. URL fetching alone cannot discover URLs. Missing local tools
receive paired model feedback; the model chooses an available alternative. The
host does not add a fallback scheduler. Permission denial, blocked URLs and
unknown tool effects retain their stop boundaries.

Waiting and running Turns keep their frozen provider configuration through
continuation and restart. New Turns and manual canonical retries resolve current
settings. Titles omit hosted tools without changing the selected Turn transport;
attachment routing uses the same transport decision. Adapters declare only the
request's hosted tools, and native events absent from that request are rejected.
They are never accepted as missing local tools or automatically replayed.

Canonical provider failures, including unrecognized messages and historical
failures, receive provider recovery actions. Settings targets the selected
thread's current provider/model; save or cancel returns to that chat. Save failure
retains the draft; repeated save/retry clicks coalesce while pending. Retrying is
manual through Floret canonical retry, preserving confirmed results. Unknown
effects never receive this retry action. Diagnostics expose reviewed structured
fields or a safe typed classification, never arbitrary upstream error text.

# Boundaries

Model inventory and selected membership belong to [Model directory and selection](model-directory-and-selection.md).
Shared controls and keyboard/touch behavior belong to [Flower provider configuration](../ui/flower-provider-configuration.md).

# Evidence

- redeven:internal/config/ai_web_search.go - Provider policy and effective model resolver.
- redeven:internal/config/ai_web_search_controls_test.go - Switch matrix, aliases, defaults and atomic migration.
- redeven:internal/ai/web_search_turn_integration_test.go - Captured wire tools, restart, frozen waiting Turn and current-settings retry.
- redeven:internal/envapp/ui_src/src/ui/FlowerSurface.providerRecovery.browser.test.tsx - Configure, cancel, failed save, saved preference and deliberate retry.
