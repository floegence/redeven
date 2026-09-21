---
type: Runtime Contract
title: macOS application picture quality and delivery
description: Retina window pixels, live picture controls, hardware video and bounded authenticated frame delivery.
tags: [runtime, desktop, applications, macos]
timestamp: 2026-09-21T17:30:00Z
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

The toolbar shows the host's unboxed application icon and name as its menu trigger.
The adjacent window picker uses a compact host title; an untitled window or a title
identical to the application name shows the localized window label instead. Only
multiple windows display a count badge. The full title and count remain accessible,
and the picker lists every host title, with application name and index only for
untitled entries. Spare toolbar width is not part of a button. Narrow viewers
progressively hide action labels while retaining distinct icons and accessible
names. Light and dark appearances share the same layout and 32-pixel targets.

Native menus and window lists use compact popovers; picture settings separate
presets, advanced limits and measured statistics. Preset arrow navigation moves
focus without applying a setting or sending input to the application; activation
applies it. The quit confirmation identifies the bound application and initially
focuses Cancel. Expanding any panel preserves the content area's dimensions.

The picture settings offer Automatic, Clarity
first, Motion first and Save data. Their default limits are respectively 4096/30,
4096/30, 2560/60 and 1600/15 (longest-edge pixels / frames per second). Clarity uses
higher JPEG quality on image transport; Automatic adjusts video bitrate under
sustained delivery pressure. Explicit resolution and frame-rate limits override
profile defaults. Local browser preferences persist across applications and
reloads; unavailable browser storage does not block operation.

The viewer negotiates picture settings, decoding support and content-area size in
one initial `resume` request. Native capture waits for this request; it does not
start a default stream and immediately replace it. The helper applies the requested
size before resolving the capture source. An unchanged effective native size does
not restart capture, including when the app constrains the requested dimensions.
A newly selected window uses the most recent viewport. Subsequent viewport, density
and picture changes use one generation-independent configuration request, so a
size update cannot be lost to a simultaneous picture-generation change.

Changes apply to the existing application and start a new capture generation.
Input remains disabled for new coordinates until that generation has decoded
pixels. Browser scaling and display-density changes renegotiate the capture.
No option requires an application restart or changes the user's system display
configuration. Limits are bounded and validated by the native helper.

# Encoders and delivery

A browser advertising H.264 WebCodecs software decoding can receive VideoToolbox
hardware video. The viewer requests software decoding with latency optimization:
hardware browser decoders can buffer the first chunk until more input arrives,
which deadlocks a static stream with one unacknowledged frame. Capability negotiation
and actual decoder configuration use the same options; unsupported browsers select
image transport immediately. The encoder is real time, has no frame reordering, and emits AVCC chunks
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

Capture transitions have one native owner. Source discovery, start and stop are
serialized, and a replacement waits for the preceding `startCapture` and
`stopCapture` completions. Requests arriving during a transition supersede its
desired generation; obsolete callbacks and intentional stop errors cannot publish
failure for the successor. Unchanged resize requests retain frame credit.

# Observable statistics and limits

Runtime diagnostics record connection-to-first-frame duration and generation;
the browser debug log measures connection-to-first-decoded-frame duration. These
local diagnostics carry no image bytes, window titles or credentials. Native window
messages also report source-discovery duration to distinguish OS lookup delay.

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
- `internal/envapp/ui_src/src/styles/hostApplicationSurfaces.browser.test.tsx`: real browser decoding and acknowledgement of a single synthetic VideoToolbox H.264 frame without a second frame or decoder timeout.
- `scripts/check_macos_host_application_startup.py`: disposable native startup during reconfiguration, negotiated attachment, unchanged-size capture continuity, repeated reconnect timing and superseded capture requests.
