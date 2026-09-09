---
type: Desktop Contract
title: Desktop SSH environment settings
description: Edit SSH registrations in a compact modal with explicit saving, visible custom configuration, and direct dismissal.
tags: [desktop, environments, ssh, settings, interaction]
timestamp: 2026-09-10T00:00:00Z
---
# Summary

Desktop owns SSH registration editing through one local draft and the existing
registration save API. Common fields remain visible ahead of advanced settings;
custom configuration stays discoverable in a summary. Changes save explicitly,
failed saves preserve input, and dismissing the editor discards unsaved changes
without confirmation. Connection and secret authority remain with the owners in
[Environment registrations](desktop-environment-registrations.md).

# Contract

## Presentation

Editing an SSH host registration opens a compact, theme-aware modal with a stable
opening identity, followed by its name, connection and authentication, automatic
status detection, and advanced configuration. Creation, containers, and Gateway
settings retain their existing forms. Desktop uses the published Floe Dialog
contract for backdrop dismissal policy, localized close labels, and input-owned
Escape handling; it does not intercept global keyboard events to override it.
The shell stays mounted when closed so the shared Dialog owns its full entrance
and exit motion, including reduced-motion behavior. The form reuses the existing
Welcome section entrance motion: a 250 ms opacity-only fade. Sections must not
translate inside the scroll viewport, create transient overflow, or change body
width during entry. The shared panel retains its scale, translation, and fade.
Its last presentation stays stable through exit; reopening resets the baseline and collapsed advanced state.
Corner radius and shadow follow the shared Dialog; the title is 14px, fields and
controls are 13px, and supporting text is 12px.

Advanced settings start collapsed even for customized registrations. A wrapping
summary names package delivery, default or custom directory, release source, and
connection timeout. Expanding the section preserves the draft. Invalid advanced
fields expand on Save and the first invalid field receives focus. Validation uses
the canonical SSH normalizers; editing one field clears only that field's error.

## Draft and save behavior

The opening snapshot is the editor's baseline. Editable field and password-action
changes enable Save; background metadata does not replace the baseline or draft.
Saving is explicit, blocks duplicate submission, and preserves input on failure.
Cancel, Close, Escape, and backdrop clicks dismiss directly, including modified
drafts, without a second question. Dismissing during a save does not cancel the
submitted request; late completion cannot close a new editor and late failures
are delivered to the launcher. Focus returns to the original trigger after exit.
Cmd/Ctrl+Enter saves unless composition or a nested selector owns the key.
Collapsed fields remain outside the tab order. Only the content body scrolls;
the title and actions stay visible. Real overflow remains scrollable without
changing overflow policy during animations or delaying focus. Inputs follow the
shared [input focus boundary](../ui/input-focus-boundaries.md).

# Boundaries

Password retention, replacement, and removal continue through the existing secret
draft and registration APIs. Local storage and deferred-removal notices remain
visible when relevant. These presentation changes do not change SSH identity,
Runtime deployment, status probing, or persistence ownership.

# Evidence

- `redeven:desktop/src/welcome/SSHEnvironmentSettingsDialog.tsx:1` - SSH editing layout, draft closure, and validation presentation.
- `redeven:desktop/src/welcome/SSHEnvironmentSettingsDialog.client.test.tsx:1` - Editing, nested keyboard input, validation, and save behavior.
- `redeven:desktop/src/welcome/sshEnvironmentSettingsState.ts:1` - Editable fields and canonical SSH validation.
- `redeven:desktop/scripts/check-ssh-settings.mjs` - Theme/locale geometry, animation frames, real scrolling, and editing recovery in Chromium.
