---
type: Desktop Contract
title: Desktop SSH environment settings
description: Edit SSH registrations in a compact modal with explicit saving, visible custom configuration, and direct dismissal.
tags: [desktop, environments, ssh, settings, interaction]
timestamp: 2026-09-10T00:00:00Z
---
# Summary

SSH creation and editing share one form and the existing registration save API.
Common fields remain visible ahead of advanced settings; custom configuration
stays discoverable in a summary. Failed saves preserve input. Connection and
secret authority remain with [Environment registrations](desktop-environment-registrations.md).
The window, tab, draft lifetime and asynchronous recovery contract belongs to
[Environment settings](desktop-environment-settings.md).

# Contract

## SSH fields and validation

The form presents name, connection and authentication, automatic status detection,
and advanced configuration in that order. The form is one continuous reading
surface with quiet section dividers; identity and transport fields are not
wrapped in separate cards. Advanced settings start collapsed even
for customized registrations. A wrapping summary names package delivery, default
or custom directory, release source, and connection timeout. Expanding preserves
the draft. Invalid advanced fields expand on Save and the first invalid field
receives focus. Creation and editing use the same canonical SSH normalizers.
Editing one field clears only its error. Fields and controls are 13px, and
supporting text is 12px; modal material remains owned by Floe.

Cmd/Ctrl+Enter saves unless composition or a nested selector owns the key.
Collapsed fields stay outside the tab order. Nested help and destination selectors
handle Escape before the surrounding settings window. Successful editing saves
stay open and establish the new connection baseline. New registrations use the
same fields inside the existing creation dialog.

# Boundaries

Password retention, replacement and removal continue through the existing secret
draft and registration APIs. Local storage and deferred-removal notices remain
visible when relevant. SSH configuration aliases remain selectable, and changing
the destination or authentication context preserves the established secret-scope
rules. These fields do not add another Runtime deployment or persistence owner.

# Evidence

- `redeven:desktop/src/welcome/SSHEnvironmentSettingsForm.tsx` - Shared creation/editing fields, nested keyboard handling and validation presentation.
- `redeven:desktop/src/welcome/SSHEnvironmentSettingsForm.client.test.tsx` - Editing, password actions, validation and save behavior.
- `redeven:desktop/src/welcome/sshEnvironmentSettingsState.ts` - Editable fields and canonical SSH validation.
- `redeven:desktop/scripts/check-ssh-settings.mjs` - Theme/locale geometry, animation frames, real scrolling, retained tabs and editing recovery in Chromium.
