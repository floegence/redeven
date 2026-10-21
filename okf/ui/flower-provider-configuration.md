---
type: UI Contract
title: Flower provider configuration
description: Configure provider access before choosing models, with stable navigation and explicit authentication states.
tags: [ai, flower, settings, authentication]
timestamp: 2026-10-20T00:00:00Z
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

Provider and model search switches use backend policies from the model directory.
Both must be on; model preferences remain editable while provider search is off.
Only the information icon beside a field opens help through hover, keyboard
focus or touch. Labels, checkboxes and selectors never trigger it. Escape on the
icon dismisses help without closing the dialog. Concise hints explain search
dependencies and model recommendations; reset removes the model override.
Search source changes and disablement preserve keys.
The editor marks changed availability pending until a saved backend projection.
DeepSeek search and page-reader controls share a compact row below credentials
and wrap into separate rows on narrow screens. Search help names the configured
connection and required service support. Reader help explains URL sharing and
that some search results require DeepSeek reading. Both show only a brief
possible-charge notice, with no fixed prices or official-endpoint assumptions.
API routing and Turn lifecycle details belong to the search contract, not these
tooltips. Page-reader help stays available while search is off. DeepSeek search defaults on, and an
omitted page-reader choice follows the backend search policy: DeepSeek while
search is on, Direct while off. Explicit reader choices survive search toggles,
save and reopen. Model-selection guidance lives beside
the Models heading. Required-field state, unavailable search and save failures
remain visible; tooltips do not replace actionable feedback.
DeepSeek has no search-source selector. Changing provider type clears
inapplicable Fetch intent. Existing save, timeout, cancel, Escape, focus and
return-to-chat behavior owns the interaction; no parallel dialog state exists.
See [the search contract](../ai/model-web-search.md) for defaults and migration.

Failure and manual retry behavior follows [Flower failure recovery](flower-failure-recovery.md).

## Layout and connection readiness

Provider creation in the shared Flower dialog places a compact provider picker
beside one configuration pane. Selecting a provider reveals its identity,
connection controls, and searchable model catalog without pushing other provider
choices below a long expanded form. Icon, label, and selection slots keep every
brand aligned. Selecting the current provider retains its pane and draft;
changing type clears transient search, discovery, and entered credentials.
Existing Desktop and embedded Flower provider edits retain their type. Global
Env settings retain their provider-type editing action through the shared
dialog; changing type preserves the provider identity and stored credentials,
while clearing the unsaved credential drafts and obsolete model selections.
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

Discovered models with incomplete capabilities expose a labeled Configure
capabilities action in their selected row and in the footer beside the first
incomplete model's name. Save remains actionable: it clears a hiding search,
opens that model's editor, scrolls to and focuses its first missing field, and
does not call the host save until every selected model is complete. The editor
explains missing endpoint metadata and marks context and output capacity as
required. Tool support uses an explicit unknown/supported/unsupported choice;
unknown never appears as an unchecked boolean. Deselecting an incomplete model
removes its save requirement without inventing capabilities.

Every API key connection exposes an editable Base URL, including OpenAI, Gemini
and Anthropic. New connections prefill the provider default; existing connections
retain their configured address. Endpoint visibility is independent of whether
the backend requires an explicit address. ChatGPT account connections hide the
endpoint field, and switching authentication methods retains the endpoint draft.

Every provider connection can have an alias, including multiple connections of
the same brand. The pencil beside the provider title edits the existing `name`
field in place. Enter or leaving the field accepts the draft; Escape restores the
prior name, and an empty alias falls back to the brand. Provider galleries and
model selectors use the same alias. Saving preserves it without changing the
provider ID, authentication binding, credentials, endpoint or model identities.
The editor presents the brand mark, connection name and pencil on one centered
row without a duplicate brand subtitle. Renaming keeps the row height stable;
long names truncate while retaining their full tooltip and the edit control.

Global Env settings use the same provider picker, connection controls and model
catalog as the other Flower settings entrypoints. Advanced parameters remain
available through each model's explicit edit control. The catalog includes selected
custom models and is the single model-selection list; it does not repeat selected
models in another section. Host permission checks and persistence remain unchanged.

## OpenAI authentication

OpenAI connections offer API keys and verified local ChatGPT accounts. Account
selection, reauthorization, stable sign-out feedback and explicit local removal
follow the [ChatGPT authentication interaction contract](flower-provider-chatgpt-authentication.md).
Provider configuration and model selection remain explicit and independent of
account registration.

