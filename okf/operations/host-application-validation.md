---
type: Validation Guide
title: Host application qualification methods and platform evidence
tags: [runtime, applications, linux, validation]
lifecycle: active_evidence
reviewed_at: "2026-11-04"
---
# Summary

Qualify process/window, decoded picture and actual app effects independently using published dependencies. Preserve failures, exact scope and save/cancel semantics. Userspace/package evidence certifies no host policy, arbitrary app, physical pointer or OS IME.

# Contract

## Input, cursor and lifecycle acceptance
Require app receipts/exact saved bytes, not dispatch/DOM focus. REDEVEN_TEST_DESKTOP_COMPONENT_STATE selects owned published combined resources. Missing CJK/emoji fonts neither invalidate bytes nor qualify glyphs. TestInstalledDesktopApplicationTransport covers input/save, invalid clipboard canceling dependent input, manager recreation/same helper, read-only rejection and live first-window waits beyond40s.

Published Native/Floe maps Linux seat keys, confirms Unicode for other layouts and orders clipboard before paste. Never paste stale selections, replay text or release composition after scroll. macOS retains native authority. Shared canvas changes need first-frame/toolbar/reconnect/stale-target and real input tests. Physical pointers require physical observation; synthetic touch/composition proves no OS candidates, keyboard or pinch.

Fixtures independently establish:
- Mac single-instance reuse survives lease release;48s first-window wait does not relaunch. Picker counts/literal titles preserve focus. Canceled close/quit preserves app/pixels/sharing/retry.
- Unreadable/replaced surfaces do not expire into closure; confirmed last-window closure ends viewers. Linux dialog-only apps show native-size decoded dialogs.
- Stale quit rejects the whole set before termination; unknown retains error without inferred exit/retry. Read-only lists cannot quit/detach.
- Reload/network preserves process, suspends input/capture and frees buffers before same-session/current-credential reconnect. Successors revoke old input/release held keys/suspend capture.
- Permission/lock recovery is distinct. Helper failure is sharing failure, not app exit: retire route/credential/buffers/helper before terminal state; fence callbacks and preserve unknown pages.
- Unknown foreground/window rejects without replay/retarget. Missing decoder negotiates images from the same process.

Toolbar has fixed bar/resizable content,320/390/1000px popovers, keyboard menus, separate close/confirmed quit and late-dismissal fencing. Native quit covers windowless/visible apps, cancellation and stale generations. Run pnpm --dir internal/envapp/ui_src test:host-application-browser for three-engine pointer/appearance. System grants remain explicit; canceled save dialogs never authorize force exit. [Platform behavior](../architecture/host-application-behavior.md) owns OS differences.

# Boundaries

Translated userspaces establish no boot/kernel/SELinux/AppArmor/GPU/login behavior. Native timings exclude viewer startup/decode unless measured. Grants/devices limit scope; untested targets stay unqualified. Harnesses own disposable resources without fabricated running state. Record deployed Runtime/companion commit/helper/readiness separately from release. [Performance](host-application-performance.md) owns budgets; [setup](host-application-setup.md) owns admin commands.

# Evidence

## Historical distribution/input
Native0.1.2 covered Ubuntu22.04arm64/Debian11amd64 Xpra discovery/pixels/private D-Bus/button receipts, with independent inventory within3s. Releases [0.5.1](https://github.com/floegence/floe-native-apps/actions/runs/35834089131) and [0.6.2](https://github.com/floegence/floe-native-apps/actions/runs/35861913545) retain dual-architecture managed/system input, install/update/source/race/vet/vulnerability/archive and proxy/SumDB evidence. Disposable Mac passed pixels/click/Unicode/shortcut/menu/reconnect/stale-input/resize/replacement/close. Historical web pointer follow-ups do not qualify OS IME or physical pointers across browsers/zoom/monitors.

## Retained Xpra/platform matrix
Ubuntu22.04/Orange6.5.3v20, Debian13 6.5.3+xpra-x11v21 and Fedora43/openSUSE6.5.3v20 covered installed/native/GIO/X11/browser input/reconnect as recorded. Alpine3.23arm64 6.2.2v20 used static GNU Runtime/native terminal/GIO/lifecycle/browser. Archx86_64 6.4.4v20 used translated Runtime/browser, not native hardware. Alma/Rocky9x86_64 6.5.3v21 covered GIO/isolated X11 only.

macOS26.5.2arm64 with existing grants covered disposable AppKit bundle/icon/launch/pixels, Unicode/shortcut/menu/AX resize, same-process reconnect/stale rejection/closure and idle-helper replayd contention; no arbitrary app/Snap/Flatpak/Wayland claim.

## Combined packages
Published0.21.0 commit a7f3b76a2a9dd64ba13b303c24d7bed645b33441: [release](https://github.com/floegence/floe-native-apps/actions/runs/36353860373), [qualification](https://github.com/floegence/floe-native-apps/actions/runs/36352416815) and [immutable corpus](https://github.com/floegence/floe-native-apps/tree/v0.21.0/qualification/desktop_compatibility) retain hashes and original matrix:
- Strict Snap Firefox: user-systemd/private graphics/bus, native text/save and product click/type/repeat/select/copy/paste/toolbar.
- Flatpak GTK Text Editor/Qt KWrite: official document grants/dialogs, first-frame/Unicode/replacement/Enter/exact Ctrl+S bytes. Invalid KWrite --new exit1 remains failed; valid official command passes.
- Original signed DEB/RPM GTK/Qt/browser packages, including Fedora44 Firefox156.0.1/Text Editor50.1 with SELinux Enforcing.
- Mounted NotepadNext0.15 AppImage/classic Snap Emacs31.1: input/save/reconnect/exit; exact AppImage product bytes without extraction/bypass.
- Disposable native KVM GNOME Xorg/Wayland,KDE Wayland,Xfce X11 preserves unrelated apps; software rendering still needs package services. No physical-GPU claim.
- Wayland/Xwayland GTK/Qt/Chromium menus/dialogs and generation-bound reconnect/input; Xpra remains separate.

Product inputs repeated on Chromium/Firefox/WebKit and actual Chrome/Firefox streams on udesk26. internal/hostapps installed/input/package suites and scripts/check_host_application_{input,lifecycle}.mjs own regression evidence. Controlled-stream lifecycle is not native-capture certification; native Python runners/nativeHostApplication.swift provide independent Mac receipts. Git retains original per-run hashes/failures.
