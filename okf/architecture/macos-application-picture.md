---
type: Runtime Contract
title: macOS application picture quality and delivery
description: Retina window pixels, live picture controls, hardware video and bounded authenticated frame delivery.
tags: [runtime, desktop, applications, macos]
timestamp: 2026-09-21T04:00:00Z
---
# Summary

Redeven's native application capture helper owns image resolution and encoding;
the viewer owns picture preferences and measured display statistics. Application
identity, permissions and input retain the [native session contract](macos-host-applications.md).
A frame can acknowledge delivery only after decoding for the current capture
generation. Quality changes and reconnects preserve the application process.
Hardware or browser video unavailability selects the explicit image transport;
the quality panel reports the transport actually producing frames. A real capture
failure retains the session's existing reconnect boundary.

# Resolution and picture controls

Capture dimensions use the smaller of the viewer's device-pixel ratio, the native
window's pixel density, and the chosen longest-edge limit. Retina windows are not
sampled at one pixel per logical point and then stretched. Dimensions are even
for video encoding. The macOS 14 ScreenCaptureKit filter reports source density;
macOS 13 derives it from the screen with the largest window intersection.

The fixed top application toolbar opens picture settings in an anchored popover,
collapsed by default. The toolbar reserves 46 logical pixels; the canvas and native
AX resize requests use the remaining content area, and pointer coordinates are
mapped against those same canvas bounds. Opening settings never resizes the app.
Outside input, focus leaving the controls, or Escape closes the popover; Escape
returns focus to its trigger. Popovers fit narrow and short viewports, and loss of
the stream retires them. Window selection, native menus, closing the current window
and confirmed application quit are independent toolbar actions.

The picture settings offer Automatic, Clarity
first, Motion first and Save data. Their default limits are respectively 4096/30,
4096/30, 2560/60 and 1600/15 (longest-edge pixels / frames per second). Clarity uses
higher JPEG quality on image transport; Automatic adjusts video bitrate under
sustained delivery pressure. Explicit resolution and frame-rate limits override
profile defaults. Local browser preferences persist across applications and
reloads; unavailable browser storage does not block operation.

Changes apply to the existing application and start a new capture generation.
Input remains disabled for new coordinates until that generation has decoded
pixels. Browser scaling and display-density changes renegotiate the capture.
No option requires an application restart or changes the user's system display
configuration. Limits are bounded and validated by the native helper.

# Encoders and delivery

A browser advertising H.264 WebCodecs decoding can receive VideoToolbox hardware
video. The encoder is real time, has no frame reordering, and emits AVCC chunks
with decoder configuration on key frames. Hardware encoder unavailability uses
JPEG images; a browser decoder failure explicitly renegotiates image transport.
Identical BGRA rows are not encoded again, including when ScreenCaptureKit emits
repeated complete samples. A still window receives a lossless PNG refresh after
a 400 ms settling interval. PNG
refresh does not reset H.264 decoder references; subsequent video continues in
order. No audio is captured.

The helper protocol emits encoded bytes with generation, frame ID, codec,
dimensions, target rate and actual transport. The Go adapter wraps this metadata
as a big-endian four-byte JSON-header length, JSON header and binary payload in
one authenticated WebSocket message. Credentials remain outside URLs. Frame
notifications wake transmission immediately instead of imposing a 20 FPS timer.

Only one encoded frame may remain unacknowledged. New capture samples replace
the pending pixel buffer while that frame is in flight. Encoding resumes after
a matching viewer acknowledgement. This bounds latency and memory without
dropping H.264 reference frames. A new viewer resets capture and starts at a new
key frame; stale acknowledgements cannot grant credit to its successor. Each
viewer has a separate wakeup channel so a closing predecessor cannot consume
the successor's only frame notification. The native JSON reader allows up to
128 MiB per message to accommodate bounded 4096-pixel lossless frames and their
base64 envelope.

# Observable statistics and limits

The panel reports decoded frame dimensions, frames painted per second, received
stream bandwidth and actual transport. Frame rate is measured rather than copied
from the configured limit. A static application may legitimately show zero FPS
and no bandwidth after its final lossless refresh. High latency, host capture,
encoding, browser decoding and network capacity can reduce achieved frame rate;
a 60 FPS limit is not a guarantee of 60 FPS delivery.

# Evidence

- `desktop/native/computer-host/Sources/RedevenComputerHost/HostApplicationCapture.swift` and `desktop/native/computer-host/Tests/RedevenComputerHostTests/HostApplicationCaptureTests.swift`: sampling, validated profiles and encoder ownership.
- `internal/hostapps/macos.go` and `macos_test.go`: authenticated frame envelopes and connection ownership.
- `internal/codeapp/appserver/host_application_viewer/macos.js` and `internal/envapp/ui_src/src/ui/services/macHostApplicationViewer.test.ts`: live controls, decode acknowledgements, statistics and stale-frame rejection.
- `scripts/check_macos_host_applications.py`: real native window Retina, hardware video, lossless refresh, backpressure, measured animation frame rates
  and live reconfiguration acceptance.
