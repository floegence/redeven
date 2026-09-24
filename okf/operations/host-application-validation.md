---
type: Validation Guide
title: Host application distribution validation
description: Installed-stack evidence, architecture limits and repeatable native application acceptance.
tags: [runtime, applications, linux, validation]
timestamp: 2026-09-23T08:00:00Z
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

# Client input qualification

The September 23 client-input qualification used published Floe webapp core 0.77.1
(including the released remote-input and remote-pointer controllers) and native
apps v0.7.10. Upstream's immutable release qualification passed on native amd64
and arm64 with managed Xpra 6.2.2 and complete system Xpra 6.5.3. GTK3, Qt5, Qt6, Chromium 145 and xterm
received exact Unicode strings, including 40 ordered commit/Enter pairs, a 15 KB
commit, selection replacement, deletion, alternating focus and clipboard operations.
The bridge is not a GTK4 qualification. Earlier distribution tables below are
historical graphical/lifecycle evidence; they do not qualify current client input.

Redeven's task-owned orange fixture uses the released managed components and real
`Manager.Launch`, with private state and loopback ports. Run
`TestInstalledClientInputViewer` with a new absolute
`REDEVEN_TEST_CLIENT_INPUT_EVIDENCE` directory and verified
`REDEVEN_TEST_NATIVE_COMPONENT_STATE`. While it reports ready, run
`node scripts/check_host_application_input.mjs <ssh-host> <remote-evidence> <local-evidence>`.
The driver serves the production viewer assets, tunnels only the fixture listener,
and asserts the GTK application's own text receipt before signalling completion.
It records PID, ports, component digest, browser version and a screenshot without
copying the authentication credential into final evidence. The fixture terminates
only its own test application and closes its private listener.

The September 23 check passed repeated identical CJK/emoji/non-BMP/combining/ZWJ
commits, physical typing, Backspace, pointer focus between two fields and toolbar
isolation in Chromium 145, Firefox 146.0.1 and WebKit 26.0. The installed launch/resume/stop regression also passed.
Browser events in this driver are synthetic: it establishes controller-to-app
delivery, not a native input-method candidate workflow or physical touch behavior.

Native macOS checks passed Unicode and ordinary `abc` key delivery into a disposable
AppKit text field with both ABC and Simplified Pinyin selected on the host. The
original input source was restored. Native launch, pixels, menus, shortcuts,
reconnect, stale input, resize, window replacement, ordinary close and concurrent
session isolation also passed with the changed helper. Desktop's real Electron
41.10.5 titlebar/preload/action/reconnect fixture and 56 browser appearance checks
passed; 111 deterministic viewer tests and 24 helper tests cover the input lifecycle
contract. The 18 affected Desktop tests, localization, dependency boundaries,
generated assets, Go hostapps/appserver tests and their race checks passed.

Actual desktop OS candidate selection has not been qualified: the available UI
automation attempt produced direct Latin text, without an observable native
composition transaction. Real iOS/iPadOS Safari and Android Chrome soft keyboards
and the mobile pointer matrix were unavailable and remain unpassed. A simulated
mobile viewport or synthetic pointer sequence does not replace these checks. The
user owns the remaining real input-method and physical mobile interaction acceptance.

The follow-up authenticated `udesk26` check passed actual GTK3 input using private
state, released components and the production viewer. Its installed Firefox 155.0.1
also passed repeated Unicode, physical typing, deletion, field switching and toolbar
isolation. Select it with `REDEVEN_TEST_CLIENT_INPUT_TARGET=firefox`; its disposable
profile suppresses first-run notifications and disables telemetry upload. No personal
browser profile is modified. No application or Runtime deployment is implied by a
passing isolated fixture.

The macOS follow-up passed actual Google Chrome textarea and Terminal stdin receipts
for repeated Unicode and physical typing/deletion. Chrome additionally verifies
selection replacement and multiline text. This exposed and fixed native line-feed
events being discarded when carried by an ordinary character key: committed line
breaks retain their Unicode payload and native Return key identity. Run
`scripts/check_macos_host_application_input_targets.py --helper <built-helper> --output <evidence>`
to create and close only disposable test windows in the installed applications.
This check does not perform native candidate selection or modify personal documents.

# Mobile pointer acceptance

