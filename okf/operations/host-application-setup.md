---
type: Operations Guide
title: Prepare Linux hosts for native applications
tags: [runtime, applications, linux, installation]
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

Published Floe Native Apps supplies managed Wayland/Xwayland; the library owns preparation/recovery and Desktop can transfer verified offline archives. No full desktop/monitor is needed. Snap/Flatpak require installed runtimes/services; missing prerequisites get explicit guidance, never automatic system/security changes. Platform/preparation contracts apply; refresh after admin changes.

# Contract

## Optional system Xpra boundary
The commands below prepare the retained/explicit X11-only path. They do not replace the combined default and are not an automatic fallback after application failure. The administrator owns privileged installation and host policy.

## Arch Linux
Use Arch's official x86_64 repositories and perform a complete system upgrade:

XTerm is an optional small application for the installed-stack tests: `sudo pacman -S --needed xterm`.

## RHEL, Rocky Linux and AlmaLinux 9
This route targets x86_64, where Xpra publishes Enterprise Linux 9 packages.

| Distribution | Upstream repository configuration |
| --- | --- |
| Rocky Linux 9 | `https://raw.githubusercontent.com/Xpra-org/xpra/master/packaging/repos/rockylinux/xpra.repo` |
| AlmaLinux 9 | `https://raw.githubusercontent.com/Xpra-org/xpra/master/packaging/repos/almalinux/xpra.repo` |

Install `xterm` separately to run the opt-in integration tests.

## Alpine Linux 3.23
Enable the matching release's official `main` and `community` repositories:

A previous dynamic GNU Runtime can fail before startup with `not found` even though its file exists. The [runtime dependency contract](../architecture/runtime-transport-dependencies.md) owns the static build, resolver and library distribution boundaries.

## Install a compatible upstream HTML5 client
Prefer the distribution/upstream signed `xpra-html5` package when it supplies v20 or v21.

Keep the client updated within the validated major versions; a new major requires adapter verification.

## Verify the prepared host
Run as the same account and with the same PATH as Redeven:

Finally open an installed application in Redeven and verify input, reconnect and application-initiated window closure.

## macOS
Use the packaged native helper on macOS 13 or newer. Linux package commands above do not apply to macOS.

# Boundaries

These administrator commands apply to the optional system Xpra path, not automatic Runtime actions. Package names alone cannot establish readiness. Missing combined components or package services remain explicit launch/preparation failures.

# Evidence

- `internal/hostapps/dependencies.go`: executable, Python, server and client checks.

- `internal/hostapps/manager_test.go`: opt-in installed-stack checks.

- `scripts/build_runtime_binary.sh`: portable Linux native Runtime build.
