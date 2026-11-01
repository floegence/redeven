---
type: Validation Guide
title: Host application cursor acceptance
tags: [applications, cursor, linux, validation]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
---
# Summary

The [viewer contract](../architecture/host-application-viewer.md) owns cursor
geometry; published `floe-native-apps` owns its implementation. Acceptance checks
decoded images and application click receipts separately from the operating
system's displayed pointer. A CSS declaration or ordinary page screenshot cannot
qualify physical pointer appearance. Unavailable devices remain unpassed.

# Contract

Native 0.6.2 immutable qualification passes Linux amd64/arm64 install/update/source/race/vet/vulnerability/archive/managed-system Xpra checks, then Go proxy/SumDB readback. TestInstalledClientInputViewer owns private state/display/port/app. Disposable Mac fixture passes pixels/click/Unicode/shortcut/menu/reconnect/stale-input/resize/window replacement/close.

Physical system pointers in shipped Electron/Chrome/Safari/Firefox,80/100/125/150/200% zoom and monitor changes remain unqualified. [Input validation](host-application-validation.md) separately assigns real IME/soft-keyboard acceptance.

# Boundaries

Decoded-image checks and application receipts do not prove the physical operating-system pointer. Unavailable physical devices remain explicitly unqualified.

# Evidence

- [Floe native apps v0.6.2 qualification](https://github.com/floegence/floe-native-apps/actions/runs/35861913545): native architecture and browser matrices.

- `internal/hostapps/client_input_test.go`: private real applications, cursor image and click receipts.

- `scripts/check_host_application_input.mjs`: transported geometry and exact application behavior assertions.
