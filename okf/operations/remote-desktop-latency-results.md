---
type: Qualification Record
title: Remote desktop latency and NVIDIA encoding
description: Assess the controlled RTX 4090 D desktop latency comparison and the remaining capture and transport limits.
tags: [desktop, media, latency, qualification]
timestamp: 2026-10-04T13:20:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

Physical-seat v0.22.29 improves host-local input receipt/CPU; X11 v0.22.10 improves client-window response with NVIDIA encoding/local host-shaped cursor. Results certify tested configurations only, not input-to-photon, universal GPU, zero-copy or WAN performance. Session authority persists; capture/encoder failure requires fresh current-generation paint.

# Contract

## Physical-seat measurements
The v0.22.29 physical-seat candidate was measured on the task-owned `udesk26` DRM output (i915, DP-3, 1920x1280) and `orange` (1920x1080). These are host-local Unix/DRM observations, not physical input-to-photon measurements or Desktop SSH/browser end-to-end latency.

## Configuration and measurement
The physical server uses Ubuntu X11, i7-14700KF, RTX 4090 D, NVIDIA 550.90.07 and 1920x1080 at 60 Hz.

The earlier NoMachine comparison is context only and must not be presented as this candidate's same-path benchmark.

There is no optical sensor or high-speed-camera evidence.

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

The server GPU encodes; the local Mac decodes.

## Failure and recovery evidence
The initial NVENC prototype omitted explicit SPS bitstream restrictions.

Unit/browser coverage rejects invalid cursor metadata and prevents cursor shape messages from granting painted-frame authority.

# Boundaries

## Limits and next work
X11 readback, scaling, raw IPC and GPU upload remain CPU-visible. Adaptive bitrate, cancellable refinement transport and a new real-time carrier require separate measured justification. macOS and Wayland retain their embedded-cursor contracts; this result qualifies X11 local shapes.

# Evidence

- [Native release source](https://github.com/floegence/floe-native-apps/tree/v0.22.10): bounded player, cursor, driver worker, pinned build and real-driver qualifier.

- [Release qualification](https://github.com/floegence/floe-native-apps/actions/runs/37204885377): exact-tag native installation and platform checks; final job outcome is authoritative.

- `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs`: published-player cursor, paint authority, mode/reconnect and browser/Electron behavior.
