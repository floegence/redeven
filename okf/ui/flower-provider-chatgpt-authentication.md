---
type: UI Contract
title: Flower ChatGPT authentication
description: Select, reauthorize, sign out and remove local ChatGPT accounts with stable interaction and explicit intent.
tags: [ai, flower, settings, authentication]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The shared [Flower provider dialog](flower-provider-configuration.md) owns account
selection and authentication feedback. Signed-in accounts remain distinct from
previous connections, sign-out preserves a stable compact summary, and explicit
removal forgets only a signed-out local registration. The host retains verified
local admission and persistence ownership.

# Contract

## Account selection and recovery
The shared dialog offers ChatGPT account and API key methods. Selecting an entry never starts OAuth or saves a provider.

Account persistence, renewal and cancellation belong to the [account lifecycle](../ai/chatgpt-account-lifecycle.md); local admission belongs to the [authentication contract](../ai/chatgpt-local-authentication.md).

## Connection feedback and continuity
The connection panel groups account identity, state guidance, and actions. Background reads of known accounts never remount a loading picker. All stages use the shared Desktop and Env styles and explicit localized copy.

# Boundaries

Account removal does not delete an OpenAI account or provider configuration. The dialog never treats account selection as OAuth intent or an implicit provider save.

# Evidence

- `redeven:internal/flower_ui/src/settings/FlowerProviderDialog.tsx` - Account selection, recovery, sign-out continuity and confirmed local removal.

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.chatgpt.browser.test.tsx` - Attempt polling without account-list reloads.
