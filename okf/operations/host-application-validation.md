---
type: Validation Guide
title: Host application distribution validation
description: Installed-stack evidence, architecture limits and repeatable native application acceptance.
tags: [runtime, applications, linux, validation]
timestamp: 2026-09-24T19:25:00Z
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

[Host application input validation](host-application-input-validation.md) owns
current GTK3/GTK4/Qt/XIM application receipts, click-to-keyboard focus, old-session
upgrade checks and the distinction between synthetic composition and real IME
acceptance. Earlier component installation results do not qualify toolkit input.

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
