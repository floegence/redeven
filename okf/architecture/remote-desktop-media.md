---
type: Architecture Contract
title: Remote desktop media and input scheduling
tags: [desktop, media, input, wayland, latency]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Published native components own capture, encoding and playback; Redeven consumes them. [Session authority](remote-desktop.md) owns authorization/generations. Media work is bounded and cursors follow painted pixels. Input admission does not prove host delivery. Capture/input failure retires authority; delayed work cannot overwrite or authorize a successor.

# Contract

- Physical-seat capture uses one latest-sample mailbox and separate 60Hz cursor stream. An authenticated inherited descriptor attaches media; bounded backpressure retires attachment instead of blocking input release. Encoder reset begins a new keyframe chain without discarding transported references.
- Intel AV1 uses publisher-verified pinned amd64 musl media-driver/GMM in the private closure, never the root DRM exporter. Copies are intentional, not zero-copy claims.
- Wayland cursor-free pixels/shapes come from one authorized PipeWire stream. Cursor-only buffers cannot restore a lost baseline. [Wayland evidence](../operations/remote-desktop-wayland-optimization-results.md) distinguishes native/browser from physical latency results.
- The privileged service owns login identity, input generation, painted-frame authority and uinput. Unprivileged media workers encode/cursor-report only. Disconnect, VT/session transition, stop or replacement release held input before new ownership.
- DRM conversion retains producer DMA-BUF. Only qualified legacy Rockchip SDR XR24 modifier `0x0800000000000051` maps through AB24 to validated linear XB24; [AFBC evidence](../operations/remote-desktop-orange-afbc-results.md) owns that narrow exception.

# Boundaries

Synthetic encoder probes/preferences establish capability, not hardware latency. Shared capture/input/player behavior stays upstream without duplicate host implementation.

# Evidence

- Published `floe-native-apps` `host_desktop_media.py`, `host_desktop_pipewire.py` and `host_desktop_portal.py`: capture, refinement admission, cursor metadata and bounded input.

- Published `floe-native-apps` `host_desktop_drm.py`, `hostdesktop/login_seat_linux.go`, `hostdesktop/login_service_linux.go` and `hostdesktop/login_media_linux.go`: separate DRM cursor capture, live logind/compositor checks, uinput authority ownership and bounded media attachment.

- Published `floe-native-apps` `host_desktop_player.mjs`, `host_desktop_encoder.py`, `native/host-desktop/nvenc.c`, `mpp.c` and `native_pixels.h`: player queues, shared-slot ownership and native encoders.
