---
type: UI Contract
title: Flower ChatGPT authentication
tags: [ai, flower, settings, authentication]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Shared provider dialog owns account selection/auth feedback. Verified signed-in accounts differ from saved connections; sign-out retains compact stable summary. Explicit removal forgets only a signed-out local registration; host alone owns admission and protected persistence.

# Contract

## Account selection and recovery
The shared dialog offers ChatGPT account and API key methods. Selecting an entry never starts OAuth or saves a provider.

Account persistence, renewal and cancellation belong to the [account lifecycle](../ai/chatgpt-account-lifecycle.md); local admission belongs to the [authentication contract](../ai/chatgpt-local-authentication.md).

## Connection feedback and continuity
The connection panel groups account identity, state guidance, and actions. Background reads of known accounts never remount a loading picker. All stages use the shared Desktop and Env styles and explicit localized copy.

# Boundaries

Account removal does not delete an OpenAI account or provider configuration. The dialog never treats account selection as OAuth intent or an implicit provider save.

# Evidence

- `redeven:internal/flower_ui/src/settings/FlowerProviderDialog.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.chatgpt.browser.test.tsx` - Tests.
