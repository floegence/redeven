---
type: Interaction Contract
title: Remote desktop connection launcher
tags: [desktop, applications, interaction, accessibility]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

One Host Applications/Workbench flow identifies host, readiness and primary action, continuing consent in place under session policy. Failure retains recovery; dismissing pending creation releases its session. Once opened, viewer lifetime is independent of the launcher.

# Contract

- Use the shared monitor/pointer mark, distinguishable at Dock/header sizes across themes/high contrast. Keep diagnostic/retry after failure; cancellation stops only selected setup without reloading.
- SSH preparation, operation-bound challenge, progress and desktop opening stay in the same dialog. [SSH deployment](remote-desktop-ssh-deployment.md) owns admin scope/credential lifetime; opening the launcher changes no OS permission.
- Host preparation presents observed checking, component, service and verification stages. Component byte progress appears only when both a real total and received count are available; interrupted or rollback states never imply completion.
- Initial content is target/readiness/connect. Admin/display selectors retain native keyboard behavior/labels; decorative chevrons sit 12px inside the field with separate text padding and no pointer interception.
- Disabling approval reuse requests confirmation on future connections without revoking OS grants. Status refresh cannot erase connection failure.

# Boundaries

Desktop retains origin-only target validation and environment-scoped route admission. Product adapters cannot accept malformed session data to bypass either.

# Evidence

- `internal/envapp/ui_src/src/ui/pages/RemoteDesktopPanel.browser.test.tsx`: selector geometry, keyboard focus, authorization method selection, localized narrow layouts and forced-color presentation.

- `internal/envapp/ui_src/src/ui/icons/RemoteDesktopIcon.tsx`: shared monitor-and-pointer silhouette and compact launcher rendering.

- `internal/envapp/ui_src/src/ui/icons/WorkbenchSoftIcons.tsx`: themed Remote Desktop Dock tile.

- `internal/envapp/ui_src/src/styles/navigationIcons.browser.test.tsx`: actual-size silhouettes, theme and high-contrast checks.
