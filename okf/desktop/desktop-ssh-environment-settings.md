---
type: Desktop Contract
title: Desktop SSH environment settings
description: Edit SSH registrations in a compact modal with explicit saving, visible custom configuration, and direct dismissal.
tags: [desktop, environments, ssh, settings, interaction]
timestamp: 2026-09-10T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
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
The form presents name, connection and authentication, automatic status detection, and advanced configuration in that order. Creation and editing use the same canonical SSH normalizers.

New registrations use the same fields inside the existing creation dialog.

# Boundaries

Password retention, replacement and removal continue through the existing secret draft and registration APIs. These fields do not add another Runtime deployment or persistence owner.

# Evidence

- `redeven:desktop/src/welcome/SSHEnvironmentSettingsForm.tsx` - Shared creation/editing fields, nested keyboard handling and validation presentation.

- `redeven:desktop/src/welcome/SSHEnvironmentSettingsForm.client.test.tsx` - Editing, password actions, validation and save behavior.

- `redeven:desktop/src/welcome/sshEnvironmentSettingsState.ts` - Editable fields and canonical SSH validation.
