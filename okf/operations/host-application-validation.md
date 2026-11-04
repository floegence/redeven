---
type: Validation Guide
title: Host application qualification methods and platform evidence
tags: [runtime, applications, linux, validation]
lifecycle: active_evidence
reviewed_at: "2026-11-04"
---
# Summary

Qualify process, window, decoded picture and actual application effects independently through published dependencies. Package/userspace results never certify host policy, arbitrary apps, physical pointers or OS IME. Preserve original failures, exact source scope and save/cancel behavior through recovery.

# Contract

## Input, cursor and lifecycle acceptance
Require independent app receipts/exact saved bytes, not dispatch/DOM focus. REDEVEN_TEST_DESKTOP_COMPONENT_STATE selects task-owned published combined resources. Missing CJK/emoji fonts neither invalidate exact strings nor qualify visible glyphs. TestInstalledDesktopApplicationTransport covers input/save, invalid clipboard with canceled dependent input, recreated manager/same helper, read-only rejection of unknown records and indefinite live first-window wait beyond40s.

Native0.22.19/Floe0.86.0 maps keys to Linux seat, confirms Unicode for other layouts and orders clipboard before paste. Never paste stale selection,replay text or release composition after scroll. macOS retains native authority; shared canvas extraction needs first-frame/toolbar/reconnect/stale-target tests and real fixture input. OS pointer appearance needs physical observation; page screenshots/decoded-image checks cannot prove it. Synthetic touch/composition cannot certify OS candidates/soft keyboard/physical pinch.

Lifecycle fixtures independently verify:
- Existing single-instance Mac reuse and survival after lease release;48s first-window wait without relaunch. Picker counts/literal titles preserve focus; cancel close/quit preserves app/pixels/sharing/retry.
- Unreadable/replaced surfaces never expire into closure; confirmed last-window closes established viewers. Linux dialog-only apps show native-size decoded dialogs.
- Stale quit rejects whole set before termination; unknown retains error/no inferred exit/retry. Read-only lists cannot quit/detach.
- Reload/network preserves process, suspends input/capture and frees buffers before same-session/current-credential reconnect. Successor revokes prior input/releases held keys/suspends capture.
- Distinct permission/lock recovery. Helper failure is sharing failure, not app exit: retire route/credential/buffers/helper before terminal publication; fence late callbacks and retain unknown pages.
- Unknown foreground/window rejects without replay/retargeting; missing decoder negotiates same-process images.

Toolbar: fixed bar/resizable content,320/390/1000px popovers, keyboard menus, separate close/confirmed quit, late dismissal/no replay. Native quit covers visible/windowless apps,cancel/stale generations. Run three-engine pointer/appearance via `pnpm --dir internal/envapp/ui_src test:host-application-browser`. Actual system grants remain explicit; save-dialog cancellation never permits force exit. [Platform behavior](../architecture/host-application-behavior.md) owns OS differences.

# Boundaries

Installed/translated userspaces do not establish boot,kernel,SELinux/AppArmor,GPU/login policy. Native timings exclude viewer startup/decode unless measured end-to-end. Capture/accessibility grants and unavailable devices limit evidence; untested targets remain unqualified. Harnesses own disposable resources and never fabricate running state. Runtime/companion deployment records its commit/helper/readiness separately from upstream release. [Performance](host-application-performance.md) owns budgets, [preparation](host-application-setup.md) owns administrator commands.

# Evidence

