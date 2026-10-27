---
type: Runtime Contract
title: Host application platforms and initialization
description: Capability-based Linux initialization, dependency diagnostics, distribution evidence, and native macOS requirements.
tags: [runtime, applications, linux, desktop]
timestamp: 2026-09-23T08:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Floe Native Apps owns Linux graphics/package/service adaptation; Redeven owns catalog, authorization, instance and viewer. Default private Wayland/Xwayland or explicit preselected X11-only Xpra needs no full desktop/monitor. Never retry another backend. Snap/Flatpak need installed runtimes/services; missing capabilities fail explicitly.

# Contract

## Immutable launch plan
GIO resolves the authorized desktop entry. A sandbox launcher requiring metadata fails clearly when metadata is absent; a custom wrapper is not proof that the underlying package is supported.

The [preparation owner](host-application-preparation.md) selects complete components.

## Private graphics and host services
Each instance owns unique private display/socket, authorization, runtime and bus resources.

It never exposes the whole desktop bus or arbitrary process management.

Support claims require real package and desktop evidence, as recorded in the [validation owner](../operations/host-application-platform-validation.md).

## macOS initialization
The [native macOS contract](macos-host-applications.md) owns local launch, remote single-window capture, input, and graceful lifecycle. macOS 13 or newer uses the packaged `redeven-computer-host` helper.

A Mac without a graphical login cannot create a private headless AppKit session. Native AppKit applications do not become X11 applications by installing XQuartz, and Xpra desktop shadowing is not this implementation.

# Boundaries

Capability probes, not distribution names, determine Linux readiness. Missing support components block opening until preparation succeeds. macOS requires its native graphical session and permissions; Linux virtual-display assumptions cannot substitute for them.

# Evidence

- `internal/hostapps/linux_desktop.go` and `launch_failure.go`: published immutable plan, private session and safe failure mapping.

- `internal/hostapps/dependencies.go` and `dependencies_test.go`: retained/system Xpra capability checks.

- `internal/hostapps/manager.go` and `manager_test.go`: isolated environment and opt-in installed-stack verification.
