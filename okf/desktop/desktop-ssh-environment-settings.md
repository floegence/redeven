---
type: Desktop Contract
title: Desktop SSH environment settings
description: Edit SSH registrations in a compact modal with explicit saving, visible custom configuration, and protected drafts.
tags: [desktop, environments, ssh, settings, interaction]
timestamp: 2026-09-09T00:00:00Z
---
# Summary

Desktop owns SSH registration editing through one local draft and the existing
registration save API. Common fields remain visible ahead of advanced settings;
custom configuration stays discoverable in a summary. Changes save explicitly,
failed saves preserve input, and closing a modified draft requires an explicit
discard choice. Connection and secret authority remain with the owners in
[Environment registrations](desktop-environment-registrations.md).

# Contract

## Presentation

Editing an SSH host registration opens a compact, theme-aware modal with a stable
opening identity, followed by its name, connection and authentication, automatic
status detection, and advanced configuration. Creation, containers, and Gateway
settings retain their existing forms. Desktop uses the published Floe Dialog
contract for backdrop dismissal policy, localized close labels, and input-owned
Escape handling; it does not intercept global keyboard events to override it.

Advanced settings start collapsed even for customized registrations. A wrapping
summary names package delivery, default or custom directory, release source, and
connection timeout. Expanding the section preserves the draft. Invalid advanced
fields expand on Save and the first invalid field receives focus. Validation uses
the canonical SSH normalizers; editing one field clears only that field's error.

## Draft and save behavior

The opening snapshot is the editor's baseline. Editable field and password-action
changes enable Save; background metadata does not replace the baseline or draft.
Saving is explicit, blocks duplicate submission, and preserves input on failure.
Cancel, Close, and Escape ask whether to discard a changed draft. Backdrop clicks
leave the editor open. Unchanged drafts close directly; focus returns to the
original trigger. Cmd/Ctrl+Enter saves unless composition or a nested selector owns
the key. Collapsed fields and the draft behind discard confirmation are outside
the tab order. Only the content body scrolls; the title and actions stay visible.

# Boundaries

Password retention, replacement, and removal continue through the existing secret
draft and registration APIs. Local storage and deferred-removal notices remain
visible when relevant. These presentation changes do not change SSH identity,
Runtime deployment, status probing, or persistence ownership.

# Evidence

- `redeven:desktop/src/welcome/SSHEnvironmentSettingsDialog.tsx:1` - SSH editing layout, draft closure, and validation presentation.
- `redeven:desktop/src/welcome/SSHEnvironmentSettingsDialog.client.test.tsx:1` - Editing, nested keyboard input, validation, and save behavior.
- `redeven:desktop/src/welcome/sshEnvironmentSettingsState.ts:1` - Editable fields and canonical SSH validation.