## Historical distribution/input
Native0.1.2: Ubuntu22.04arm64/Debian11amd64 Xpra discovery,decoded pixels,private D-Bus/button receipts; require another authoritative inventory within3s of readiness. Native0.5.1 [release35834089131](https://github.com/floegence/floe-native-apps/actions/runs/35834089131) records dual-architecture managed/system input. Published web0.71.0 remote-input (later0.72.0), September24 core0.77.1 pointer follow-up remain historical, not OS IME proof.

Native0.6.2 [release35861913545](https://github.com/floegence/floe-native-apps/actions/runs/35861913545): Linux amd64/arm64 install/update/source/race/vet/vulnerability/archive/managed-system Xpra plus proxy/SumDB readback. TestInstalledClientInputViewer owns state/display/port/app. Disposable Mac passes pixels/click/Unicode/shortcut/menu/reconnect/stale-input/resize/replacement/close. Physical pointers in shipped Electron/Chrome/Safari/Firefox at80/100/125/150/200% and monitor changes remain unqualified.

## Retained Xpra/platform matrix
- Ubuntu22.04/Orange6.5.3/v20: native product/browser/Desktop/input/reconnect.
- Debian13 6.5.3+xpra-x11/v21: GIO/X11/browser input/reconnect/exit.
- Fedora43/openSUSE Tumbleweed6.5.3/v20: same installed/GIO scope.
- Alpine3.23arm64 6.2.2/v20: static GNU Runtime/native terminal/GIO/lifecycle/browser.
- Archx86_64 6.4.4/v20: GIO/X11 with translated Runtime/browser, no native hardware proof.
- Alma/Rocky9x86_64 6.5.3/v21: GIO/isolated X11 only.

macOS26.5.2arm64 with existing graphical grants: disposable AppKit real bundle/icon/launch/pixels,input/Unicode/shortcut/menu/AX resize,same-process reconnect/stale rejection/closure,including idle-helper replayd contention. This covers no Snap/Flatpak/Wayland/arbitrary apps.

## Combined packages
Published0.21.0 a7f3b76a2a9dd64ba13b303c24d7bed645b33441, module h1:E1Wgl8aRB/h53ejCCDkUwlrj3uC2zx+SGcAODZZ5nWg=; combined SHA256 amd64 f8f29cf383166c4e7c6728b6c1f696ab015391875dc2a370f283d4d4ca457a90,arm64 93a0210e630a54d176f9b8f6ff3fc21605a348d6f97c7c5c8127fa6cd7a484be. [Release36353860373](https://github.com/floegence/floe-native-apps/actions/runs/36353860373)/[qualification36352416815](https://github.com/floegence/floe-native-apps/actions/runs/36352416815)/[corpus](https://github.com/floegence/floe-native-apps/tree/v0.21.0/qualification/desktop_compatibility) retain original matrix:
- Strict Snap Firefox: user-systemd/private graphics/bus,native text/save and product click/type/repeat/select/copy/paste/toolbar.
- Flatpak GTK Text Editor/Qt KWrite: official dialogs/document grants,first-frame/Unicode/replacement/Enter/exact Ctrl+S bytes. Unsupported KWrite --new exits1 and remains failed; official valid command passes.
- DEB/RPM GTK/Qt/browser,including Fedora44 Firefox156.0.1/Text Editor50.1,SELinux Enforcing/original signed packages.
- Mounted AppImage NotepadNext0.15/classic Snap Emacs31.1: input/save/reconnect/exit; AppImage exact product saved bytes, no extraction/bypass.
- Disposable native KVM GNOME Xorg/Wayland,KDE Wayland,Xfce X11 preserves unrelated apps, no physical-GPU claim. No-desktop private software rendering still requires package services.
- Wayland/Xwayland GTK/Qt/Chromium families/menus/oversize dialogs and generation-bound reconnect/input; Xpra separate.

Product input repeats on Chromium/Firefox/WebKit and actual Chrome/Firefox streams on udesk26. Source suites: internal/hostapps/{manager,setup,client_input,desktop_installed,package_installed}_test.go; scripts/{check_host_application_input,host_application_native_acceptance,check_host_application_lifecycle}.mjs. Lifecycle uses production assets/controlled streams, not native-capture certification; native waiting/termination Python runners plus nativeHostApplication.swift provide independent Mac receipts. Git retains per-run detail and original failures.
