---
type: Architecture Contract
title: Remote desktop media and input scheduling
description: Preserve cursor ownership and ordered input/video while reducing capture, encoding and playback work.
tags: [desktop, media, input, wayland, latency]
timestamp: 2026-10-05T05:30:00Z
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

The published player draws every current decoded picture immediately. A cumulative
paint receipt names only the latest picture unchanged across a rendering opportunity
and its following task. Replaced pictures do not receive individual paint receipts;
reset cancels retired authority. PNG refinement decoding cannot serialize later
H.264 decoding. Encoded reference dependencies remain ordered and bounded.

## Encoder Capability

Linux NVIDIA encoding uses the published component's verified glibc 2.31 worker
and the installed NVIDIA driver, independently of its musl capture/media stack.
A synthetic encode probe selects the backend; actual dimensions must then encode
successfully. No system package, host FFmpeg, privileged operation or library-path
injection is required. The worker uses private bounded pipes, one outstanding
picture, zero B frames/lookahead and explicit zero-reorder H.264 SPS restrictions.
An active encoder failure suspends media; it cannot silently replace a reference
chain. The portable software encoder remains the explicit capability fallback.
X11 readback, scaling, IPC and GPU upload still copy pixels. This does not claim
zero-copy capture or certify hardware decode from a browser preference string.

## Wayland Capture And Input

Wayland metadata capture obtains cursor-free pixels and shapes from one authorized
PipeWire stream. Control uses separate local cursor presentation; view capture
composites the host pointer. Embedded-only portals retain embedded presentation.
The [viewer contract](remote-desktop-viewer.md) owns single-cursor policy.
Contiguous SPA header sequences permit damage-aware comparison and unchanged-copy
suppression; missing metadata, corruption or discontinuity require full pixels.
Cursor-only buffers cannot restore a baseline lost before them.
Older compositors may provide readable MemFd without the MAPPABLE flag. The
native client maps these bounded system-memory planes read-only when libpipewire
has not mapped them, and releases its mappings on buffer removal or stream close.
The producer retains its descriptor. Invalid bounds fail explicitly; this does
not introduce DMA-BUF import. The
[buffer compatibility record](../operations/remote-desktop-wayland-buffer-results.md)
owns the reproduction and distribution evidence.
Portal input submits bounded ordered asynchronous D-Bus calls without blocking
media callbacks. Delivery failure closes that OS session and requires reconnect.
Static refinement waits for input and pixels to settle and retires stale candidates
before admission. Transported H.264 dependencies remain ordered. These paths do
not implement DMA-BUF encoder zero-copy, libei/EIS or network congestion adaptation.
The [Wayland optimization record](../operations/remote-desktop-wayland-optimization-results.md)
separates native/browser checks from real desktop and physical latency evidence.

# Boundaries

Synthetic encoder probes and browser preferences are capabilities, not hardware
latency certification. Physical latency and real desktop behavior require their
own observable evidence. The [validation contract](../operations/remote-desktop-validation.md)
and linked results own those claims. Shared capture, input and player behavior
belongs upstream; the host must not add a duplicate implementation.

# Evidence

- Published `floe-native-apps` `host_desktop_media.py`, `host_desktop_pipewire.py` and `host_desktop_portal.py`: capture, refinement admission, cursor metadata and bounded input.
- Published `floe-native-apps` `host_desktop_player.mjs` and `native/host-desktop/nvenc.c`: player queues and NVIDIA worker.
- `internal/remotedesktop/socket_test.go`: transport preserves current-frame cursor presentation and attachment authority.
- `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs`: published-player cursor and input behavior.
