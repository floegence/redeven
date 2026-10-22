---
type: Architecture Contract
title: Host application platform validation
description: Assess the tested Linux userspace and native macOS application matrix with explicit hardware and policy limits.
tags: [operations, host-applications, validation, platforms]
timestamp: 2026-09-24T00:00:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

Host application platform acceptance records real installed-stack and native
session evidence under the [platform contract](../architecture/host-application-platforms.md).
The matrix identifies exactly which userspace, Runtime, CPU and display combinations
were exercised. Container or translated-CPU results cannot certify host boot,
kernel, security policy or native hardware behavior. Missing permissions, unavailable
subscriptions and untested environments remain unqualified; they never become
successful simulated acceptance.

# Contract

The current combined backend and package matrix is owned by the [desktop compatibility record](host-application-desktop-validation.md). The older Xpra results below qualify that retained backend only; they are not evidence for Snap, Flatpak, Wayland or a newly prepared combined component.

## Retained Xpra distribution validation
The historical Xpra matrix below covers userspace installations without a desktop environment or monitor. Container checks cannot certify a distribution's boot, kernel, SELinux/AppArmor, GPU, or login policies.

| Environment | Installed stack | Evidence scope |
| --- | --- | --- |
| Ubuntu 22.04, orange host | Xpra 6.5.3, HTML5 v20 | Native host application acceptance, browser/Desktop window controls, input and reconnect |
| Debian 13 | Upstream Xpra 6.5.3 packages with explicit `xpra-x11`, HTML5 v21 | GIO checks; X11 launch/resume/stop; browser display, input, reconnect and application-exit closure |
| Fedora 43 | Distribution Xpra 6.5.3, separately installed HTML5 v20 | Same installed-stack and GIO checks |
| openSUSE Tumbleweed | Distribution Xpra 6.5.3, separately installed HTML5 v20 | Same installed-stack and GIO checks |
| Alpine 3.23 ARM64 | Distribution Xpra 6.2.2, upstream HTML5 v20, static GNU Redeven Runtime | GIO; launch/resume/stop; complete Runtime and native terminal; browser display, input, reconnect and application-exit closure |
| Arch Linux x86_64 | Distribution Xpra 6.4.4, upstream HTML5 v20 | GIO and isolated X11 launch/resume/stop in the prepared userspace; complete Runtime and browser flow under the translation constraints below |
| AlmaLinux 9 x86_64 | Upstream Xpra 6.5.3, HTML5 v21 | GIO and isolated X11 launch/resume/stop in the prepared userspace |
| Rocky Linux 9 x86_64 | Upstream Xpra 6.5.3, HTML5 v21 | GIO and isolated X11 launch/resume/stop in the prepared userspace |

## macOS validation
The native adapter was exercised on macOS 26.5.2 ARM64 in a logged-in graphical session with capture and accessibility permission. The disposable AppKit fixture verifies real bundle metadata/icons, direct launch, captured pixels, pointer input, Unicode text, native shortcuts, actual menu invocation, real AX resize, reconnect without a new process, stale input rejection, and application-window closure.

This covers the idle-helper replayd contention that single-application startup tests cannot detect; the [capture ownership contract](../architecture/macos-application-capture-owner.md) defines the required process and channel boundaries.

# Boundaries

The matrix is evidence for its named versions and scenarios, not a distribution allowlist or certification of arbitrary applications. Native timing excludes viewer startup and decode unless explicitly measured end to end. Test harnesses own disposable processes and data; product applications continue to run directly on the authorized host.

# Evidence

- `redeven:internal/hostapps/manager_test.go` - Installed GIO and Xpra launch, resume and stop checks.

- `redeven:scripts/check_macos_host_application_input_targets.py` - Actual Chrome and Terminal input receipts.

- `redeven:scripts/check_macos_host_application_startup.py` - Native attach, reconnect and capture lifecycle measurements.
