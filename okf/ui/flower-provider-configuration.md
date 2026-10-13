---
type: UI Contract
title: Flower provider configuration
description: Configure provider access before choosing models, with stable navigation and explicit authentication states.
tags: [ai, flower, settings, authentication]
timestamp: 2026-10-13T06:26:33Z
---
# Summary

The shared Flower dialog and global Env provider editor own provider configuration.
Users choose a provider, supply required connection access, and then configure
models. Unready ChatGPT authorization exposes connection actions only. Provider
navigation, authentication selection, and model rows retain stable geometry and
focus. Failed authorization or discovery keeps recovery actions visible and must
not apply responses from a changed provider or trusted connection.

# Contract

## Layout and connection readiness

Provider creation in the shared Flower dialog places a compact provider picker
beside one configuration pane. Selecting a provider reveals its identity,
connection controls, and searchable model catalog without pushing other provider
choices below a long expanded form. Icon, label, and selection slots keep every
brand aligned. Selecting the current provider retains its pane and draft;
changing type clears transient search, discovery, and entered credentials.
Existing shared-provider edits retain their type.
Narrow screens move the picker above the form and use the dialog body as the only
vertical scroller; wide layouts scroll the picker and configuration independently.

Authentication methods use a clearly contrasted segmented control below the
connection heading. ChatGPT uses one bounded connection panel; endpoint fields remain flat. Redundant provider, credential, and aggregate
search badges are omitted. Required credentials, authorization guidance, and save
errors remain actionable. Before ChatGPT authorization is ready, only connection
controls appear; success synchronizes the catalog once and reveals models.
API providers reveal models after required credentials are available; optional
local keys remain optional. Global Env model navigation follows the same boundary.
Model rows use thin horizontal rules and stable controls,
with metadata editing revealed explicitly. Search, refresh, and selection preserve
surviving row identity and focus; loading, authorization, errors, and empty search
results have distinct visible feedback. Provider changes retain the existing
authentication cancellation and discovery identity boundaries.

Global Env settings retain their type, connection, models, and advanced sections,
with the same flat picker and catalog treatment. The catalog includes selected
custom models and is the single model-selection list; it does not repeat selected
models in another section. Host permission checks and persistence remain unchanged.

## OpenAI authentication

The shared dialog offers ChatGPT account and API key methods. Verified local
OpenAI drafts default to ChatGPT; existing drafts retain their method. Remote
settings keep ChatGPT disabled with persistent guidance and no login panel.
Verification preserves choices, search and focus until explicit save. Account,
locality and cancellation rules belong to the
[local authentication contract](../ai/chatgpt-local-authentication.md).

The connection panel groups account identity, state guidance, and actions. Initial
sign-in has one prominent browser action. Runtime-reported preparation, browser
authorization, and verification have distinct status text; waiting explains how
to finish in the browser, and cancellation remains available. Ready accounts show
their identity and plan source, with a first-use acknowledgement followed by
connection and usage actions. Failures keep the recovery action in the same panel.
The primary action retains its DOM identity across these states. Starting sign-in
from an account action moves focus to its available cancellation control.
Completion, cancellation, or acknowledgement returns owned focus to the primary
action without scrolling; an arriving account
must not steal focus from a model search or surviving control. All stages use the
shared Desktop and Env styles and explicit localized copy.

# Boundaries

Credential entry makes API model configuration available; it does not claim that
the service has verified the key. ChatGPT requires a verified ready account.
Authentication authority and cancellation remain owned by the local authentication
contract. The editors preserve host permission checks and save explicitly;
catalog synchronization never selects newly discovered models automatically.

# Evidence

- `redeven:internal/flower_ui/src/settings/FlowerProviderDialog.tsx` - Shared provider selection, credential readiness, authentication actions, and catalog ownership.
- `redeven:internal/envapp/ui_src/src/ui/pages/settings/AIProviderDialog.tsx` - Global Env provider navigation and connection readiness.
- `redeven:internal/envapp/ui_src/src/ui/FlowerProviderDialog.chatgpt.browser.test.tsx` - Local and remote authorization, localized responsive layouts, and provider-picker stability through authentication and catalog search.
- `redeven:internal/envapp/ui_src/src/ui/FlowerProviderDialog.controls.browser.test.tsx` - Actual Desktop and Env styles, brand alignment, authentication contrast, and connection-before-model interaction.
- `redeven:internal/envapp/ui_src/src/ui/FlowerProviderDialog.selection.browser.test.tsx` - Stable scroll, model row identity, focus, discovery metadata, and parameter editing.
