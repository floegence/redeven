---
type: Desktop Contract
title: Desktop SSH environment settings
tags: [desktop, environments, ssh, settings, interaction]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

SSH creation/editing share one form and registration API. Common controls precede advanced options, retained in an inspectable summary. Failures preserve drafts. Registration contracts own connections/secrets, while Environment settings owns the window, tab, draft and asynchronous recovery lifetime.

# Contract

## SSH fields and validation
The form presents name, connection and authentication, automatic status detection, and advanced configuration in that order. Creation and editing use the same canonical SSH normalizers. Common fields share one label/control grid and a leading control edge; port and authentication cannot right-align their own columns. The editor container, not only the window, determines the stacked layout. Floe owns control geometry and tab interaction; the enclosing dialog owns the settings title, while a hosted resource shows only the environment name.

# Boundaries

Password retention, replacement and removal continue through the existing secret draft and registration APIs. These fields do not add another Runtime deployment or persistence owner.

# Evidence

- `redeven:desktop/src/welcome/SSHEnvironmentSettingsForm.tsx` - Source.
- `redeven:desktop/src/welcome/SSHEnvironmentSettingsForm.client.test.tsx` - Tests.
