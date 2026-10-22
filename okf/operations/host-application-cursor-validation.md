---
type: Validation Guide
title: Host application cursor acceptance
description: Distinguish published cursor geometry, native click receipts and physical pointer evidence.
tags: [applications, cursor, linux, validation]
timestamp: 2026-09-23T13:00:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

The [viewer contract](../architecture/host-application-viewer.md) owns cursor
geometry; published `floe-native-apps` owns its implementation. Acceptance checks
decoded images and application click receipts separately from the operating
system's displayed pointer. A CSS declaration or ordinary page screenshot cannot
qualify physical pointer appearance. Unavailable devices remain unpassed.

# Contract

## Published qualification
`floe-native-apps` v0.6.2 passed its immutable release qualification on native Linux amd64 and arm64, including installation, legacy update, source/race/vet, vulnerability scanning, archive integrity and managed/system Xpra input checks.

Go proxy and checksum database readback verified the release.

## Product acceptance
The opt-in `TestInstalledClientInputViewer` uses a task-owned state directory, private display, port and application.

The real macOS disposable application fixture passed pixels, click, Unicode, shortcut, menu, reconnect, stale input, resize, window replacement and close checks.

## Remaining physical acceptance
The current records do not qualify physical system-pointer appearance in shipped Electron, Chrome, Safari or Firefox, page zoom 80/100/125/150/200 percent, or monitor changes.

These limitations do not alter the earlier real IME/soft-keyboard acceptance assigned to the user in the [input validation record](host-application-validation.md).

# Boundaries

Decoded-image checks and application receipts do not prove the physical operating-system pointer. Unavailable physical devices remain explicitly unqualified.

# Evidence

- [Floe native apps v0.6.2 qualification](https://github.com/floegence/floe-native-apps/actions/runs/35861913545): native architecture and browser matrices.

- `internal/hostapps/client_input_test.go`: private real applications, cursor image and click receipts.

- `scripts/check_host_application_input.mjs`: transported geometry and exact application behavior assertions.
