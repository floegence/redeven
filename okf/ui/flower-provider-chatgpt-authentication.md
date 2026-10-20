---
type: UI Contract
title: Flower ChatGPT authentication
description: Select, reauthorize, sign out and remove local ChatGPT accounts with stable interaction and explicit intent.
tags: [ai, flower, settings, authentication]
timestamp: 2026-10-20T00:00:00Z
---
# Summary

The shared [Flower provider dialog](flower-provider-configuration.md) owns account
selection and authentication feedback. Signed-in accounts remain distinct from
previous connections, sign-out preserves a stable compact summary, and explicit
removal forgets only a signed-out local registration. The host retains verified
local admission and persistence ownership.

# Contract

## Account selection and recovery

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
Signed-out account cards and the recovery chooser offer explicit Remove account
with an identity-bearing confirmation. Removal forgets the local registration
immediately and preserves provider settings, model choices and conversations.
Reopening a provider whose registration was removed requires a new sign-in or
an explicit saved-account choice. Failure keeps the confirmation and retry action.

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

## Connection feedback and continuity

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
Sign-out retains the compact account summary and toolbar geometry through pending
and terminal states; localized status and action labels reserve their full size.
The signed-in picker collapses once with the shared disclosure motion and becomes
inert immediately. Background reads of known accounts never remount a loading
picker. Reduced motion skips collapse; completion restores only owned focus after
the refreshed actions become available and never steals focus from model editing.
The primary action retains its DOM identity across these states. Starting sign-in
from an account action moves focus to its available cancellation control.
Completion, cancellation, or acknowledgement returns owned focus to the primary
action without scrolling; an arriving account
must not steal focus from a model search or surviving control. All stages use the
shared Desktop and Env styles and explicit localized copy.

# Boundaries

Account removal does not delete an OpenAI account or provider configuration.
Remote revocation and local registration lifecycle follow the
[account lifecycle](../ai/chatgpt-account-lifecycle.md). The dialog never treats
account selection as OAuth intent or an implicit provider save.

# Evidence

- `redeven:internal/flower_ui/src/settings/FlowerProviderDialog.tsx` - Account selection, recovery, sign-out continuity and confirmed local removal.
- `redeven:internal/flower_ui/src/styles/flower.css` - Shared compact-summary geometry and disclosure presentation.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.chatgpt.browser.test.tsx` - Attempt polling without account-list reloads.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSettingsSurface.presentation.browser.test.tsx` - Overview privacy, editor-only recovery, account-read retry and stale-binding rejection.
- `redeven:internal/envapp/ui_src/src/ui/FlowerProviderDialog.chatgpt.browser.test.tsx` - Local admission, account removal and stable localized sign-out geometry with delayed reads.
- `redeven:internal/envapp/ui_src/src/ui/FlowerProviderDialog.controls.browser.test.tsx` - Desktop and Env styles, responsive authentication presentation and owned focus.
