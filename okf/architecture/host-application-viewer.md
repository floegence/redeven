---
type: Interaction Contract
title: Host application viewer state and recovery
description: Present authoritative application state, first pixels, recovery without conflating viewer closure with application termination.
tags: [applications, ui, desktop, runtime]
timestamp: 2026-09-27T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The Redeven bootstrap owns viewer presentation; authenticated Runtime session
state and native backend events own application facts. Pixels appear only after
decoding. A disconnected, inaccessible or stale route never proves application
exit. Reconnection retains process identity and never launches an app. Confirmed
last-window or application closure dismisses an established viewer; a loaded
terminal document instead remains readable. The [shared application contract](host-applications.md)
owns authorization, and the [titlebar contract](../desktop/host-application-titlebar.md)
owns toolbar presentation.

# Contract

Graphical state and every backend's picture/input connection use the [Flowersec window transport](graphical-window-transport.md). The viewer owns the presentation and recovery rules below.

## Browser launch admission
The catalog reserves a browser tab in the initiating click and keeps application identity visible while launch and route admission run. Retry uses the host's existing launch deduplication; closing the tab while admission is pending never cancels or kills a session that the host may have admitted.

Browser loading documents explicitly omit Desktop chrome and must not depend on Node globals.

## Connection and terminal presentation
The localized bootstrap owns connection presentation. A launcher that exits before opening any window produces an actionable launch failure instead of an endless waiting page; this must not impose a timeout on a live, slow-starting process.

Terminal records are bounded in memory and do not survive Runtime restart; an expired document route may no longer be served, and users must reopen from the library rather than rely on an old viewer URL.

## Rendering ownership
The [display contract](host-application-display.md) owns SDK layouts, density, cursor coordinates and native window-state mapping. First-pixel and terminal state decisions remain here; neither resource nor geometry notifications prove application exit.

# Boundaries

The viewer cannot infer process termination from an empty inventory or failed transport. Application minimum sizes, reserved OS shortcuts, inaccessible windows and browser dismissal permissions remain authoritative.

# Evidence

- `internal/codeapp/appserver/host_application_viewer/`: connection reconciliation, first-frame, terminal and geometry adapters.

- `internal/envapp/ui_src/src/ui/services/hostApplicationViewer.test.ts` and `macHostApplicationViewer.test.ts`: backend events, stale callbacks, first-pixel, pointer gestures and reconnect acceptance.

- `internal/codeapp/appserver/host_applications_test.go`: complete localized launch requests, owner-authorized terminal snapshots and retained state routes.
