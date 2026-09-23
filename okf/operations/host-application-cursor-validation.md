---
type: Validation Guide
title: Host application cursor acceptance
description: Distinguish published cursor geometry, native click receipts and physical pointer evidence.
tags: [applications, cursor, linux, validation]
timestamp: 2026-09-23T13:00:00Z
---
# Summary

The [viewer contract](../architecture/host-application-viewer.md) owns cursor
geometry; published `floe-native-apps` owns its implementation. Acceptance checks
decoded images and application click receipts separately from the operating
system's displayed pointer. A CSS declaration or ordinary page screenshot cannot
qualify physical pointer appearance. Unavailable devices remain unpassed.

# Published qualification

`floe-native-apps` v0.6.2 passed its immutable release qualification on native
Linux amd64 and arm64, including installation, legacy update, source/race/vet,
vulnerability scanning, archive integrity and managed/system Xpra input checks.
Each architecture passed 360 browser cases across reviewed HTML v20/v21,
Chromium, Firefox and WebKit, DPR 1/1.25/1.5/2/3, sizes 16/24/32/48/64/128 and
opaque/transparent PNGs. Local macOS browser qualification passed the same matrix.
Deterministic tests cover rectangles, edge hotspots, source-based density changes,
reverse decode completion, reset, disconnect, new/destroyed windows and independent
connections. Publisher archive bytes and component identities did not change.

The immutable v0.6.1 tag failed qualification before native input execution because
the browser executable search was ambiguous after installing Firefox. It was not
released. v0.6.2 selects Chromium through the pinned Playwright API and passed the
full qualification. Go proxy and checksum database readback verified the release.

# Product acceptance

The opt-in `TestInstalledClientInputViewer` uses a task-owned state directory,
private display, port and application. Its 48-by-48 red/blue PNG has hotspot
22,24. `scripts/check_host_application_input.mjs` drives the production viewer,
requires the actual transported PNG to become 24-by-24 with hotspot 11,12,
and compares the application's click receipt to the transmitted coordinates.
The same run checks repeated Unicode, physical typing, Backspace, field focus
and toolbar isolation. Final evidence excludes authentication credentials.

The September 23 udesk26 amd64 run passed with GTK3 and Firefox 155.0.1,
using component `b0c8406df9f9925ed7e5b054bbe7ae39c56c3b72861a54ea354dd3e76e880ffd`.
The GTK fixture passed through Chromium 148.0.7778.96, Firefox 150.0.2 and WebKit
26.4 clients. Its click receipt was exactly 300,124 in each; the source, normalized geometry,
backing size, DPR and browser version are recorded with the run. Fixtures use
an independent component-manager state, because the user's running Runtime owns
its installed manager lock. They do not replace that Runtime or its applications.

Focused regressions passed: 115 viewer tests, 17 Desktop tests, 56 browser surface
checks, the real Electron 41.10.5 titlebar/reconnect fixture, Go hostapps/appserver
race tests, and 24 native helper tests. The real macOS disposable application
fixture passed pixels, click, Unicode, shortcut, menu, reconnect, stale input,
resize, window replacement and close checks.

# Remaining physical acceptance

The current records do not qualify physical system-pointer appearance in shipped
Electron, Chrome, Safari or Firefox, page zoom 80/100/125/150/200 percent, or
monitor changes. The available UI automation sends events without placing the
physical desktop pointer on the fixture; captured system cursor images did not
match its red/blue cursor and were rejected as acceptance evidence. Browser pixel
and CSS results are explicitly marked `actualOSCursor: false`.

orange's SSH endpoint timed out repeatedly, so its native arm64 application check
remains unpassed. Hosted arm64 qualification is separate evidence. These limitations
do not alter the earlier real IME/soft-keyboard acceptance assigned to the user in
the [input validation record](host-application-validation.md).

# Evidence

- [Floe native apps v0.6.2 qualification](https://github.com/floegence/floe-native-apps/actions/runs/35861913545): native architecture and browser matrices.
- `internal/hostapps/client_input_test.go`: private real applications, cursor image and click receipts.
- `scripts/check_host_application_input.mjs`: transported geometry and exact application behavior assertions.
- `internal/envapp/ui_src/src/ui/services/hostApplicationViewer.test.ts`: viewer input and lifecycle regression.
- `desktop/scripts/check-host-application-titlebar.mjs`: actual Electron controls and reconnect.
