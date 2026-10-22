---
type: Architecture Contract
title: Remote desktop media and input scheduling
description: Preserve bounded pixel ownership, cursor presentation and ordered input/video while reducing capture and playback work.
tags: [desktop, media, input, wayland, latency]
timestamp: 2026-10-17T01:46:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The published native component owns desktop capture, encoding and playback;
Redeven consumes that implementation. The [session contract](remote-desktop.md)
owns authorization and generation changes. Media work stays bounded, cursor
presentation follows painted pixels, and input admission cannot certify host
application delivery. Capture/input failure retires authority explicitly; delayed
work cannot overwrite or authorize a successor generation.

# Contract

## Video Scheduling
The physical-seat service uses one latest-sample mailbox for capture and a separate 60 Hz cursor stream. The media worker is attached through an authenticated inherited descriptor and bounded backpressure retires the attachment instead of blocking input release.

Encoder reset starts a fresh keyframe chain; it cannot discard a transported reference.

## Encoder Capability
Intel AV1 uses the published component's pinned, publisher-verified amd64 musl media driver and GMM library inside the private media closure. The root DRM exporter never loads this userspace driver.

These copies are intentional; this is not zero-copy capture.

## Wayland Capture And Input
Wayland metadata capture obtains cursor-free pixels and shapes from one authorized PipeWire stream. Cursor-only buffers cannot restore a baseline lost before them. The [Wayland optimization record](../operations/remote-desktop-wayland-optimization-results.md) separates native/browser checks from real desktop and physical latency evidence.

## Physical-Seat Input
The privileged service owns login-session identity, input generation, painted frame authority and uinput. Its DRM exporter passes capture descriptors to an unprivileged media worker; that worker can encode and report cursor state but cannot inject input or grant frame authority.

Disconnect, session/VT transition, service stop and attachment replacement also release held input before the next owner is admitted.

## Physical Scanout Formats
The unprivileged DRM converter retains the producer's DMA-BUF descriptor. For the qualified legacy Rockchip SDR layout only, it imports single-plane XR24 with modifier `0x0800000000000051` as canonical AB24 and labels the validated linear result XB24. The [orange AFBC record](../operations/remote-desktop-orange-afbc-results.md) owns producer-source, pixel and physical-host evidence for this narrow mapping.

# Boundaries

Synthetic encoder probes and browser preferences are capabilities, not hardware latency certification. Shared capture, input and player behavior belongs upstream; the host must not add a duplicate implementation.

# Evidence

- Published `floe-native-apps` `host_desktop_media.py`, `host_desktop_pipewire.py` and `host_desktop_portal.py`: capture, refinement admission, cursor metadata and bounded input.

- Published `floe-native-apps` `host_desktop_drm.py`, `hostdesktop/login_seat_linux.go`, `hostdesktop/login_service_linux.go` and `hostdesktop/login_media_linux.go`: separate DRM cursor capture, live logind/compositor checks, uinput authority ownership and bounded media attachment.

- Published `floe-native-apps` `host_desktop_player.mjs`, `host_desktop_encoder.py`, `native/host-desktop/nvenc.c`, `mpp.c` and `native_pixels.h`: player queues, shared-slot ownership and native encoders.
