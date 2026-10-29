---
type: UI Contract
title: Flower provider configuration
tags: [ai, flower, settings, authentication]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Desktop, Flower and Env share one dialog. Hosts own persistence. Choose a brand, connect, then select models. Preserve navigation, focus and recovery actions after connection failures; reject stale responses. Kimi shares one brand while access methods retain separate credentials and models.

# Contract

## Connection setup
OpenAI offers API keys or verified local ChatGPT accounts. Registration and model selection stay independent; endpoints stay flat and permissions unchanged.

## Kimi
One Kimi choice offers API or Kimi Code. Drafts isolate keys, endpoints and models; close clears them. Switching rejects stale discovery. Saved methods stay fixed; add another connection to change service. Cards label methods; IDs, aliases, selections and history stay unchanged.

Use short names and access labels. Explain keys, quotas and saved methods in the access tooltip; model limits in the model tooltip. Icon links open official guidance. Code keeps regional endpoints and reviewed IDs; billing never falls back.

## Search and secrets
Provider and model search switches must both be on; preferences remain editable when provider search is off. Backend policies own availability. See [failure recovery](flower-failure-recovery.md). Stored keys use fixed dot placeholders. Null removes a key; omitted/blank patches preserve it. Catalog refresh never selects new models.

# Boundaries

Brand grouping is presentation only; both connection types remain in catalog/serialization. Floret mechanics and storage are unchanged.

# Evidence

- redeven:internal/flower_ui/src/settings/FlowerProviderDialog.tsx - Shared settings/credential readiness.
- redeven:internal/envapp/ui_src/src/ui/pages/settings/FlowerProviderDialog.test.tsx - Create/edit endpoint and authentication behavior.
