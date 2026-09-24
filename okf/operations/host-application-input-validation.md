---
type: Validation Guide
title: Host application input validation
description: Verify actual toolkit text delivery, click focus and immutable old sessions without substituting simulated IME evidence.
tags: [applications, input, linux, macos, validation]
timestamp: 2026-09-24T19:25:00Z
---
# Summary

This record qualifies the [client input contract](../architecture/host-application-input.md)
through application text receipts and saved bytes. Published upstream qualification
owns toolkit modules and prepared Xpra event ownership; Redeven verifies its viewer,
launch, cache and recovery adapters. Sending a request or focusing a DOM element is
insufficient. Old applications retain their process and prepared resources until
normal exit. Real system candidate selection and physical mobile acceptance remain
separate, unpassed items; simulated events must never be reported as those checks.

# Contract

## Published Linux qualification

The September 25, 2026 local qualification consumes `floe-native-apps` v0.10.1 and
Floe webapp core 0.77.3. Immutable upstream tag qualification passed on native
amd64 and arm64 with managed Xpra 6.2.2 and system Xpra 6.5.3. Source/race/vet,
artifact provenance, clean installation, cancellation/recovery, cursor, pointer
and browser-focus checks passed before publication. Go proxy and checksum database
readback match the released commit `74c31c63c65cdfd7377c52d9759915531c60ddc4`.

GTK3, GTK4 Entry/TextView, Qt5, Qt6, Chromium and xterm receive exact Unicode,
including ordered commit/Enter pairs and a 15,000-byte commit. Editing, alternating
field focus and clipboard assertions cover applicable controls. GTK4 also passes
native Debian 11/glibc 2.31/GTK 4.0 baseline and current GTK runtime checks on both
architectures. The same-widget context regression first fails with the retired
module, then proves that reasserting a focused widget keeps its marker subscription;
focus loss, null binding and disposal revoke it.

Standalone GNOME Text Editor saves ASCII, repeated identical Unicode, selection
replacement, multiline text and subsequent Enter/ASCII through real UI shortcuts.
Saved file bytes must equal the expected string. Its repeated density-labelled
upstream runs qualify input only: the GNOME driver does not select native display
density. Other toolkit density assertions remain independent evidence.

## Redeven application receipts

Use a new absolute `REDEVEN_TEST_CLIENT_INPUT_EVIDENCE` directory, a task-owned
`REDEVEN_TEST_NATIVE_COMPONENT_STATE`, and `TestInstalledClientInputViewer` from
`internal/hostapps`. `REDEVEN_TEST_CLIENT_INPUT_TARGET` selects `gtk4`,
`gtk4-entry`, `gnome`, `firefox`, or empty for GTK3. Once the private fixture reports
ready, run:

```sh
REDEVEN_INPUT_BROWSER=chromium node scripts/check_host_application_input.mjs \
  <ssh-host> <remote-evidence-directory> <local-evidence-directory>
```

`firefox`, `webkit` and `electron` select the other clients. The Electron fixture
uses the locked Desktop executable, a dedicated profile/process group and real
BrowserWindow. It does not connect to a user's Desktop debugging session. Each
client clicks the remote pixels and immediately types ASCII before composition;
the driver never repairs focus with a test `focus()` call. The application receipt
must arrive first. Synthetic composition then checks repeated CJK, emoji, non-BMP,
combining marks and ZWJ text, deletion, field switching and toolbar isolation.
GNOME additionally saves after each edit and checks exact UTF-8 contents.

On udesk24 Ubuntu 24.04, GTK 4.14.5 Entry/TextView and GNOME Text Editor 46.3 passed
through Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6. GNOME also passed in
Electron 41.10.5. GTK3 passed with Chromium, including normalized custom cursor
geometry and the application's click coordinates. Text controls hide cursors while
typing, so cursor qualification restores real hover after the click-to-type assertion.

GNOME runs with `--standalone`, private display/D-Bus and XDG directories, memory
GSettings and an empty task document. Its PID/start identity and module paths are
recorded; no user document or existing editor is used. Evidence includes component
identity, preparation version, asset digest, client version, received strings,
saved bytes and screenshots. Authentication credentials are excluded from exported
receipts. Only controlled test text belongs in these records.

The installed Firefox on udesk24 is a Snap launcher which fails before creating
a window because the private bus has no `org.freedesktop.systemd1`. This native
Firefox target remains unpassed there; do not install system packages, replace the
private bus or change host security to claim success. Earlier udesk26 Firefox
receipts are historical evidence, not a substitute for this host.

## Upgrade and regression checks

To check a real old instance, launch the fixture binary built against the previous
published upstream version, then run the current driver with
`REDEVEN_INPUT_EXPECT_UNSUPPORTED=1`. Chromium, Firefox and WebKit verify the
save/quit/reopen guidance before content input, reload, and viewer closure. The
process start identity, prepared file hashes and empty application receipts stay
unchanged. WebKit worker-origin revocation diagnostics during rejected iframe
teardown are recorded separately; unrelated script errors still fail.

Manager cache tests require different content digests/ETags for changed resources,
retain old immutable snapshots, enforce owners, and prevent old-instance cleanup
from revoking a new snapshot. Installed lifetime checks passed delayed first
window, detach, normal last-window close and recovery after both orderly and abrupt
Runtime exit while preserving the same application process.

The affected viewer/API/localization tests, hostapps/appserver race and vet, three
browser pointer/appearance checks, display feedback fixture and Desktop host-app
tests pass. Real Electron titlebar checks verify popovers, one content click,
reconnection, locale/theme changes and native chrome. An idempotent pointer release
on native blur is lifecycle cleanup; the header assertion prohibits actual content
input rather than forbidding that release request.

## macOS and device boundary

The existing bundled helper passed a disposable AppKit application's actual Unicode,
key repeat, shortcuts, menus, capture, reconnect, stale-input rejection, resize,
replacement and close receipts. The same helper delivered exact repeated Unicode
and key transitions to task-owned Google Chrome and Terminal windows; Chrome also
checked multiline selection replacement. Its source/manifest identity is retained
with the evidence. No native helper behavior is changed by this Linux input fix.

Actual system IME candidate selection and real iOS/iPadOS Safari or Android Chrome
soft keyboard/touch workflows remain independently unpassed. The current task does
not repeat or replace those user-owned acceptance items. A synthetic composition
transaction or browser engine check establishes transport and application delivery
only, not physical-device or OS candidate behavior.

# Evidence

- [Native v0.10.1 qualification](https://github.com/floegence/floe-native-apps/actions/runs/36044188361): immutable dual-architecture release matrix and application receipts.
- `internal/hostapps/client_input_test.go`, `testdata/client_input_gtk4.py` and `scripts/check_host_application_input.mjs`: isolated product launch, real click and application bytes.
- `internal/hostapps/client_assets_test.go` and `linux_lifecycle_test.go`: immutable resources, owner isolation and surviving process recovery.
- `internal/envapp/ui_src/src/ui/services/hostApplicationViewer.test.ts`: preparation v2 before binding and stale initialization rejection.
- `desktop/scripts/fixtures/host-application-titlebar.ts`: real Electron chrome and input ownership.
- `scripts/check_macos_host_applications.py` and `scripts/check_macos_host_application_input_targets.py`: disposable native application and browser/terminal receipts.
