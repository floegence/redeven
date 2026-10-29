---
type: Validation Guide
title: Linux desktop and package compatibility validation
tags: [operations, host-applications, validation, linux, packages]
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

The [platform contract](../architecture/host-application-platforms.md) is qualified
by real processes, windows, native input receipts and saved files. Floe Native Apps
owns reusable graphics/package/service evidence; Redeven owns product launch,
sharing, rendering and recovery evidence. Each claim retains its source/component
identity. Prototype results do not substitute for exact-release qualification.
Missing capabilities remain explicit failures, and no result certifies arbitrary
applications, physical GPUs or every desktop version.

# Contract

## Release identity and evidence layers
The retained qualification below consumed published `github.com/floegence/floe-native-apps` v0.21.0 at `a7f3b76a2a9dd64ba13b303c24d7bed645b33441`, with module checksum `h1:E1Wgl8aRB/h53ejCCDkUwlrj3uC2zx+SGcAODZZ5nWg=`.

| Architecture | Combined component digest |
| --- | --- |
| amd64 | `f8f29cf383166c4e7c6728b6c1f696ab015391875dc2a370f283d4d4ca457a90` |
| arm64 | `93a0210e630a54d176f9b8f6ff3fc21605a348d6f97c7c5c8127fa6cd7a484be` |

## Package, desktop and graphics coverage
| Case | Evidence and scope |
| --- | --- |
| Strict Snap Firefox | Real user-systemd scope, private graphics/bus, native confirmed text and saved document in upstream qualification; Redeven browser adds click-to-type, repeat, field selection, copy/paste and toolbar receipts |
| Flatpak GTK/Qt | GNOME Text Editor and KWrite use real sandboxes, package metadata, remote official file dialogs and document grants upstream; Redeven verifies native first frame, repeated Unicode, selection replacement, text/Enter order and actual Ctrl+S bytes |
| Native DEB/RPM | Native GTK/Qt/browser and GNOME Text Editor receipts; retained Fedora 44 RPM Firefox 156.0.1 and Text Editor 50.1 evidence keeps SELinux Enforcing and original signed packages |
| AppImage/classic Snap | Retained original mounted Notepad Next v0.15 and classic Snap Emacs 31.1 input/save/reconnect/exit evidence; Redeven additionally verifies mounted AppImage click-to-type, Unicode, replacement and exact Ctrl+S bytes; no extraction or sandbox bypass |
| Desktop coexistence | Actual GNOME Xorg/Wayland, KDE Wayland and Xfce X11 shells in disposable native KVM qualification, with unrelated applications retained; these virtual-display tests do not certify physical GPUs |
| No full desktop | Native application preparation and private software rendering without a monitor or complete desktop; sandbox package requirements remain separate |
| Wayland/Xwayland | Pure GTK/Qt/Chromium Wayland and mixed native window families, menus, oversized dialogs, generation-bound input and reconnect; retained Xpra remains an explicit distinct backend |

## Product acceptance
The retained v0.21.0 qualification repeats production-viewer native input on Chromium, Firefox and WebKit and actual Chrome/Firefox stream acceptance on udesk26. The [performance guide](host-application-performance.md) owns picture modes, bandwidth, latency, bounded decode work and explicit claim limits.

Test harnesses consume current session state rather than fabricating perpetual `running` status.

# Boundaries

## Interpretation and remaining limits
The earliest Qt product fixture incorrectly supplied KWrite's unsupported `--new` argument. Its launcher exit 1 is retained as failure evidence; the valid official command passes.

Local Desktop/companion Runtime deployment records the merged commit, bundled helper and readiness separately from upstream release evidence.

# Evidence

- [Upstream v0.21.0 release](https://github.com/floegence/floe-native-apps/releases/tag/v0.21.0): immutable module and component contract.

- [Exact-tag Release gate](https://github.com/floegence/floe-native-apps/actions/runs/36353860373) and [same-commit qualification](https://github.com/floegence/floe-native-apps/actions/runs/36352416815): native dual-architecture qualification.

- [Published desktop qualification corpus](https://github.com/floegence/floe-native-apps/tree/v0.21.0/qualification/desktop_compatibility): pinned test definitions, prototype source identities and package/desktop limits.
