---
type: Interaction Contract
title: Remote desktop connection launcher
tags: [desktop, applications, interaction, accessibility]
lifecycle: contract
reviewed_at: "2026-11-05"
---
# Summary

One Host Applications/Workbench flow identifies host, readiness and primary action, continuing consent in place under session policy. Failure retains recovery; dismissing pending creation releases its session. Once opened, viewer lifetime is independent of the launcher.

# Contract

- Use the shared monitor/pointer mark, distinguishable at Dock/header sizes across themes/high contrast. Keep diagnostic/retry after failure; cancellation stops only selected setup without reloading.
- SSH preparation, operation-bound challenge, progress and desktop opening stay in the same dialog. [SSH deployment](remote-desktop-ssh-deployment.md) owns admin scope/credential lifetime; opening the launcher changes no OS permission.
- SSH host preparation presents observed checking, component, service and verification stages. The Desktop bridge forwards the published component media substate (`checking`, `downloading`, `receiving`, `verifying`, `installing`, `validating`, `ready`) only while the deployment stage is `preparing_media`; older byte-only reports remain valid. Component byte progress appears only during an observed transfer with a real total and received count. Integrity checking, unpacking, validation and packaging use one calm indeterminate Floe progress cue, so a completed download never masquerades as completed preparation. Avoid simultaneous spinners, shimmer and sweeping effects; static current-step emphasis and observed detail communicate stage changes. Interrupted or rollback states never imply completion.
- Preparation keeps a viewport-bounded content area while observed detail text and transfer metrics change. The seven-step list scrolls independently within a 128px maximum height, adapts to short viewports, and keeps the active step visible without moving keyboard focus; compact markers preserve readable row spacing. The current detail is announced through a single atomic status region, the progress wrapper owns the accessible progressbar semantics, and the visual Floe primitive is decorative. Reduced-motion and forced-colors preferences disable decorative motion while retaining a visible state boundary.
- Initial content is target/readiness/connect. Admin/display selectors retain native keyboard behavior/labels; decorative chevrons sit 12px inside the field with separate text padding and no pointer interception.
- Disabling approval reuse requests confirmation on future connections without revoking OS grants. Status refresh cannot erase connection failure.

# Boundaries

Desktop retains origin-only target validation and environment-scoped route admission. Product adapters cannot accept malformed session data to bypass either.

# Evidence

- `internal/envapp/ui_src/src/ui/pages/RemoteDesktopPanel.browser.test.tsx`: selector geometry, keyboard focus, authorization method selection, localized narrow layouts and forced-color presentation.

- `internal/envapp/ui_src/src/ui/icons/RemoteDesktopIcon.tsx`: shared monitor-and-pointer silhouette and compact launcher rendering.

- `internal/envapp/ui_src/src/ui/icons/WorkbenchSoftIcons.tsx`: themed Remote Desktop Dock tile.

- `internal/envapp/ui_src/src/styles/navigationIcons.browser.test.tsx`: actual-size silhouettes, theme and high-contrast checks.
