---
type: Desktop Contract
title: Desktop SSH environment settings
tags: [desktop, environments, ssh, settings, interaction]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

SSH creation/editing share one form and registration API. Common controls precede advanced options, retained in an inspectable summary. Failures preserve drafts. Registration contracts own connections/secrets, while Environment settings owns the window, tab, draft and asynchronous recovery lifetime.

# Contract

## SSH fields and validation
The form presents name, connection and authentication, automatic status detection, and advanced configuration in that order. Creation and editing use the same canonical SSH normalizers.

New registrations use the same fields inside the existing creation dialog.

# Boundaries

Password retention, replacement and removal continue through the existing secret draft and registration APIs. These fields do not add another Runtime deployment or persistence owner.

# Evidence

- `redeven:desktop/src/welcome/SSHEnvironmentSettingsForm.tsx` - Shared forms, nested keys and validation presentation.

- `redeven:desktop/src/welcome/SSHEnvironmentSettingsForm.client.test.tsx` - Editing, password actions, validation and save behavior.
