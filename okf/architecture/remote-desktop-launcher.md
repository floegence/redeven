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
- Closing the launcher dialog through its close button, Escape or backdrop dismisses the view without canceling SSH preparation. The launcher retains one operation and progress subscription; its entry reports preparation, required input or the observed outcome, and reopening restores that state. Explicit Cancel still stops preparation and reports rollback. Dismissal clears typed credentials and withdraws automatic viewer opening; completed preparation offers an explicit connection action. Password and interruption challenges retain their existing deadline and require user response. Pending viewer creation is still released on dismissal, and environment navigation, launcher disposal or Desktop window closure still cancels its owned work.
- SSH host preparation presents observed checking, component, service and verification stages. The Desktop bridge forwards the published component media substate (`checking`, `downloading`, `receiving`, `verifying`, `installing`, `validating`, `ready`) only while the deployment stage is `preparing_media`; older byte-only reports remain valid. Component byte progress appears only during an observed transfer with a real total and received count. Integrity checking, unpacking, validation and packaging use one calm indeterminate Floe progress cue, so a completed download never masquerades as completed preparation. Avoid simultaneous spinners, shimmer and sweeping effects; static current-step emphasis and observed detail communicate stage changes. Interrupted or rollback states never imply completion.
- Preparation keeps a compact viewport-bounded content area while observed detail text and transfer metrics change. The seven-step list scrolls independently within a 128px maximum height, yields space to wrapped status copy, and keeps the active step visible without moving keyboard focus. Compact markers center digits and checks; the section heading needs no decorative activity dot. Status copy uses its natural line count with a small gap above the progress bar instead of reserving empty text rows; the dialog footer remains stable across preparation updates. The current detail is announced through a single atomic status region, the progress wrapper owns the accessible progressbar semantics, and the visual Floe primitive is decorative. Reduced-motion and forced-colors preferences disable decorative motion while retaining a visible state boundary.
- Authorization starts with one brief administrator-access sentence and a collapsed native permission disclosure. Full service scope and SSH setup details remain available on demand; the authorization selector and next action stay prominent. Authorization, password and result content use their natural height with an 18px gap before the actions. Constrained viewports scroll only the middle content area while retaining the host, steps and footer, including when permission details expand. Password focus reveals the field; stage-heading focus preserves the scroll position.
- Initial content is target/readiness/connect. Admin/display selectors retain native keyboard behavior/labels; decorative chevrons sit 12px inside the field with separate text padding and no pointer interception.
- Disabling approval reuse requests confirmation on future connections without revoking OS grants. Status refresh cannot erase connection failure.

# Boundaries

Desktop retains origin-only target validation and environment-scoped route admission. Product adapters cannot accept malformed session data to bypass either.

# Evidence

- `internal/envapp/ui_src/src/ui/pages/RemoteDesktopPanel.browser.test.tsx`: selector geometry, keyboard focus, authorization method selection, localized narrow layouts and forced-color presentation.

- `internal/envapp/ui_src/src/styles/remoteDesktopLauncher.browser.test.tsx`: dialog dismissal preserves preparation/progress, background completion requires an explicit connection, pending challenges survive without retaining typed credentials, explicit cancellation still works, and late viewer sessions are released.

- `internal/envapp/ui_src/src/ui/icons/RemoteDesktopIcon.tsx`: shared monitor-and-pointer silhouette and compact launcher rendering.

- `internal/envapp/ui_src/src/ui/icons/WorkbenchSoftIcons.tsx`: themed Remote Desktop Dock tile.

- `internal/envapp/ui_src/src/styles/navigationIcons.browser.test.tsx`: actual-size silhouettes, theme and high-contrast checks.
