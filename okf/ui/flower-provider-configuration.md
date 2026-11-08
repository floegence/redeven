---
type: UI Contract
title: Flower provider setup and account selection
tags: [ai, flower, settings, authentication]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Provider dialogs keep explicit access methods, keys, accounts and model selection independent. Use short names and access labels. Explain keys, quotas and saved methods in the access tooltip; model limits in the model tooltip. Icon links open official guidance.

# Contract

## Provider configuration
### Connection setup
OpenAI offers API keys or verified local ChatGPT accounts. Registration and model selection stay independent; endpoints stay flat and permissions unchanged.

### Kimi
One Kimi choice offers API or Kimi Code. Drafts isolate keys, endpoints and models; close clears them. Switching rejects stale discovery. Saved methods stay fixed; add another connection to change service. Cards label methods; IDs, aliases, selections and history stay unchanged.

Code keeps regional endpoints and reviewed IDs; billing never falls back.

### Search and secrets
Provider and model search switches must both be on; preferences remain editable when provider search is off. Backend policies own availability. See [failure recovery](flower-failure-recovery.md). Stored keys use fixed dot placeholders. Null removes a key; omitted/blank patches preserve it. Catalog refresh never selects new models.

### DeepSeek Fetch
Omitted Fetch configuration uses direct GET fetching. DeepSeek Fetch is opt-in
inside the DeepSeek provider dialog. Explicit existing DeepSeek selections are
preserved; this does not disable the separate search capability. HTML Preview
is described as an available rendering capability without recommending its use.

## ChatGPT selection
Verified signed-in accounts differ from saved connections. Sign-out retains a compact summary; explicit removal forgets only a signed-out local registration. Host owns protected persistence/admission.

### Account selection and recovery
The shared dialog offers ChatGPT account and API key methods. Selecting an entry never starts OAuth or saves a provider.

Account persistence, renewal and cancellation belong to the [account lifecycle](../ai/chatgpt-account-lifecycle.md#account-lifecycle); local admission belongs to the [authentication contract](../ai/chatgpt-account-lifecycle.md#local-admission).

### Connection feedback and continuity
The connection panel groups account identity, state guidance, and actions. Background reads of known accounts never remount a loading picker. All stages use the shared Desktop and Env styles and explicit localized copy.

# Boundaries

Brand grouping is presentation only; both connection types remain in catalog/serialization. Floret mechanics and storage are unchanged.

Account removal does not delete an OpenAI account or provider configuration. The dialog never treats account selection as OAuth intent or an implicit provider save.

# Evidence

- redeven:internal/flower_ui/src/settings/FlowerProviderDialog.tsx
- redeven:internal/envapp/ui_src/src/ui/pages/settings/FlowerProviderDialog.test.tsx
