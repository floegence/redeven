---
type: Acceptance Record
title: Graphical window native transport qualification
description: Assess published Flowersec direct and tunnel coverage, Linux application and desktop behavior, and the remaining unlocked macOS qualification.
tags: [desktop, applications, transport, validation]
timestamp: 2026-10-02T18:40:00Z
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

The final live Runtime builds use source
`5b4e303718adcb5e1b7e244dd306ab8043d2ad9d`, `GOWORK=off`, and no sibling module
or package overlays. Go and all three TypeScript consumers use Flowersec 5.7.1
from source `38a06b98c43fee60a37999d5debfc30e98dd8b98`. Go and Swift consume
floe-native-apps 0.22.8 from `2aa4e5ef46741e302f70a925569cc1eaf90af490`.
Upstream qualification, publication and registry consumer readback passed.

Code App, Env App and Desktop builds and type checks passed. Focused coverage
includes 31 Code App tests, 214 Env App tests, 27 Desktop tests, the affected Go
packages, published-resource checks and the native helper's 32 Swift tests.
Dependency consistency, notices, compatibility and OKF checks passed. The user
excluded Redeven push and full integration gates from this local delivery.

## Transport And Authority

Actual Chromium direct checks cover public HTTPS, public HTTP and private
numeric-loopback acquisition. Electron 41.10.5 exercises the production private
bridge header scope. They verify fresh acquisition after carrier closure,
resource-bound requests, raw graphical route rejection, disposal and the prepared
Xpra iframe inheriting exactly its parent's native constructor.

The tunnel fixture connects a Go endpoint and a browser controller through an
actual Flowersec relay. The product window adapter carries concurrent control
and media streams through exactly one browser network connection at
`/flowersec/v3/tunnel`. A 4,194,321-byte payload matches byte for byte; a payload
larger than 32 MiB closes its stream and never reaches the upstream. Chinese and
emoji control text also round-trips. Test-only certificate and local-network
permissions apply to disposable fixtures, not product browser security policy.

Viewer behavior checks cover paint-gated input, explicit client text paste,
clipboard fallback, display choice, view-only mode, takeover, reconnect audio,
localized narrow settings, keyboard navigation and native disconnect ordering.
The prepared Xpra 20/21 classes are covered upstream; this phase did not launch
a retained Xpra host application on a physical host.

## Linux Live Behavior And Queue Recovery

`server` uses an isolated Runtime and state directory, reached through an owned
LAN SSH forward. Its real desktop is X11; its task application uses the native
private Wayland backend. The GTK fixture receives physical ASCII input and
client composition containing Chinese and emoji. Reload preserves its PID and
text; closing the viewer preserves the application. The real desktop paints at
1920x1080, keeps view-only input disabled, reconnects and disconnects explicitly.
The four observed browser network sockets all use `/flowersec/v3/direct`, with
zero raw graphical data requests and zero page errors.

The first final-build run exposed a real product adapter defect: a short input
reply burst filled its 16-event queue and closed the attachment. The isolated
test failed before the change. Bounded blocking delivery now waits for the
consumer and exits on attachment shutdown. Five repetitions of that test, eight
Linux desktop test cases and the live application/desktop flow passed after the
fix. The queue was not enlarged and the failure evidence is retained.

## macOS Boundary And Outstanding Work

The Apple Silicon helper reports authorized screen and input access but a locked
host. The real product viewer establishes Flowersec, displays the locked state,
paints zero frames and keeps input disabled. No system policy or authorization
was bypassed. The native Electron carrier passes independently of desktop capture.

The wider Electron viewer fixture stopped at native fullscreen while the host was
locked. Active host application input, live desktop capture and this fullscreen
step require normal host unlock before they can be recorded as passed. Prior
desktop acceptance results are not substituted for this transport build.

# Evidence

- `internal/localui/window_transport_e2e_test.go` and `internal/codeapp/ui_src/scripts/checkWindowTransport.mjs`: direct browser and Electron resource-scoped acquisition.
- `internal/runtimeproxy/window_tunnel_browser_test.go` and `internal/codeapp/ui_src/scripts/checkWindowTunnel.mjs`: real relay, duplex integrity and the upstream frame-count assertion.
- `internal/hostapps/desktop_transport_linux_test.go`: bounded reply delivery, shutdown, ownership and takeover regression.
- `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs`: production viewer behavior with a controlled media peer.
- External task evidence `window-flowersec-transport-20261003`: final live reports, binary/module receipts, immutable upstream release receipts and preserved failing runs.
