---
type: Validation Guide
title: Host application input validation
description: Verify actual toolkit text delivery, click focus and surviving application instances without substituting simulated IME evidence.
tags: [applications, input, linux, macos, validation]
timestamp: 2026-09-28T06:00:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-22"
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
The current integration consumes Floe Native Apps v0.22.19 and Floe webapp core 0.86.0 with `GOWORK=off`.

The native Linux adapter maps physical keys to the published seat, uses confirmed text when the client layout cannot be represented by that keymap, and sends clipboard publication before paste through the upstream scheduler. It must not paste the old selection, replay text or release composition when scrolling ends.

## Actual application receipts
On a task-owned Linux installation, set `REDEVEN_TEST_DESKTOP_COMPONENT_STATE` to the released combined component root.

The application must report the received string before further checks.

Minimal test images may lack CJK/emoji fonts: exact string receipts remain valid input evidence, but missing glyphs are not visual font acceptance.

## Lifecycle and retained resources
`TestInstalledDesktopApplicationTransport` verifies real pointer/text/key input, exact saved bytes, invalid clipboard rejection and cancellation of dependent input, then recreates the Runtime manager and saves again through the same helper.

Unknown records fail read-only. Elapsed time alone cannot end a live application awaiting its first window; the installed timeout regression observes the old 40-second boundary without ending sharing or the process.

# Boundaries

## macOS and physical-device boundary
The native Mac helper remains the platform authority. Shared canvas extraction requires macOS viewer/input, first-frame, toolbar, reconnect and stale-target regression tests as well as actual fixture input.

Browser composition and touch event injection prove transport and application behavior only.

# Evidence

- `internal/hostapps/desktop_installed_test.go`: real native input, saved bytes, clipboard failure and manager replacement.

- `internal/hostapps/package_installed_test.go` and `scripts/host_application_native_acceptance.mjs`: installed packages and actual editor saves.

- `internal/hostapps/client_input_test.go` and `scripts/check_host_application_input.mjs`: isolated product viewer and browser receipts.
