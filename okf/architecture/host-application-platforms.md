---
type: Runtime Contract
title: Host application platforms and initialization
description: Capability-based Linux initialization, dependency diagnostics, distribution evidence, and native macOS requirements.
tags: [runtime, applications, linux, desktop]
timestamp: 2026-09-23T08:00:00Z
---
# Summary

Redeven's host application backend supports Linux by installed capability, not by
distribution name. The Runtime owns dependency detection and isolated session initialization.
The [managed preparation contract](host-application-preparation.md) owns automatic
private component acquisition and recovery; users install only their own applications.
Missing support components offer preparation in the library.
A desktop environment, systemd user session, and physical monitor are unnecessary.
macOS uses a separate native backend with a logged-in graphical session; it does
not use Xpra or Linux virtual displays. Existing
[application permissions and lifecycle](host-applications.md) remain authoritative.

# Contract

## Required graphical capabilities

The integration accepts Xpra 6.x with local X11 server and command-line client
support, HTML5 client v20 or v21, Xvfb, xauth, dbus-run-session, dbus-daemon, and a
Python 3 interpreter with working GIO/GTK 3 introspection. New applications also
require the released client-input v1 capability, including xcb-imdkit, from the
exact Xpra interpreter; the [input contract](host-application-input.md) owns this probe. Other Xpra major versions
and HTML5 generations need explicit adapter validation before being advertised.
The monitored application launcher also requires Linux pidfds (kernel 5.3 or
later), child subreaping and Python support for pidfd operations.

The Runtime checks actual executable availability, Xpra's version and advertised
local server commands, imports the GIO/GTK bindings, and validates the installed
HTML5 version, principal assets, and referenced scripts/stylesheets, including
distribution symlinks into shared resource directories. Broken links report a
missing HTML5 client before a viewer opens. It obtains the resource root from `xpra
path-info` and selects its `www` or `html5` directory, passing that exact directory
to the upstream input-client preparation API. The session serves the resulting
private HTML directory. A nonstandard installation must expose its assets
under that resource root; Xpra's `XPRA_RESOURCES_DIR` override is respected. Neither
upstream client implementations nor application metadata are maintained in Redeven.

GIO need not share Xpra's interpreter. Python candidates come from absolute PATH
directories and are tested in order, so an unrelated virtual environment without
GIO does not hide the installed system bindings. The chosen interpreter is used
consistently for catalog reads, custom entries, and application launch. Relative
PATH directories are excluded. The service account must have the required
executables on PATH; an interactive shell's environment does not imply that a
system service inherits it.

Detection is a prerequisite check, not a promise that every application will work.
The actual launch requires an owned process receipt and a responsive HTML endpoint.
Window and first-pixel readiness remain separate; a background application is not
a startup failure. The [Linux lifecycle owner](linux-application-lifecycle.md)
defines monitored process lifetime, recovery and ordinary/forced close boundaries.
Library refresh reruns detection after installation.
Redeven does not elevate privileges, change package repositories, install system
packages, or disable SELinux/AppArmor automatically.

## Headless initialization

Each application gets a private XDG runtime directory, X11 server, X authorization,
D-Bus session, socket directory, and Xpra session directory. Inherited display,
Wayland, X authority, startup notification, and desktop bus addresses cannot direct
the new application into an unrelated graphical login. GTK and Qt select X11.
The session does not require a running systemd user manager or `/run/user/<uid>`.

Xpra default, system, and user configuration directories are excluded for owned
sessions and probes. A host configuration must not add startup applications,
listeners, or attachment to an existing display. The host's files are unchanged;
Redeven passes its own bounded settings and disables automatic client attachment
and existing-display reuse. Xvfb uses an authorization file and has TCP disabled.

The application remains native host software with the Runtime user's home,
files, permissions, and installed toolkit libraries. Virtual display isolation is
not a container or security sandbox. The application must support X11. Wayland-only
programs, desktop-service dependencies, singleton profile redirection, Flatpak/Snap
integration, hardware acceleration, and privileged dialogs require separate
application-specific verification. Application discovery follows GIO and the
service's XDG environment, including exported package desktop entries when present.

## Validation

See the [distribution validation record](../operations/host-application-validation.md)
for tested stacks, architecture boundaries and repeatable installed-host checks.

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

- `internal/hostapps/dependencies.go` and `dependencies_test.go`: installed capability, interpreter, resource path, and version checks.
- `internal/hostapps/manager.go` and `manager_test.go`: isolated environment and opt-in installed-stack verification.
- `internal/hostapps/desktop_test.py`: actual GIO metadata, icons, executable paths and literal arguments.
- `internal/envapp/ui_src/src/ui/pages/EnvHostApplicationsPage.tsx` and its tests: missing component guidance and unsupported-host presentation.
- `internal/codeapp/appserver/host_application_viewer/viewer.js` and `internal/envapp/ui_src/src/ui/services/hostApplicationViewer.test.ts`: v20/v21 client binding and viewer lifecycle adapter.
- [Xpra installation](https://github.com/Xpra-org/xpra/wiki/Download): upstream repositories, split packages, and Python requirements.
- [Xpra seamless mode](https://github.com/Xpra-org/xpra/blob/master/docs/Usage/Seamless.md) and [shadow mode](https://github.com/Xpra-org/xpra/blob/master/docs/Usage/Shadow.md): operating-system boundaries.
- [Apple ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos): native window capture and permission requirements.
