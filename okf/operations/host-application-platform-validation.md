---
type: Architecture Contract
title: Host application platform validation
tags: [operations, host-applications, validation, platforms]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
---
# Summary

Native installed-stack evidence qualifies only the listed userspace, Runtime, CPU and display matrix. Containers/translated CPUs prove no host boot, kernel, security policy or native hardware behavior. Missing permissions/subscriptions and untested targets remain unqualified.

# Contract

[Combined desktop/package evidence](host-application-desktop-validation.md) supersedes the retained Xpra lane for new components. Historical Xpra userspaces have no desktop/monitor and cannot qualify boot, kernel, SELinux/AppArmor, GPU or login policy.

| Userspace | Installed Xpra / HTML5 | Qualified scope |
| --- | --- | --- |
| Ubuntu 22.04, Orange | 6.5.3 / v20 | Native product, browser/Desktop controls, input/reconnect |
| Debian 13 | 6.5.3 plus xpra-x11 / v21 | GIO, X11 lifecycle, browser input/reconnect/exit |
| Fedora 43; openSUSE Tumbleweed | 6.5.3 / v20 | Same installed-stack/GIO scope |
| Alpine 3.23 ARM64 | 6.2.2 / v20 | Static GNU Runtime/native terminal plus GIO/lifecycle/browser |
| Arch x86_64 | 6.4.4 / v20 | GIO/X11 lifecycle; translated Runtime/browser, not native hardware |
| AlmaLinux 9; Rocky Linux 9 x86_64 | 6.5.3 / v21 | GIO and isolated X11 lifecycle only |

macOS 26.5.2 ARM64 graphical session with capture/accessibility grants: disposable AppKit verifies real bundle/icon, launch/pixels, pointer/Unicode/shortcuts/menu/AX resize, same-process reconnect, stale-input rejection and window closure. Include idle-helper replayd contention; [capture ownership](../architecture/macos-application-capture-owner.md) owns process/channel boundaries. This evidence does not qualify Snap, Flatpak, Wayland or arbitrary applications.

# Boundaries

The matrix is evidence for its named versions and scenarios, not a distribution allowlist or certification of arbitrary applications. Native timing excludes viewer startup and decode unless explicitly measured end to end. Test harnesses own disposable processes and data; product applications continue to run directly on the authorized host.

# Evidence

- `redeven:internal/hostapps/manager_test.go` - Tests.
