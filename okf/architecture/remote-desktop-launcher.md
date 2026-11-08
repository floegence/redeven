---
type: Interaction Contract
title: Remote desktop connection launcher
tags: [desktop, applications, interaction, accessibility]
lifecycle: contract
reviewed_at: "2026-11-08"
---
# Summary

One Host Applications/Workbench flow identifies host, readiness and primary action, continuing consent in place under session policy. First-entry host choices distinguish individual applications from the whole desktop. The launcher keeps feature management reachable after setup. Paused/unconfigured access needs explicit enable/connect; refreshing capabilities changes no intent. Shared grants are explained separately from feature controls. macOS setup names screen display and mouse/keyboard purpose before system permission names. View-only requires screen permission only. Reconfiguration rechecks grants; pause/removal confirms its connection scope and preserves running applications.

# Contract

- Navigation uses the shared monitor/pointer mark. Onboarding SVGs instead show one selected window versus a whole desktop with multiple windows and a taskbar. Permission diagrams show picture delivery versus keyboard/pointer input. Management shows retained settings with explicit enabled, paused or removal marks. Localized adjacent text carries meaning; SVGs are decorative, theme-aware and legible without animation. Hover/focus may briefly explain delivery, never suggest ongoing setup; reduced motion and forced colors disable it.
- Keep diagnostic/retry after failure; cancellation stops only selected setup without reloading.
- SSH preparation, operation-bound challenge, progress and desktop opening stay in the same dialog. [SSH deployment](remote-desktop-ssh-deployment.md) owns admin scope/credential lifetime; opening the launcher changes no OS permission.
- Close/Escape/backdrop dismisses without canceling SSH preparation: retain one operation/subscription and restore observed progress/input/outcome on reopen. Explicit Cancel rolls back. Dismissal clears credentials and automatic opening; completed setup requires Connect. Challenges retain deadlines and require user response. Dismissal releases pending viewer creation; environment navigation, disposal and Desktop closure cancel owned work.
- Show actual check/component/service/verification stages. Forward media substate (checking/downloading/receiving/verifying/installing/validating/ready) only during preparing_media, preserving older byte reports. Determinate progress requires real transfer counts/total; validation/unpack/package uses one calm indeterminate Floe cue. No concurrent spinner/shimmer/sweep or false completion after interruption/rollback.
- Keep viewport-bounded content and stable footer. Seven steps scroll independently within128px, yield to wrapped status and reveal active row without moving focus. Center digit/check markers, omit decorative heading dots. Status takes natural height with small progress gap and one atomic announcement; wrapper owns progressbar semantics, visual Floe primitive is decorative. Reduced motion/forced colors suppress decoration while preserving state boundaries.
- Start authorization with brief admin sentence and collapsed permission details; keep selector/next action prominent. Authorization/password/results use natural height and18px action gap. Short views scroll only middle content, retaining host/steps/footer even with expanded details. Password focus reveals input; heading focus preserves scroll.
- Initial content is target/readiness/connect. Admin/display selectors retain native keyboard behavior/labels; decorative chevrons sit 12px inside the field with separate text padding and no pointer interception.
- Disabling approval reuse requests confirmation on future connections without revoking OS grants. Status refresh cannot erase connection failure.

# Boundaries

Desktop retains origin-only target validation and environment-scoped route admission. Product adapters cannot accept malformed session data to bypass either.

# Evidence

- `HostAccess.browser.test.tsx`: distinct access scenes, permission/settings states, narrow layouts, keyboard focus, reduced motion and forced colors.

- `internal/envapp/ui_src/src/ui/pages/RemoteDesktopPanel.browser.test.tsx`: selector geometry, keyboard focus, authorization method selection, localized narrow layouts and forced-color presentation.

- `internal/envapp/ui_src/src/styles/remoteDesktopLauncher.browser.test.tsx`: dialog dismissal preserves preparation/progress, background completion requires an explicit connection, pending challenges survive without retaining typed credentials, explicit cancellation still works, and late viewer sessions are released.

- `internal/envapp/ui_src/src/ui/icons/RemoteDesktopIcon.tsx`: shared monitor-and-pointer silhouette and compact launcher rendering.

- `internal/envapp/ui_src/src/ui/icons/WorkbenchSoftIcons.tsx`: themed Remote Desktop Dock tile.

- `internal/envapp/ui_src/src/styles/navigationIcons.browser.test.tsx`: actual-size silhouettes, theme and high-contrast checks.
