---
type: Runtime Contract
title: macOS application picture quality and delivery
tags: [runtime, desktop, applications, macos]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The native helper owns resolution/encoding; viewer owns preferences/statistics. Current-generation decoding precedes acknowledgement. Quality/reconnect preserves app identity and native-session permissions/input. Unavailable video selects explicit image transport; report actual producing transport. Capture failures retain the existing reconnect boundary.

# Contract

## Resolution and picture controls
Capture dimensions use the smaller of the viewer's device-pixel ratio, the native window's pixel density, and the chosen longest-edge limit.

Opening settings never resizes the app.

Limits are bounded and validated by the native helper.

## Encoders and delivery
A browser advertising H.264 WebCodecs software decoding can receive VideoToolbox hardware video. Hardware encoder unavailability uses JPEG images; a browser decoder failure explicitly renegotiates image transport.

Unchanged resize requests retain frame credit.

## Observable statistics and limits
Runtime diagnostics record connection-to-first-frame duration and generation; the browser debug log measures connection-to-first-decoded-frame duration.

High latency, host capture, encoding, browser decoding and network capacity can reduce achieved frame rate; a 60 FPS limit is not a guarantee of 60 FPS delivery.

# Boundaries

Decoded frames acknowledge only the current capture generation. Picture preferences cannot change process or permission ownership. Video unavailability uses the declared image transport, while a capture failure retains the existing session recovery boundary.

# Evidence

- `desktop/native/computer-host/Sources/RedevenComputerHost/HostApplicationCapture.swift` and `desktop/native/computer-host/Tests/RedevenComputerHostTests/HostApplicationCaptureTests.swift`: sampling, validated profiles and encoder ownership.

- `internal/hostapps/macos.go` and `macos_test.go`: authenticated frame envelopes and connection ownership.

- `internal/codeapp/appserver/host_application_viewer/macos.js` and `internal/envapp/ui_src/src/ui/services/macHostApplicationViewer.test.ts`: live controls, decode acknowledgements, statistics and stale-frame rejection.