The September 24 follow-up uses published Floe core `0.77.1` and production viewer
assets. The pointer adapter was released in native-apps `v0.7.10`; final checks
consume `v0.8.0`, retaining the subsequently integrated display feedback contract.
The follow-up fixed parent/iframe focus cancelling the first pointer press, an overly broad pixel touch style, reversed native horizontal
scroll and lost fractional native wheel pixels. The Electron fixture now asserts
one down/up pair at the adapter, including after toolbar actions and reconnection,
instead of merely observing DOM clicks.

The task-owned orange arm64 GTK application, macOS AppKit controls and a private
Google Chrome 153.0.8010.53 application passed
vertical scroll from a button without clicking, nested diagonal scroll at the
initial hit point, stop on release, hardware wheel reversal, tap, double tap,
long-press right click and slider drag with release. Application receipts and
screenshots record the result. The AppKit fixture disables its own predominant-axis
policy so both delivered axes can be observed. No user's application is terminated.

Linux uses `TestInstalledClientInputViewer` with
`REDEVEN_TEST_CLIENT_INPUT_TARGET=pointer-gtk` or `pointer-firefox`. macOS uses
`TestInstalledMacPointerViewer`, a new `REDEVEN_TEST_MAC_POINTER_EVIDENCE` directory
and the verified `REDEVEN_COMPUTER_NATIVE_HELPER_PATH`. The same Node driver accepts
`local` instead of an SSH host for the private macOS listener. A macOS browser test
requires `REDEVEN_TEST_MAC_POINTER_BROWSER_BUNDLE` to point at a disposable bundle
copy, with a separate browser profile. The fixture emits a password-protected
connection file; final evidence excludes the password.

Chromium, Firefox and WebKit pointer tests cover native browser mouse clicks,
synthetic touch scroll, composition isolation and toolbar cancellation. Electron
41.10.5 additionally exercises the real native titlebar and preload. These checks
are distinct from physical touch-device qualification. Run
`pnpm --dir internal/envapp/ui_src test:host-application-browser` for the bounded
three-engine pointer and appearance suite. Native application acceptance uses
Chromium touch injection and actual application receipts, not a physical device.

At this check, udesk26's configured SSH endpoint was unreachable. Orange's
`/usr/bin/firefox` was an uninstalled Snap wrapper. Those corresponding live
application checks and udesk26 deployment remain unpassed until the environments
are available. Physical iOS/iPadOS Safari and Android Chrome touch/pinch/keyboard
checks also remain unpassed. The previously separate real OS IME candidate checks
remain independent of this pointer task.

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
python3 scripts/check_macos_host_application_concurrency.py --helper desktop/native/computer-host/.build/debug/redeven-computer-host --output /tmp/redeven-native-concurrency.json
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

The concurrency fixture retains a suspended application while opening another,
alternates reconnects, withholds one channel's frame acknowledgement, and detaches
one application while the other remains live. It verifies one helper process and
unchanged native application PIDs. This covers the idle-helper replayd contention
that single-application startup tests cannot detect; the
[capture ownership contract](../architecture/macos-application-capture-owner.md)
defines the required process and channel boundaries.

# Evidence

- [Floe native input v0.5.1 qualification](https://github.com/floegence/floe-native-apps/actions/runs/35834089131): immutable native amd64/arm64 managed/system application input matrix.
- [Floe webapp v0.71.0](https://www.npmjs.com/package/@floegence/floe-webapp-core/v/0.71.0): published remote-input controller, subsequently consumed through 0.72.0.

- `internal/hostapps/manager_test.go`: installed GIO and Xpra launch/resume/stop tests.
- `internal/hostapps/setup_test.go`: published component preparation and responsive application window inventory.
- `scripts/check_macos_host_application_input_targets.py`: Chrome and Terminal actual input receipts.
- `scripts/check_macos_host_application_startup.py`: native attach/reconnect and capture lifecycle measurements.
- `scripts/check_macos_host_application_concurrency.py`: independent application channels under one native capture owner.
- `internal/envapp/ui_src/src/styles/hostApplicationSurfaces.browser.test.tsx`: first static video frame decode and acknowledgement.
- `internal/hostapps/desktop_test.py`: native metadata, icon and argument checks.
- `internal/codeapp/appserver/host_application_viewer/viewer.js`: HTML client and lifecycle adapter.
