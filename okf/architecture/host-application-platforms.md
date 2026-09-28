---
type: Runtime Contract
title: Host application platforms and initialization
description: Capability-based Linux initialization, dependency diagnostics, distribution evidence, and native macOS requirements.
tags: [runtime, applications, linux, desktop]
timestamp: 2026-09-23T08:00:00Z
---
# Summary

Published Floe Native Apps owns Linux graphics, package planning and scoped host
service adaptation. Redeven owns the authorized catalog, instance and viewer.
New applications normally receive a private Wayland/Xwayland environment; an
explicit upstream X11-only contract can select Xpra before execution. A launch
never retries with another backend. Native applications need no full desktop or
physical monitor. Snap and Flatpak additionally require their installed runtimes
and necessary host services. Missing capabilities remain explicit failures.

# Contract

## Immutable launch plan

GIO resolves the authorized desktop entry. The published planner verifies package
metadata, executable and package version, selects a capability and revalidates the
plan before executing. It preserves Desktop Entry quoting/expansion and disables
external D-Bus activation in its private launch copy. Redeven does not identify
packages or graphics protocols by application name, parse launch shell strings,
or implement package-specific retries. Custom executable entries use this same
planner. A sandbox launcher requiring metadata fails clearly when metadata is
absent; a custom wrapper is not proof that the underlying package is supported.

The combined managed component supplies a pinned libweston headless compositor,
minimal application shell, Xwayland, private bus, portal components and commit-only
input adapters. Both graphics protocols can occur in one instance. Window families
include application popups and save dialogs, without exposing a full desktop or
another application's surfaces. Software rendering provides the baseline; host
hardware and application-specific restrictions remain authoritative.

A retained Xpra instance keeps its original component. New X11-only plans may use
a verified managed installation or a supported system Xpra 6.x/HTML5 v20 or v21
stack. System detection verifies local server commands, GIO, Xvfb, authorization,
D-Bus and actual client resources. Unknown source structures fail preparation.
This path is never a fallback for a failed combined launch. The
[preparation owner](host-application-preparation.md) selects complete components.

## Private graphics and host services

Each instance owns unique private display/socket, authorization, runtime and bus
resources. Inherited desktop display, startup and input-method selection do not
redirect its windows. Applications retain the host user's files and OS permissions;
private graphics is not an OS sandbox. Production neither requires a VM/container
nor changes AppArmor/SELinux, global input methods or installed system modules.

Strict/classic Snap, Flatpak and AppImage use their actual installed launch
mechanisms. The upstream Snap adapter forwards only the admitted application's
validated scope operations to the real user systemd manager, including authentic
completion signals. It never exposes the whole desktop bus or arbitrary process
management. Flatpak instance/sandbox identity participates in process ownership.
AppImages are not silently extracted or replaced. Native DEB/RPM applications do
not acquire a full-desktop dependency merely because sandboxed packages need one.

Official portal components render open/save dialogs inside the private display and
provide document authorization through the normal protocol. No invisible dialog is
forwarded to the user's unrelated desktop. The service surface excludes audio,
video, desktop sharing and notification forwarding. Missing runtime, host service,
unsupported graphics or stale package plans produce distinct recovery reasons.
Errors retain safe phase/code/exit status, never child output or credentials.

Applications may still enforce single-instance/profile policies or require
unsupported hardware/services. A launch delegated outside its owned instance
cannot adopt or close that user's existing window. No guessed replacement profile
is created. Support claims require real package and desktop evidence, as recorded
in the [validation owner](../operations/host-application-platform-validation.md).

## macOS initialization

The [native macOS contract](macos-host-applications.md) owns local launch, remote
single-window capture, input, and graceful lifecycle. macOS 13 or newer uses the
packaged `redeven-computer-host` helper. Desktop stages it alongside the Runtime;
a standalone Runtime extracts it from its shipped `computer.zip` on demand.
Missing helper bytes produce an explicit update/reinstall diagnostic.

A trusted Desktop local-environment route opens the real application directly.
Remote access requires screen-recording and accessibility authorization plus a
logged-in, unlocked graphical session. Permission requests are explicit actions;
the pending opening rechecks preflight after the user authorizes the host. Neither route
installs XQuartz or Xpra. A Mac without a graphical login cannot create a private
headless AppKit session. Native AppKit applications do not become X11 applications
by installing XQuartz, and Xpra desktop shadowing is not this implementation.

# Boundaries

Capability probes, not distribution names, determine Linux readiness. Missing support components block opening until preparation succeeds. macOS requires its native graphical session and permissions; Linux virtual-display assumptions cannot substitute for them.

# Evidence

- `internal/hostapps/linux_desktop.go` and `launch_failure.go`: published immutable plan, private session and safe failure mapping.
- `internal/hostapps/dependencies.go` and `dependencies_test.go`: retained/system Xpra capability checks.
- `internal/hostapps/manager.go` and `manager_test.go`: isolated environment and opt-in installed-stack verification.
- `internal/hostapps/desktop_test.py`: actual GIO metadata, icons, executable paths and literal arguments.
- `internal/envapp/ui_src/src/ui/pages/EnvHostApplicationsPage.tsx` and its tests: missing component guidance and unsupported-host presentation.
- `internal/codeapp/appserver/host_application_viewer/viewer.js` and `internal/envapp/ui_src/src/ui/services/hostApplicationViewer.test.ts`: v20/v21 client binding and viewer lifecycle adapter.
- [Xpra installation](https://github.com/Xpra-org/xpra/wiki/Download): upstream repositories, split packages, and Python requirements.
- [Xpra seamless mode](https://github.com/Xpra-org/xpra/blob/master/docs/Usage/Seamless.md) and [shadow mode](https://github.com/Xpra-org/xpra/blob/master/docs/Usage/Shadow.md): operating-system boundaries.
- [Apple ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos): native window capture and permission requirements.