# Boundaries

Saved API and Brave credentials appear as a fixed-length dot placeholder in both
editors. The input value contains only the new credential draft; the saved secret
and its length never enter the browser. Focusing the field retains the placeholder,
typing shows a masked replacement with an explicit save hint, and clearing the
draft restores the placeholder. Saving an unchanged or cleared draft preserves the
stored credential and emits no credential patch. Providers without a stored key
retain their entry prompt and existing readiness requirements.

Provider bundle saves validate the complete model-profile structure, while
credential readiness is checked only for the affected connection: a new or
re-enabled provider, a changed provider type, authentication method, account or
endpoint, a changed Brave-search requirement, or an explicit credential patch.
An unchanged enabled connection keeps its saved intent when its runtime
authorization status or stored credential readiness changes; that state cannot
block saving a different provider. Affected ChatGPT bindings still require plan
permission, required API keys still cannot be removed, and enabled Brave search
still requires its key. Disabling or removing a connection does not require live
credential readiness. The backend applies the model profile and credential
patches atomically and leaves both unchanged when validation fails.

Provider-dialog save failures appear in the fixed dialog footer as an accessible
alert. The error remains visible while the form scrolls, wraps long text on narrow
screens, and preserves the draft for correction and retry. Save and discard/close
remain available after a failed attempt; there is no implicit provider save.

Credential entry makes API model configuration available; it does not claim that
the service has verified the key. ChatGPT requires a verified ready account.
Authentication authority and cancellation remain owned by the local authentication
contract. The dialog preserves host permission checks, disables all form controls when
administration or interaction is unavailable, and saves explicitly. A failed
explicit save retains the dialog draft and footer error without scheduling an implicit
provider save. The nullable credential patch still means remove, while omitted
or blank replacement drafts preserve saved secrets;
catalog synchronization never selects newly discovered models automatically.

# Evidence

- `redeven:internal/flower_ui/src/settings/FlowerProviderDialog.tsx` - Shared provider selection, credential readiness, authentication actions, and catalog ownership.
- `redeven:internal/envapp/ui_src/src/ui/pages/settings/FlowerProviderDialog.test.tsx` - Default and custom API endpoints across create/edit flows and authentication switches.
- `redeven:internal/envapp/ui_src/src/ui/pages/settings/sections/FlowerSection.tsx` - Global Env admission, shared dialog integration and atomic provider/credential saves.
- `redeven:internal/envapp/ui_src/src/ui/FlowerProviderDialog.chatgpt.browser.test.tsx` - Local and remote authorization, localized responsive layouts, and provider-picker stability through authentication and catalog search.
- `redeven:internal/envapp/ui_src/src/ui/FlowerProviderDialog.controls.browser.test.tsx` - Actual Desktop and Env styles, brand alignment, authentication contrast, and connection-before-model interaction.
- `redeven:internal/envapp/ui_src/src/ui/FlowerProviderDialog.selection.browser.test.tsx` - Stable scroll, model row identity, focus, discovery metadata, and parameter editing.
- `redeven:internal/envapp/ui_src/src/ui/FlowerProviderDialog.capabilities.browser.test.tsx` - Compatible discovery, missing-field navigation, explicit tool support, save/reopen, hidden selections and narrow-screen behavior in Desktop and Env styles.
- `redeven:internal/envapp/ui_src/src/ui/FlowerProviderDialog.credentials.browser.test.tsx` - Saved credential placeholders, focus, replacement, and empty-key guidance in actual Desktop and Env styles.
- `redeven:internal/envapp/ui_src/src/ui/FlowerProviderDialog.saveError.browser.test.tsx` - Fixed-footer save errors, retained drafts, retry, exit, and narrow-screen wrapping in actual Desktop and Env styles.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSettingsSurface.modelUpdates.test.tsx` - Saving a new provider while a retained ChatGPT binding loses plan permission.
- `redeven:internal/codeapp/appserver/server_provider_credentials_test.go` - Atomic backend credential validation and isolation for retained, new, rebound, and re-enabled connections.
- `redeven:internal/envapp/ui_src/src/ui/FlowerProviderDialog.search.browser.test.tsx` - Icon-only help, concise localized guidance, touch and keyboard recovery, responsive geometry and saved search/reader defaults.
- `redeven:internal/envapp/ui_src/src/ui/pages/settings/FlowerSection.browser.test.tsx` - Global Env credential preservation and replacement request payloads.
