---
type: Acceptance Record
title: Graphical window native transport qualification
tags: [desktop, applications, transport, validation]
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

The [graphical transport contract](../architecture/graphical-window-transport.md)
passes native direct, real encrypted tunnel, resource-authority and Linux live
checks with published dependencies. Active macOS capture and the Electron
fullscreen portion remain blocked by the host lock screen. Locked-host refusal
passes, but does not qualify an unlocked desktop. These functional checks do not
replace the separate [performance measurement contract](remote-desktop-validation.md).

# Contract

## Source And Published Dependencies
The live capture checks below used Runtime source `5b4e303718adcb5e1b7e244dd306ab8043d2ad9d`, `GOWORK=off`, and no sibling module or package overlays.

The user excluded Redeven push and full integration gates from this local delivery.

## Transport And Authority
Actual Chromium direct checks cover public HTTPS, public HTTP and private numeric-loopback acquisition.

A 4,194,321-byte payload matches byte for byte; a payload larger than 32 MiB closes its stream and never reaches the upstream.

The prepared Xpra 20/21 classes are covered upstream; this phase did not launch a retained Xpra host application on a physical host.

## Linux Live Behavior And Queue Recovery
`server` uses an isolated Runtime and state directory, reached through an owned LAN SSH forward.

Bounded blocking delivery now waits for the consumer and exits on attachment shutdown. The queue was not enlarged and the failure evidence is retained.

## Connection Launcher Refinement
The launcher now names the actual Desktop connection or reported local hostname, keeps optional view/grant-reuse settings collapsed, omits a single-display selector, and separates status checking from connecting.

This verifies the launcher and locked-host boundary; the unlocked macOS limits above still apply.

# Boundaries

## macOS Boundary And Outstanding Work
The Apple Silicon helper reports authorized screen and input access but a locked host.

Prior desktop acceptance results are not substituted for this transport build.

# Evidence

- `internal/localui/window_transport_e2e_test.go` and `internal/codeapp/ui_src/scripts/checkWindowTransport.mjs`: direct browser and Electron resource-scoped acquisition.

- `internal/runtimeproxy/window_tunnel_browser_test.go` and `internal/codeapp/ui_src/scripts/checkWindowTunnel.mjs`: real relay, duplex integrity and the upstream frame-count assertion.

- `internal/hostapps/desktop_transport_linux_test.go`: bounded reply delivery, shutdown, ownership and takeover regression.
