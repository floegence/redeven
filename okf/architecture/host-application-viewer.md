---
type: Interaction Contract
title: Host application viewer state and recovery
description: Present authoritative application state, first pixels, recovery without conflating viewer closure with application termination.
tags: [applications, ui, desktop, runtime]
timestamp: 2026-09-27T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Runtime/native events own application facts; Redeven bootstrap owns viewer presentation. Show pixels only after decoding. Transport/access loss never proves exit, and reconnect preserves process identity without launching. Confirmed last-window/app closure dismisses an established viewer; an already-loaded terminal document remains readable. [Application authorization](host-applications.md) and [titlebar](../desktop/host-application-titlebar.md) retain their owners.

# Contract

- All graphical state and picture/input use [Flowersec window transport](graphical-window-transport.md). Reserve browser tabs in the initiating click, retain app identity through admission and use host launch deduplication on retry. Closing a pending tab never kills a possibly admitted app.
- Browser loading pages omit Desktop chrome and Node dependencies. Launcher exit before any window is actionable failure; a live slow-starting process has no artificial window timeout.
- Terminal records are bounded memory, lost on Runtime restart. Expired routes require reopening from the library.
- [Display layout](host-application-display.md) owns geometry/density/cursors; resource/geometry notices cannot establish exit or first-pixel completion.

# Boundaries

Empty inventory or failed transport cannot imply termination. App minimum size, reserved OS shortcuts, inaccessible windows and browser dismissal limits remain authoritative.

# Evidence

- `internal/codeapp/appserver/host_application_viewer/`: connection reconciliation, first-frame, terminal and geometry adapters.

- `internal/envapp/ui_src/src/ui/services/hostApplicationViewer.test.ts` and `macHostApplicationViewer.test.ts`: backend events, stale callbacks, first-pixel, pointer gestures and reconnect acceptance.

- `internal/codeapp/appserver/host_applications_test.go`: complete localized launch requests, owner-authorized terminal snapshots and retained state routes.
