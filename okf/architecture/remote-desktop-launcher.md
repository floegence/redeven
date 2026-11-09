---
type: Interaction Contract
title: Remote desktop connection launcher
tags: [desktop, applications, interaction, accessibility]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Host Applications separates connection, setup and feature management. Access settings directly manages independent application-window and desktop access. Local application launch needs no remote-access permission. Setup asks only for missing grants; daily connection stays focused.

# Contract

- Connection omits environment names and completed grants. Show a display selector only for multiple displays, visible control/view-only choices and one connect action. Settings replaces connection. Viewer/SSH requests retain host identity.
- Onboarding SVGs distinguish one window from the whole desktop; settings uses corresponding compact marks. Localized text carries meaning. Theme-aware artwork supports reduced motion/forced colors.
- Setup shows only missing grants, naming screen/input purpose before OS permission names. View-only requires no input grant. Settings separates system-permission management and explains shared scope.
- Enabled features offer pause; paused features resume; unconfigured features setup; missing prerequisites completion. Neither feature exposes reset/removal. Ready features have no overflow menu; incomplete enabled features retain a scoped pause action. Pause requires confirmation and preserves preferences. Refresh changes no intent or viewer. Local app launch needs no capture/input grant. Recovery uses icon-free shared rows with trailing actions; restart confirmation replaces the row description and retains explicit admission.
- Preserve failure diagnostics/retry; cancellation stops only selected setup without reload. Status refresh cannot erase connection failure. Disabling approval reuse requests future confirmation without revoking OS grants.
- SSH preparation, operation-bound challenge, progress and opening stay in one dialog. [SSH deployment](remote-desktop-ssh-deployment.md) owns admin scope and credential lifetime. Opening the launcher changes no OS permission.
- Close/Escape/backdrop retains one preparation operation/subscription and restores progress/input/outcome on reopen. Explicit Cancel rolls back. Dismissal clears credentials/auto-opening and releases pending viewers; completed setup requires Connect. Challenges retain deadlines and require response. Navigation, disposal and Desktop closure cancel owned work.
- Display observed check/component/service/verification stages. Forward media substate only during preparing_media, retaining older byte reports. Determinate progress requires actual counts/total; validation/unpack/package uses one indeterminate Floe cue. Never combine spinner/shimmer/sweep or imply completion after interruption/rollback.
- Bound content to viewport with a stable footer. Seven steps scroll within 128px, wrap and reveal active rows without moving focus. Center digit/check markers; omit heading dots. Status has natural height, compact progress gap and one atomic announcement. Wrapper owns progressbar semantics; visual primitive is decorative. Reduced motion/forced colors retain state boundaries without animation.
- Authorization uses brief admin copy, collapsed details and prominent selector/action. Authorization/password/results use natural height and an 18px action gap. Only middle content scrolls in short views; host/steps/footer remain visible with expanded details. Password focus reveals input; heading focus preserves scroll.
- Native selectors preserve labels/keyboard. Decorative chevrons reserve text padding and intercept no pointer events. Switching connection/settings preserves keyboard focus.

# Boundaries

Desktop retains origin-only target validation and environment-scoped admission. Adapters cannot bypass either.

# Evidence

- `HostAccess.browser.test.tsx`: management, local launch, grants, lifecycle, narrow locales and artwork.
- `RemoteDesktopPanel.browser.test.tsx`: selectors, focus, authorization and localized/forced-color layouts.
- `src/styles/remoteDesktopLauncher.browser.test.tsx`: connection/setup views, focus, dismissal continuity, explicit connection, credential clearing, challenges, cancellation and late-viewer release.
- `RemoteDesktopIcon.tsx`, `WorkbenchSoftIcons.tsx` and `navigationIcons.browser.test.tsx`: monitor/pointer navigation, themed Dock tile, actual-size silhouettes and high contrast.
