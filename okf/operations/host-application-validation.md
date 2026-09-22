---
type: Validation Guide
title: Host application distribution validation
description: Installed-stack evidence, architecture limits and repeatable native application acceptance.
tags: [runtime, applications, linux, validation]
timestamp: 2026-09-22T00:00:00Z
---
# Summary

This record distinguishes installed-stack evidence from host policy certification.
The Runtime capability and isolation contract is owned by
[host application platforms](../architecture/host-application-platforms.md).
A passing userspace check proves the tested Xpra/GIO/runtime combination only;
missing subscriptions, CPU translation and untested host policy remain explicit.
Administrators retain the [setup route](host-application-setup.md) for their host.

# Managed component qualification

The published `floe-native-apps` v0.1.2 stack passed real Xpra window discovery,
picture decoding, a live private D-Bus connection and button input receipt on Ubuntu 22.04 arm64 and Debian 11
amd64 hosts. Its installed directory also passed clean Debian 13 and Alpine 3.23
fixtures on both architectures, plus Arch Linux, Rocky Linux 9, AlmaLinux 9 and
RHEL UBI 9 on amd64, under an existing unprivileged account. The fixtures had no installed
desktop or display. Containers were disposable test environments only.

The same musl component closure and explicit loader run on both glibc and musl
hosts. These checks qualify graphical support, not every host application,
SELinux/AppArmor policy combination, GPU workload or RHEL subscription image.
RHEL evidence is specifically its UBI 9 userland. Repeat using the upstream's
`floe-native-apps -check` command and `scripts/qualify.sh` against the installed
component directory. The managed preparation acceptance installs the original archive ZIP, catalogs
and launches a host Python/GTK application, verifies private session/environment
isolation, resumes it, and stops it. Run with `REDEVEN_TEST_NATIVE_BUNDLE` pointing
to the upstream-generated ZIP and select `TestManagedPreparationAndHostApplication`.
The test reports launch-to-window readiness, then requires another authoritative
Xpra window inventory response within three seconds. Installed system-stack
acceptance applies the same query check. This catches the repeated five-second
audio initialization wait without weakening the requirement for a real mapped
window. Keep these native checks opt-in; they require a prepared graphical stack.
Product preparation additionally exercises owner permission,
SSE status, cancellation, same-window continuation and Desktop relay tests.

The Desktop preparation/adoption check uses a task-owned Runtime and HTTP fixture.
It verifies that the original preparation document remains in the same physical
window, the isolated application view fills that window and follows its native
resize, and the application's close action destroys both surfaces. This is window
integration evidence; the separate managed native launch test establishes actual
host application execution.

# Distribution validation

The September 2026 focused matrix covers userspace installations without a
desktop environment or monitor. Distribution checks run as an unprivileged user
in disposable test images. These images are a test harness;
the product runs applications directly on its host. Container checks cannot
certify a distribution's boot, kernel, SELinux/AppArmor, GPU, or login policies.

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

The x86_64 image tests used Rosetta in a disposable ARM Linux test VM. The complete
Runtime browser test sets `GODEBUG=cpu.all=off` only in that harness: with Go CPU
optimizations enabled under Rosetta, the secure session repeatedly disconnects;
disabling those optimizations restores the connection. Production builds do not
set this override, and native x86_64 acceptance remains separate evidence. A separate
QEMU user-mode harness crashed on a minimal GLib callback independently of Redeven
and was excluded from product conclusions. RHEL 9 has an explicit installation
route but has not had a full subscribed host acceptance run; no such environment
was available. Alma/Rocky results are not a claim of RHEL kernel or policy testing.

Observed packaging differences must remain visible in installation guidance:

- Debian 13's tested default repository did not supply Xpra. The upstream signed
  repository supplied it, with `xpra-x11` needed explicitly when recommendations
  were disabled. Installing `xpra-server` alone did not enable seamless X11.
- The tested Fedora minimal installation needed `gobject-introspection` in
  addition to Python GObject and GTK to supply `xlib-2.0.typelib`.
- The tested Fedora/openSUSE repositories did not supply `xpra-html5`; the
  separately released v20 assets were installed in Xpra's resource directory.
- Enterprise Linux can package Xpra against a newer Python than the system
  interpreter. Upstream package repositories and prerequisite repositories vary
  by release and architecture; installing the LTS Xpra 5.x line does not satisfy
  this integration.

