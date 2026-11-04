---
type: Operations Guide
title: Prepare Linux hosts for native applications
tags: [runtime, applications, linux, installation]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
---
# Summary

Floe Native Apps prepares managed Wayland/Xwayland; Desktop may transfer verified offline archives. No monitor/full desktop is needed. Snap/Flatpak require installed services; missing prerequisites get guidance, never automatic security changes. Refresh after explicit admin preparation.

# Contract

Optional system Xpra is an explicitly selected X11 path, never a fallback from combined-backend failure. Administrators own privileged installation/policy; [preparation](../architecture/host-applications.md#preparation) owns the default managed stack.

Arch uses official x86_64 repositories/full upgrades; optional test app: sudo pacman -S --needed xterm. Enterprise Linux 9 targets x86_64: upstream repository files https://raw.githubusercontent.com/Xpra-org/xpra/master/packaging/repos/rockylinux/xpra.repo and https://raw.githubusercontent.com/Xpra-org/xpra/master/packaging/repos/almalinux/xpra.repo; install xterm separately. Alpine 3.23 needs matching official main/community. A dynamic GNU Runtime may report not-found despite existing bytes; [runtime dependencies](../architecture/runtime-transport-dependencies.md#transport-composition) owns static/resolver/library rules.

Prefer signed xpra-html5 v20/v21; new majors need adapter verification. Check as Redeven's account/PATH, then actual app input/reconnect/app-initiated closure. macOS 13+ uses packaged native helper, never Linux commands. Incomplete historical command headings are removed; package names alone prove no readiness.

# Boundaries

These administrator commands apply to the optional system Xpra path, not automatic Runtime actions. Package names alone cannot establish readiness. Missing combined components or package services remain explicit launch/preparation failures.

# Evidence

- `internal/hostapps/dependencies.go`: executable, Python, server and client checks.
- `internal/hostapps/manager_test.go`: opt-in installed-stack checks.
- `scripts/build_runtime_binary.sh`: portable Linux native Runtime build.
