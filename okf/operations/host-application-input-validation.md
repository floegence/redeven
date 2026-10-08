---
type: Validation Guide
title: Host application input validation
description: Verify actual toolkit text delivery, click focus and surviving application instances without substituting simulated IME evidence.
tags: [applications, input, linux, macos, validation]
timestamp: 2026-09-28T06:00:00Z
---
# Summary

This guide qualifies the [client input contract](../architecture/host-application-input.md)
through actual application receipts and saved bytes. Published upstream qualification
owns native input adapters and prepared Xpra event ownership. Redeven verifies its
viewer, authenticated transport, launch and recovery adapters. Sending a request or
focusing a DOM element is insufficient. Existing applications retain their backend
and loaded resources. Real system candidate selection and physical mobile acceptance
remain separate; simulated events must never be reported as those checks.

# Contract

## Released capabilities

The current integration consumes Floe Native Apps v0.22.19 and Floe webapp core
0.86.0 with `GOWORK=off`. Exact-tag native amd64/arm64 qualification covers the
combined Wayland/Xwayland component, package adapters, native text contexts,
input ordering, portals and retained Xpra. The
[desktop compatibility record](host-application-desktop-validation.md) owns the
release identities and package/desktop matrix. No sibling checkout or package
overlay establishes formal product acceptance.

One shared keyboard controller and one shared pointer controller own browser
content input. The native Linux adapter maps physical keys to the published seat,
uses confirmed text when the client layout cannot be represented by that keymap,
and sends clipboard publication before paste through the upstream scheduler.
Failure cancels dependent operations and requires explicit reconnect. It must not
paste the old selection, replay text or release composition when scrolling ends.

## Actual application receipts

On a task-owned Linux installation, set `REDEVEN_TEST_DESKTOP_COMPONENT_STATE` to
the released combined component root. `TestInstalledClientInputViewer` accepts a
new absolute `REDEVEN_TEST_CLIENT_INPUT_EVIDENCE` directory and a
`REDEVEN_TEST_CLIENT_INPUT_TARGET` of `gtk4`, `gtk4-entry`, `gnome`, `firefox`, or
empty for GTK3. After the fixture reports ready, run:

```sh
REDEVEN_INPUT_BROWSER=chromium node scripts/check_host_application_input.mjs \
  <ssh-host> <remote-evidence-directory> <local-evidence-directory>
```

`firefox`, `webkit` and `electron` select other clients. Electron uses the locked
Desktop executable, a dedicated profile/process group and real BrowserWindow.
The driver reads real Runtime session state. It clicks remote pixels and types
ASCII without repairing focus through a test `focus()` call. The application must
report the received string before further checks. Synthetic composition then
checks repeated CJK, emoji, non-BMP, combining marks and ZWJ text, deletion,
selection replacement, field switching and toolbar isolation. Key-repeat checks
assert both repeated movement and stopping after release. Clipboard checks compare
actual browser paste bytes; a system clipboard's Unicode normalization is recorded
separately from exact confirmed-text delivery.

`TestInstalledPackageViewer` resolves genuine installed desktop metadata. Only its
explicit task arguments and empty test document/profile differ. Snap Firefox uses
an isolated profile under its permitted common directory. Flatpak editors use
normal file forwarding and document authorization. The fixture never delegates to
a user editor or writes user documents. Its explicit `REDEVEN_TEST_SAVE_NEWLINE`
policy (`append`, `ensure`, or empty) describes the tested editor's serialization;
it does not transform input. Every edit is saved by actual Ctrl+S and checked
against exact UTF-8 file bytes. Startup failures record phase/code/exit status,
page errors and protocol errors; failure cannot be presented as input success.

Receipts include component identity, PID/start identity, current backend, client
version, controlled test strings and screenshots. Authentication credentials are
excluded. Minimal test images may lack CJK/emoji fonts: exact string receipts
remain valid input evidence, but missing glyphs are not visual font acceptance.

## Lifecycle and retained resources

`TestInstalledDesktopApplicationTransport` verifies real pointer/text/key input,
exact saved bytes, invalid clipboard rejection and cancellation of dependent input,
then recreates the Runtime manager and saves again through the same helper.
The fixture checks process/start identity and closes only its own application.
A separate real process-exit fixture covers orderly and abrupt Runtime termination,
double-forked children and explicit owner-checked cleanup. Sharing readiness is not
first-window readiness; tests await application receipts or native window events.

The component-update fixture starts a retained Xpra application, updates the
component, migrates its verified historical record atomically and reconnects
without changing the original backend/process. A new application uses the combined
component. Unknown records fail read-only. Immutable Xpra assets, owner boundaries,
stale callbacks and second-viewer takeover retain their focused tests.
Elapsed time alone cannot end a live application awaiting its first window; the
installed timeout regression observes the old 40-second boundary without ending
sharing or the process.

# Boundaries

## macOS and physical-device boundary

The native Mac helper remains the platform authority. Shared canvas extraction
requires macOS viewer/input, first-frame, toolbar, reconnect and stale-target
regression tests as well as actual fixture input. It must not change the helper's
window-presence decisions, permissions or global input source.

Real system IME candidate selection and physical iOS/iPadOS Safari or Android
Chrome touch/soft-keyboard workflows remain independently unpassed. This task does
not repeat or replace those user-owned items. Browser composition and touch event
injection prove transport and application behavior only.

# Evidence

- `internal/hostapps/desktop_installed_test.go`: real native input, saved bytes, clipboard failure and manager replacement.
- `internal/hostapps/package_installed_test.go` and `scripts/host_application_native_acceptance.mjs`: installed packages and actual editor saves.
- `internal/hostapps/client_input_test.go` and `scripts/check_host_application_input.mjs`: isolated product viewer and browser receipts.
- `internal/hostapps/component_update_test.go` and `linux_lifecycle_test.go`: surviving process and retained component recovery.
- `internal/envapp/ui_src/src/ui/services/linuxHostApplicationViewer.test.ts`: first-frame gating, keyboard/pointer ownership and input failure recovery.
- `scripts/check_macos_host_applications.py` and `scripts/check_macos_host_application_input_targets.py`: disposable Mac native/browser/terminal receipts.
