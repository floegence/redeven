---
type: AI Capability Contract
title: Model web search
tags: [ai, models, search, providers]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns provider and model search preferences. One backend resolver supplies
settings projections and Turn preparation; the final tool surface drives prompts
and wire declarations. Floret v7.40.2 validates hosted events against the actual
frozen provider request. Undeclared hosted execution remains a provider failure
because its remote effects cannot be assumed absent.

# Contract

Provider configuration is web_search with enabled and source fields; source is native or brave. Both switches must be enabled.

Diagnostics expose reviewed structured fields or a safe typed classification, never arbitrary upstream error text.

# Boundaries

Model inventory and selected membership belong to [Model directory and selection](model-directory-and-selection.md). Shared controls and keyboard/touch behavior belong to [Flower provider configuration](../ui/flower-provider-configuration.md).

# Evidence

- redeven:internal/config/ai_web_search.go - Provider policy and effective model resolver.

- redeven:internal/config/ai_web_search_controls_test.go - Switch matrix, aliases, defaults and atomic migration.
