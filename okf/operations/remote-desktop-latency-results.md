---
type: Qualification Record
title: Remote desktop latency and NVIDIA encoding
description: Assess the controlled RTX 4090 D desktop latency comparison and the remaining capture and transport limits.
tags: [desktop, media, latency, qualification]
timestamp: 2026-10-04T13:20:00Z
---
# Summary

The 2026-10-04 controlled X11 comparison observes lower client-window response
latency with `floe-native-apps` v0.22.10, a working NVIDIA encoding path and one
local host-shaped cursor. Session authority remains owned by the
[desktop contract](../architecture/remote-desktop.md). These measurements establish
the tested configuration, not physical input-to-photon latency, universal GPU
performance, zero-copy capture or WAN behavior. Capture/encoder failures still
revoke media authority and require fresh current-generation paint.

# Contract

## Configuration and measurement

The physical server uses Ubuntu X11, i7-14700KF, RTX 4090 D, NVIDIA 550.90.07 and
1920x1080 at 60 Hz. The local Mac runs Electron 41.10.5. Baseline and candidate use
the same task-owned 1440x960 client window, loopback runtime endpoint, SSH port
forward and authenticated Flowersec viewer. The baseline is Redeven `7da7f55e3`
with native v0.22.9; the candidate uses v0.22.10. The user's pre-existing runtime
and NoMachine sessions remain running.

This path controls the A/B but differs from Desktop's SSH placement HTTP/2 bridge.
The earlier NoMachine comparison is context only and must not be presented as
this candidate's same-path benchmark. NoMachine's proprietary native pipeline
was not modified or reproduced.

Each workload includes 60 browser clicks and 30 native macOS CGEvent clicks. A
continuous ScreenCaptureKit 60 Hz stream observes the client-window pixels. The
first three native clicks are warmup; all remaining 27 match in each valid run.
Same-client-clock click timing needs no cross-host synchronization. Source age
uses 40 clock probes with minimum RTT 3 ms. The workload alternates six seconds
of activity with two seconds of stillness; the heavy scene scrolls text in a
1500x900 task-owned window. Compositor/capture sampling and clock uncertainty
remain. There is no optical sensor or high-speed-camera evidence.

## Observed results

Values are milliseconds, median / nearest-rank P95.

| Endpoint | Baseline | Candidate |
| --- | ---: | ---: |
| Light click to client window | 67.5 / 84.8 | 56.0 / 71.7 |
| Scrolling click to client window | 69.9 / 88.3 | 57.8 / 75.2 |
| Light source timecode to client window | 60.4 / 73.4 | 49.9 / 68.8 |
| Scrolling source timecode to client window | 60.1 / 78.7 | 54.5 / 71.6 |
| Light receive to decoded | 1.0 / 1.4 | 1.0 / 1.3 |
| Light decoded to completed canvas draw | 7.9 / 15.3 | 4.8 / 8.3 |
| Scrolling decoded to completed canvas draw | 5.4 / 14.9 | 4.5 / 8.5 |

A second candidate light run observes 55.8 / 78.0 ms click-to-window latency,
again with 27/27 matched clicks. A final runtime built with `GOWORK=off` from the
public proxy/checksum-verified module observes 55.9 / 68.3 ms (27/27 matched),
with VideoToolbox decoding at 1.0 / 1.3 ms. The valid candidate runs have no decoder recovery
and remain in one generation. The draw measurement includes canvas copy work;
immediate scheduling cannot remove that cost. These sample sizes do not establish
an exact universal percentage or several-fold improvement.

NVIDIA's session listing identifies the task worker's 1920x1080 H.264 session,
and its media headers report `nvidia-nvenc`. CDP Media identifies
`VideoToolboxVideoDecoder` and a platform decoder on the Mac; the WebCodecs
hardware preference alone is not treated as evidence. The browser does not expose
VideoToolbox's per-session physical hardware-use property. The server GPU encodes;
the local Mac decodes.

The real-driver worker qualifier verifies H.264 decode, BGRA color tolerance and
zero-reorder SPS at 1080p and 4K. Excluding three startup frames, 117 frames measure
raw IPC/upload/encode median/P95 of 3.42/4.38 ms at 1080p and 13.12/14.51 ms at 4K.
These are synthetic worker round trips, not desktop or 4K physical-display latency.
Raw-pixel transfer and GPU upload slightly increase capture-to-receive time on
this already-fast CPU; the full improvement cannot be attributed to NVENC alone.

## Failure and recovery evidence

The initial NVENC prototype omitted explicit SPS bitstream restrictions.
VideoToolbox retained pictures for about 112 ms and repeatedly required recovery.
The failed trace is retained outside maintained source. The final encoder declares
`max_num_reorder_frames=0` and `max_dec_frame_buffering=1`; real-driver qualification
checks emitted headers and decoded pixels. Subsequent client decoding is about
1 ms without recovery. Fast encode completion alone would have missed this defect.

Four real X11 cursor states (arrow, text, crosshair, transparent), explicit decoder
recovery, view-only and accepted control restoration pass. The first lifecycle
harness dismissed the mandatory Take control dialog and timed out; the corrected
harness explicitly accepts that existing product decision. No product confirmation
was bypassed. Unit/browser coverage rejects invalid cursor metadata and prevents
cursor shape messages from granting painted-frame authority.

# Boundaries

## Limits and next work

X11 readback, scaling, raw IPC and GPU upload remain CPU-visible. A zero-copy GPU
capture path requires its own design and evidence. Full-screen PNG transmission
still shares a reliable carrier; independent decode does not make transmitted
bytes preemptible. Adaptive bitrate, cancellable refinement transport and a new
real-time carrier require separate measured justification. macOS and Wayland
retain their embedded-cursor contracts; this result qualifies X11 local shapes.

# Evidence

- [Native release source](https://github.com/floegence/floe-native-apps/tree/v0.22.10): bounded player, cursor, driver worker, pinned build and real-driver qualifier.
- [Release qualification](https://github.com/floegence/floe-native-apps/actions/runs/37204885377): exact-tag native installation and platform checks; final job outcome is authoritative.
- `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs`: published-player cursor, paint authority, mode/reconnect and browser/Electron behavior.
- `internal/remotedesktop/attachment.go`: offered-frame receipts, generation and product authorization.
- Local evidence corpus `task-evidence/desktop-latency-gpu-20261004` contains raw click/window streams, source clocks, failure traces and analysis scripts; it is not shipped product content.
