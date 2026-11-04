---
type: AI Capability Contract
title: Model web search
tags: [ai, models, search, providers]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven resolves provider/model search preferences once for settings and turns; final tools drive prompt/wire. Floret v7.40.2 validates hosted events against frozen requests. Undeclared hosted execution fails because remote effects cannot safely be assumed absent.

# Contract

Provider configuration is web_search with enabled and source fields; source is native or brave. Both switches must be enabled.

Diagnostics expose reviewed structured fields or a safe typed classification, never arbitrary upstream error text.

# Boundaries

Model inventory and selected membership belong to [Model directory and selection](model-directory-and-selection.md). Shared controls and keyboard/touch behavior belong to [Flower provider configuration](../ui/flower-provider-configuration.md#provider-configuration).

# Evidence

- redeven:internal/config/ai_web_search.go
- redeven:internal/config/ai_web_search_controls_test.go
