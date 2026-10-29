---
type: Interaction Contract
title: Remote desktop connection launcher
tags: [desktop, applications, interaction, accessibility]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Env App owns one remote desktop flow in Host Applications/Workbench: identify the host, show readiness and one primary action, then continue authorization in place. [Session policy](remote-desktop.md) enforces platform/permission limits. Failure retains recovery; dismissal before creation finishes releases that session. An opened viewer has an independent lifetime.

# Contract

- Use the shared monitor/pointer mark, distinguishable at Dock/header sizes across themes/high contrast. Keep diagnostic/retry after failure; cancellation stops only selected setup without reloading.
- SSH preparation, operation-bound challenge, progress and desktop opening stay in the same dialog. [SSH deployment](remote-desktop-ssh-deployment.md) owns admin scope/credential lifetime; opening the launcher changes no OS permission.
- Initial content is target/readiness/connect. Admin/display selectors retain native keyboard behavior/labels; decorative chevrons sit 12px inside the field with separate text padding and no pointer interception.
- Disabling approval reuse requests confirmation on future connections without revoking OS grants. Status refresh cannot erase connection failure.

# Boundaries

Desktop retains origin-only target validation and environment-scoped route admission. Product adapters cannot accept malformed session data to bypass either.

# Evidence

- `internal/envapp/ui_src/src/ui/pages/RemoteDesktopPanel.browser.test.tsx`: selector geometry, keyboard focus, authorization method selection, localized narrow layouts and forced-color presentation.

- `internal/envapp/ui_src/src/ui/icons/RemoteDesktopIcon.tsx`: shared monitor-and-pointer silhouette and compact launcher rendering.

- `internal/envapp/ui_src/src/ui/icons/WorkbenchSoftIcons.tsx`: themed Remote Desktop Dock tile.

- `internal/envapp/ui_src/src/styles/navigationIcons.browser.test.tsx`: actual-size silhouettes, theme and high-contrast checks.
