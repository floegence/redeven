---
type: Acceptance Record
title: Graphical window native transport qualification
tags: [desktop, applications, transport, validation]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
---
# Summary

Published graphical transport passes direct, encrypted tunnel, authority and Linux checks. Host lock blocks active macOS capture/Electron fullscreen; locked-host refusal does not qualify unlocked use. Functional results remain separate from performance qualification.

# Contract

Runtime 5b4e303718adcb5e1b7e244dd306ab8043d2ad9d/GOWORK=off uses published dependencies; user excluded product push/full gate. Chromium validates public HTTPS/HTTP and numeric loopback; 4,194,321-byte payload matches,>32 MiB closes before upstream. Upstream covers Xpra 20/21 classes; no retained physical Xpra launch here.

Isolated server Runtime/state/LAN forward qualifies Linux. Bounded blocking reply delivery waits for consumer and exits on shutdown, with no queue enlargement; retain original failure. Launcher uses actual connection/hostname, collapses optional settings, omits single-display selection and separates checking/connecting. Locked Mac refusal passes; active capture/Electron fullscreen, first-time capture and prior-build evidence cannot qualify this build.

# Boundaries

## macOS Boundary And Outstanding Work
The Apple Silicon helper reports authorized screen and input access but a locked host.

Prior desktop acceptance results are not substituted for this transport build.

# Evidence

- `internal/localui/window_transport_e2e_test.go` and `internal/codeapp/ui_src/scripts/checkWindowTransport.mjs`: direct browser and Electron resource-scoped acquisition.

- `internal/runtimeproxy/window_tunnel_browser_test.go` and `internal/codeapp/ui_src/scripts/checkWindowTunnel.mjs`: real relay, duplex integrity and the upstream frame-count assertion.
