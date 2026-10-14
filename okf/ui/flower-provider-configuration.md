---
type: UI Contract
title: Flower provider configuration
description: Configure provider access before choosing models, with stable navigation and explicit authentication states.
tags: [ai, flower, settings, authentication]
timestamp: 2026-10-14T00:00:00Z
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

Global Env settings use the same provider picker, connection controls and model
catalog as the other Flower settings entrypoints. Advanced parameters remain
available through each model's explicit edit control. The catalog includes selected
custom models and is the single model-selection list; it does not repeat selected
models in another section. Host permission checks and persistence remain unchanged.

## OpenAI authentication

The shared dialog offers ChatGPT account and API key methods. Verified local
OpenAI drafts default to ChatGPT; existing drafts retain their method. Remote
settings keep ChatGPT disabled with persistent guidance and no login panel.
Verification preserves model choices, search and focus. The verified sign-in
is saved independently of connection editing. The settings overview contains only
models and providers; it neither lists saved accounts nor reads the registry for
account cards. The OpenAI editor's primary dropdown lists signed-in accounts,
including unbound sign-ins and sessions needing renewal or local repair. Signed-out,
authorization-required and signing-out records are excluded. A sole signed-in
registration is selected for new connections even when signed-out history exists;
multiple signed-in registrations require an explicit choice. Selecting
an entry never starts OAuth or saves a provider. Existing bindings are preserved.
Editable account snapshots are isolated from the canonical list, so resetting a
draft cannot relabel or duplicate another registration in the picker.
A ready selection synchronizes its catalog while leaving models unselected until
chosen. Discard, page reentry and failed provider saves retain discoverability in
the dropdown. Loading or failed account reads block sign-in and expose recovery.

Sign in again opens a separate previous-connection chooser. It reuses the chosen
registration and commits a new draft binding only after verified OAuth success.
Cancellation or failure preserves the previous binding and model choices; retries
retain the recovery attempt's account identity. With no signed-in accounts,
Continue with ChatGPT reauthorizes the sole previous connection or opens the
chooser when several exist. This never silently creates a new registration.
An existing provider bound to a signed-out account keeps its explicit status and
direct reauthorization action without adding it to the signed-in dropdown or
switching to another account. Successful local sign-out removes its picker entry
immediately; cleanup and remote-revocation failures remain actionable. Distinct
previous connections remain available only in the explicit recovery chooser.

Same-email registrations have distinct stable connection labels derived from
opaque account IDs when their emails collide in the displayed list; the UI never
invents workspace names. An independent Add
account or workspace action opens a confirmation explaining how to reuse an
existing entry. Only confirmation sends explicit new-registration intent. All
OAuth-start controls use Continue with ChatGPT. Retrying a failed new exchange
retains its issued client even while the previous binding remains selected.
Account persistence, renewal and cancellation belong to the
[account lifecycle](../ai/chatgpt-account-lifecycle.md);
local admission belongs to the
[authentication contract](../ai/chatgpt-local-authentication.md).

The connection panel groups account identity, state guidance, and actions. Initial
sign-in has one prominent browser action. Runtime-reported preparation, browser
authorization, and verification have distinct status text; waiting explains how
to finish in the browser, and cancellation remains available. All in-progress localized messages occupy
one reserved grid area, so preparation, waiting and verification do not resize
the panel or move the actions. Polling reads attempt status only; saved-account
reads are coalesced and occur on opening, terminal changes and existing lifecycle
events. Identical account facts do not replace the settings snapshot. Ready accounts use a
compact summary with the account identity, plan source, one connected status, and
an aligned toolbar for usage and account actions. Reauthorization remains a quiet
secondary action after connection. The first-use explanation is a separate notice;
its confirmation aligns with its copy, retains keyboard access, and collapses
without an abrupt layout jump. Closing notice content becomes inert immediately,
and reduced-motion preferences skip the animation. Failures keep the recovery
action in the account panel.
The primary action retains its DOM identity across these states. Starting sign-in
from an account action moves focus to its available cancellation control.
Completion, cancellation, or acknowledgement returns owned focus to the primary
action without scrolling; an arriving account
must not steal focus from a model search or surviving control. All stages use the
shared Desktop and Env styles and explicit localized copy.

# Boundaries

Saved API and Brave credentials appear as a fixed-length dot placeholder in both
editors. The input value contains only the new credential draft; the saved secret
and its length never enter the browser. Focusing the field retains the placeholder,
typing shows a masked replacement with an explicit save hint, and clearing the
draft restores the placeholder. Saving an unchanged or cleared draft preserves the
stored credential and emits no credential patch. Providers without a stored key
retain their entry prompt and existing readiness requirements.

Credential entry makes API model configuration available; it does not claim that
the service has verified the key. ChatGPT requires a verified ready account.
Authentication authority and cancellation remain owned by the local authentication
contract. The dialog preserves host permission checks, disables all form controls when
administration or interaction is unavailable, and saves explicitly. A failed
explicit save retains the dialog draft and error without scheduling an implicit
provider save. The nullable credential patch still means remove, while omitted
or blank replacement drafts preserve saved secrets;
catalog synchronization never selects newly discovered models automatically.

# Evidence

- `redeven:internal/flower_ui/src/settings/FlowerProviderDialog.tsx` - Shared provider selection, credential readiness, authentication actions, and catalog ownership.
- `redeven:internal/envapp/ui_src/src/ui/pages/settings/sections/FlowerSection.tsx` - Global Env admission, shared dialog integration and atomic provider/credential saves.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.chatgpt.browser.test.tsx` - Attempt polling without account-list reloads.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSettingsSurface.presentation.browser.test.tsx` - Overview privacy, editor-only recovery, account-read retry and stale-binding rejection.
- `redeven:internal/envapp/ui_src/src/ui/FlowerProviderDialog.chatgpt.browser.test.tsx` - Local and remote authorization, localized responsive layouts, and provider-picker stability through authentication and catalog search.
- `redeven:internal/envapp/ui_src/src/ui/FlowerProviderDialog.controls.browser.test.tsx` - Actual Desktop and Env styles, brand alignment, authentication contrast, and connection-before-model interaction.
- `redeven:internal/envapp/ui_src/src/ui/FlowerProviderDialog.selection.browser.test.tsx` - Stable scroll, model row identity, focus, discovery metadata, and parameter editing.
- `redeven:internal/envapp/ui_src/src/ui/FlowerProviderDialog.credentials.browser.test.tsx` - Saved credential placeholders, focus, replacement, and empty-key guidance in actual Desktop and Env styles.
- `redeven:internal/envapp/ui_src/src/ui/pages/settings/FlowerSection.browser.test.tsx` - Global Env credential preservation and replacement request payloads.
