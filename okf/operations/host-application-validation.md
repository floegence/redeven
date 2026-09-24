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

# Contract

## Managed component qualification

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

## Client input qualification

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

## Mobile pointer acceptance

The September 24 follow-up uses published Floe core `0.77.1` and production viewer
assets. The pointer adapter was released in native-apps `v0.7.10`; final checks
consume `v0.8.0`, retaining the subsequently integrated display feedback contract.
The follow-up fixed parent/iframe focus cancelling the first pointer press, an overly broad pixel touch style, reversed native horizontal
scroll and lost fractional native wheel pixels. The Electron fixture now asserts
one down/up pair at the adapter, including after toolbar actions and reconnection,
instead of merely observing DOM clicks.

Task-owned orange arm64 GTK, udesk26 amd64 GTK and Firefox 155.0.1 applications,
macOS AppKit controls and a private Google Chrome 153.0.8010.53 application passed
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

udesk26 became reachable during final acceptance and passed on Ubuntu 26.04.1 LTS.
Firefox retains a native wheel transaction's previous scroll container even when
subsequent wheel events hit the nested element. The independent nested-region
scenario follows an explicit blank-area click that ends the preceding hardware
wheel transaction. This records normal host browser behavior; the product neither
changes Firefox preferences nor inserts a timing workaround.

Orange's `/usr/bin/firefox` was an uninstalled Snap wrapper, so its Firefox check
remains unpassed. Physical iOS/iPadOS Safari and Android Chrome touch/pinch/keyboard
checks also remain unpassed. The previously separate real OS IME candidate checks
remain independent of this pointer task.

## Platform evidence

[Host application platform validation](host-application-platform-validation.md) records the Linux distribution matrix, translation limitations, native macOS acceptance and reproducible platform commands. Component, client-input and pointer qualification do not extend that platform evidence.

# Boundaries

Installed-stack results certify only the tested userspace, Runtime and display combination. They do not certify untested host policy, translated CPUs, unavailable subscriptions or physical pointer behavior. Platform-specific limitations remain part of each recorded result.

# Evidence

- [Floe native input v0.5.1 qualification](https://github.com/floegence/floe-native-apps/actions/runs/35834089131): immutable native amd64/arm64 managed/system application input matrix.
- [Floe webapp v0.71.0](https://www.npmjs.com/package/@floegence/floe-webapp-core/v/0.71.0): published remote-input controller, subsequently consumed through 0.72.0.

- `internal/hostapps/setup_test.go`: published component preparation and responsive application window inventory.
- `internal/hostapps/desktop_test.py`: native metadata, icon and argument checks.
- `internal/codeapp/appserver/host_application_viewer/viewer.js`: HTML client and lifecycle adapter.
