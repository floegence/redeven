---
type: Validation Guide
title: Linux desktop and package compatibility validation
tags: [operations, host-applications, validation, linux, packages]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
---
# Summary

Real processes, native input and saved files qualify the named platform/source. Floe Native Apps owns reusable graphics/package evidence; Redeven owns launch, viewing and recovery. Prototype success cannot certify the exact release, arbitrary applications, physical GPUs or untested desktop versions.

# Contract

Published floe-native-apps v0.21.0: source a7f3b76a2a9dd64ba13b303c24d7bed645b33441; module h1:E1Wgl8aRB/h53ejCCDkUwlrj3uC2zx+SGcAODZZ5nWg=; combined SHA-256 amd64 f8f29cf383166c4e7c6728b6c1f696ab015391875dc2a370f283d4d4ca457a90, arm64 93a0210e630a54d176f9b8f6ff3fc21605a348d6f97c7c5c8127fa6cd7a484be.

| Scope | Real evidence |
| --- | --- |
| Strict Snap Firefox | User-systemd/private graphics/bus, native text/save upstream; product click/type/repeat/select/copy/paste/toolbar |
| Flatpak GTK/Qt | Text Editor/KWrite sandbox metadata, official dialogs/document grants; product first frame, Unicode/replacement/Enter ordering and exact Ctrl+S bytes |
| DEB/RPM | Native GTK/Qt/browser; Fedora 44 Firefox 156.0.1/Text Editor 50.1 with SELinux Enforcing and original signed packages |
| AppImage/classic Snap | Mounted Notepad Next 0.15/Emacs 31.1 input/save/reconnect/exit; AppImage product exact saved bytes, without extraction/bypass |
| Desktop coexistence | GNOME Xorg/Wayland, KDE Wayland, Xfce X11 in disposable native KVM; preserve unrelated apps, no physical-GPU claim |
| No desktop | Private software rendering without monitor/full desktop; package prerequisites still apply |
| Wayland/Xwayland | GTK/Qt/Chromium, mixed families/menus/oversized dialogs, generation-bound input/reconnect; Xpra is separate |

Repeat production-viewer input on Chromium/Firefox/WebKit and real Chrome/Firefox streams on udesk26. [Performance](host-application-performance.md) owns modes/budgets/limits. Harnesses read current sessions, never fabricate running status.

# Boundaries

## Interpretation and remaining limits
The earliest Qt product fixture incorrectly supplied KWrite's unsupported `--new` argument. Its launcher exit 1 is retained as failure evidence; the valid official command passes.

Local Desktop/companion Runtime deployment records the merged commit, bundled helper and readiness separately from upstream release evidence.

# Evidence

- [Upstream v0.21.0 release](https://github.com/floegence/floe-native-apps/releases/tag/v0.21.0): immutable module and component contract.

- [Exact-tag Release gate](https://github.com/floegence/floe-native-apps/actions/runs/36353860373) and [same-commit qualification](https://github.com/floegence/floe-native-apps/actions/runs/36352416815): native dual-architecture qualification.

- [Published desktop qualification corpus](https://github.com/floegence/floe-native-apps/tree/v0.21.0/qualification/desktop_compatibility): pinned test definitions, prototype source identities and package/desktop limits.
