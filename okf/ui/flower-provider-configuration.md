---
type: UI Contract
title: Flower provider configuration
description: Configure provider access before choosing models, with stable navigation and explicit authentication states.
tags: [ai, flower, settings, authentication]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-24"
---
# Summary

One shared Flower dialog configures Desktop, embedded Flower and Env settings. Hosts own admission/persistence. Choose a provider, establish access, then configure models. Navigation, authentication and model rows retain geometry/focus. Failed authorization/discovery preserves recovery actions; stale connection responses never apply.

# Contract

## Connection setup
Creation shows a compact provider picker beside its configuration pane. Endpoint fields stay flat; ChatGPT has one bounded connection panel and exposes connection actions until ready. OpenAI supports API keys or verified local ChatGPT accounts; account registration and model selection remain independent. Host permissions are unchanged.

## Search
Both provider and model switches must be on. Model preferences stay editable when provider search is off; policies come from the backend directory. See [failure recovery](flower-failure-recovery.md) for retry behavior.

## Kimi Code
Separate from Moonshot: supply a personal subscription key, choose China/global service and select reviewed models. Custom model/wire-ID edits are unavailable to prevent silent provider fallback. Localized guidance covers shared quota, Extra Usage charges, plan/context limits and new conversations for family changes. Official key/usage and model-doc links stay visible.

# Boundaries

Saved API/Brave keys use fixed-length dot placeholders; only replacement drafts enter inputs. Null removes a key; omitted/blank patches preserve it. Catalog synchronization never selects additions automatically.

# Evidence

- redeven:internal/flower_ui/src/settings/FlowerProviderDialog.tsx - Shared settings/credential readiness.
- redeven:internal/envapp/ui_src/src/ui/pages/settings/FlowerProviderDialog.test.tsx - Create/edit endpoint and authentication behavior.
- redeven:internal/envapp/ui_src/src/ui/pages/settings/sections/FlowerSection.tsx - Atomic profile/credential saves.
- redeven:internal/envapp/ui_src/src/ui/FlowerProviderDialog.kimiCode.browser.test.tsx - Responsive region/model selection and key preservation.
