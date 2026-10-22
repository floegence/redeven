---
type: UI Contract
title: Flower provider configuration
description: Configure provider access before choosing models, with stable navigation and explicit authentication states.
tags: [ai, flower, settings, authentication]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

One shared Flower provider dialog owns provider configuration in Desktop,
embedded Flower and global Env settings; hosts own admission and persistence.
Users choose a provider, supply required connection access, and then configure
models. Unready ChatGPT authorization exposes connection actions only. Provider
navigation, authentication selection, and model rows retain stable geometry and
focus. Failed authorization or discovery keeps recovery actions visible and must
not apply responses from a changed provider or trusted connection.

# Contract

## Search preferences
Provider and model search switches use backend policies from the model directory. Both must be on; model preferences remain editable while provider search is off.

Failure and manual retry behavior follows [Flower failure recovery](flower-failure-recovery.md).

## Layout and connection readiness
Provider creation in the shared Flower dialog places a compact provider picker beside one configuration pane.

ChatGPT uses one bounded connection panel; endpoint fields remain flat.

Host permission checks and persistence remain unchanged.

## OpenAI authentication
OpenAI connections offer API keys and verified local ChatGPT accounts. Provider configuration and model selection remain explicit and independent of account registration.

# Boundaries

Saved API and Brave credentials appear as a fixed-length dot placeholder in both editors. The input value contains only the new credential draft; the saved secret and its length never enter the browser.

The nullable credential patch still means remove, while omitted or blank replacement drafts preserve saved secrets; catalog synchronization never selects newly discovered models automatically.

# Evidence

- `redeven:internal/flower_ui/src/settings/FlowerProviderDialog.tsx` - Shared provider selection, credential readiness, authentication actions, and catalog ownership.

- `redeven:internal/envapp/ui_src/src/ui/pages/settings/FlowerProviderDialog.test.tsx` - Default and custom API endpoints across create/edit flows and authentication switches.

- `redeven:internal/envapp/ui_src/src/ui/pages/settings/sections/FlowerSection.tsx` - Global Env admission, shared dialog integration and atomic provider/credential saves.