The [host setup guide](host-application-setup.md) records the Arch,
RHEL/Rocky/AlmaLinux 9, and Alpine installation routes, architecture limits and
packaging differences. Other versions and NixOS are not certified by this matrix.
They are not blocked by a distribution allowlist; their installed capabilities
must satisfy the same checks. Do not describe all Linux distributions or all
graphical applications as verified.

Run the reusable installed-stack checks on a prepared Linux host with Go and xterm:

```sh
REDEVEN_TEST_HOST_APPLICATIONS=1 GOWORK=off go test ./internal/hostapps -run TestInstalled -count=1 -v
```

The tests create their own custom entry, state, configuration fixture, and
processes. They do not assume a distribution-specific desktop-entry identifier.

# macOS validation

The native adapter was exercised on macOS 26.5.2 ARM64 in a logged-in graphical
session with capture and accessibility permission. The disposable AppKit fixture
verifies real bundle metadata/icons, direct launch, captured pixels, pointer input,
Unicode text, native shortcuts, actual menu invocation, real AX resize, reconnect
without a new process, stale input rejection, and application-window closure.
The window-waiting fixture separately covers a first window delayed by 48 seconds,
reconnection before any window exists, standard reopening of a background app,
opening its first window through its native menu, stopping before its first frame,
and multiple-window, cancelled-close, minimized and hidden application recovery. These cases must preserve
the same process and still end correctly when its real window closes.
The explicit-quit fixture verifies native/windowless inventory after helper
restart, stale and partially stale process selections, graceful quit cancellation,
continued sharing after cancellation, and final process exit. Detachment preserves
a newly launched multiple-window application.
Desktop acceptance verifies local launch without a viewer. Browser acceptance
exercises the authenticated native stream, input, explicit reconnection and
script-opened viewer closure. This does not certify every third-party app or all
macOS versions/architectures; the minimum build target is macOS 13.

Repeat on an authorized Mac with Xcode command-line tools:

```sh
swift test --package-path desktop/native/computer-host
python3 scripts/check_macos_host_application_quit.py --helper desktop/native/computer-host/.build/debug/redeven-computer-host
python3 scripts/check_macos_host_application_startup.py --helper desktop/native/computer-host/.build/debug/redeven-computer-host --output /tmp/redeven-native-startup.json
python3 scripts/check_macos_host_applications.py desktop/native/computer-host/.build/debug/redeven-computer-host --output /tmp/redeven-native-app-evidence
python3 scripts/check_macos_host_application_waiting.py --helper desktop/native/computer-host/.build/debug/redeven-computer-host --scenario delayed
python3 scripts/check_macos_host_application_waiting.py --helper desktop/native/computer-host/.build/debug/redeven-computer-host --scenario reopen
python3 scripts/check_macos_host_application_waiting.py --helper desktop/native/computer-host/.build/debug/redeven-computer-host --scenario menu
python3 scripts/check_macos_host_application_waiting.py --helper desktop/native/computer-host/.build/debug/redeven-computer-host --scenario stop
python3 scripts/check_macos_host_application_waiting.py --helper desktop/native/computer-host/.build/debug/redeven-computer-host --scenario windows
```

The harness creates a unique temporary bundle and manipulates only that fixture.
It records real input receipts and pixels; teardown verifies the exact executable
path before stopping a fixture process. Missing graphical login or permissions is
an explicit failure, not a skipped or simulated acceptance run.

The startup fixture measures native attachment and reconnect separately, checks
one initial capture negotiation, and verifies suspension and capture replacement.
The browser surface regression decodes and acknowledges one static H.264 frame
without waiting for a second frame. Native timings exclude viewer loading and
browser decode; an end-to-end claim additionally needs a timed first decoded
frame from the matching Runtime/helper/viewer build.

# Evidence

- `internal/hostapps/manager_test.go`: installed GIO and Xpra launch/resume/stop tests.
- `internal/hostapps/setup_test.go`: published component preparation and responsive application window inventory.
- `scripts/check_macos_host_application_startup.py`: native attach/reconnect and capture lifecycle measurements.
- `internal/envapp/ui_src/src/styles/hostApplicationSurfaces.browser.test.tsx`: first static video frame decode and acknowledgement.
- `internal/hostapps/desktop_test.py`: native metadata, icon and argument checks.
- `internal/codeapp/appserver/host_application_viewer/viewer.js`: HTML client and lifecycle adapter.
