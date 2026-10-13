---
type: Architecture Contract
title: Remote desktop media and input scheduling
description: Preserve bounded pixel ownership, cursor presentation and ordered input/video while reducing capture and playback work.
tags: [desktop, media, input, wayland, latency]
timestamp: 2026-10-13T02:00:00Z
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

The physical-seat service uses one latest-sample mailbox for capture and a
separate 60 Hz cursor stream. Unchanged frames are not encoded repeatedly;
H.264 and VP9 reference order is preserved and one settled lossless refinement follows
activity. Cursor position, visibility and hotspot validity are independent of
video progress, so pointer motion remains responsive on a static desktop.
The media worker is attached through an authenticated inherited descriptor and
bounded backpressure retires the attachment instead of blocking input release.

The published player draws every current decoded picture immediately. A cumulative
paint receipt names only the latest picture unchanged across a rendering opportunity
and its following task. Replaced pictures do not receive individual paint receipts;
reset cancels retired authority. PNG refinement decoding cannot serialize later
video decoding. Encoded reference dependencies remain ordered and bounded.

Linux picture requests offer VP9 only after the published player's positive
WebCodecs probe; H.264 remains available. The same offer applies to connect,
configuration and reconnect. A retired asynchronous probe cannot acquire a
successor attachment ticket. macOS retains its native picture contract.
The software path prefers supported VP9 after hardware H.264 candidates fail
their capability probes. Codec selection is observable and does not certify
hardware decoding or RustDesk performance parity.

Four cumulative frame credits bound unacknowledged pictures. Encoder timestamps
advance by one configured frame period per submitted frame, even after credits
stall submission; capture telemetry retains the actual monotonic capture time.
Idle transport time cannot inflate the next frame's codec budget. Encoder reset
starts a fresh keyframe chain; it cannot discard a transported reference.

## Encoder Capability

Linux NVIDIA encoding uses the published component's verified glibc 2.31 worker
and the installed NVIDIA driver, independently of its musl capture/media stack.
A synthetic encode probe selects the backend; actual dimensions must then encode
successfully. No system package, host FFmpeg, privileged operation or library-path
injection is required. The worker uses a sealed-size shared pixel slot and private
bounded control pipes, one outstanding
picture, zero B frames/lookahead and explicit zero-reorder H.264 SPS restrictions.
An active encoder failure suspends media; it cannot silently replace a reference
chain. The portable software encoder remains the explicit capability fallback.
X11 readback, scaling, IPC and GPU upload still copy pixels. This does not claim
zero-copy capture or certify hardware decode from a browser preference string.

Rockchip uses the same native encoder owner with the installed
`librockchip_mpp.so.1`. The verified unprivileged worker consumes limited-range
BT.709 NV12, declares matching H.264 color metadata and the level required by
the configured dimensions/frame rate, and allows one synchronous frame without
reordering. Worker probes establish availability; failure retires the active
reference chain. No device permissions, driver or system packages are changed.

DRM conversion and both native encoders publish raw pixels through separate
same-owner memfds sealed against resize and seal changes. Each worker verifies
regular storage, exact bounded capacity and the required seals before mapping.
Pipes publish only frame identity/completion and compressed output. The parent
reuses a slot only after matching completion; capture copies the converter view
into its existing owned Gst pool before another conversion. Encoder upload still
copies into its own slot. Shutdown reaps the child before unmapping, and invalid
replies or deadlines retire the chain. These copies are intentional; this is
not zero-copy capture.

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
Capture copies producer pixels directly into a bounded Gst buffer pool, using
native memory work outside the Python interpreter lock. The retained clean Gst
frame owns the comparison baseline; embedded-cursor composition uses a separate
buffer. BGRA/BGRx/RGBA/RGBx and padded rows retain their existing pixel meaning.
Encoder views retain their parent buffer lease. Exhaustion waits without losing
the final changed frame, and shutdown interrupts that wait before joining capture.
The [capture pool record](../operations/remote-desktop-capture-pool-results.md)
owns format, lifetime, installed-stack and measured performance evidence.
Portal input submits bounded ordered asynchronous D-Bus calls without blocking
media callbacks. Delivery failure closes that OS session and requires reconnect.
Static refinement waits for input and pixels to settle and retires stale candidates
before admission. Transported video dependencies remain ordered. These paths do
not implement DMA-BUF encoder zero-copy, libei/EIS or network congestion adaptation.
The [Wayland optimization record](../operations/remote-desktop-wayland-optimization-results.md)
separates native/browser checks from real desktop and physical latency evidence.

## Physical-Seat Input

The privileged service owns login-session identity, input generation, painted
frame authority and uinput. Its DRM exporter passes capture descriptors to an
unprivileged media worker; that worker can encode and report cursor state but
cannot inject input or grant frame authority. A separate bounded media channel
keeps encoding and slow consumers from blocking control or input release. Queue
overflow or media failure retires the attachment and releases held input.
For the fixed root-owned, group-writable `/dev/mpp_service` character device,
the media child may retain the Runtime user's existing device-group membership.
No membership or ACL is modified, and input, text and power children retain
their narrower group boundary. GPU libraries are loaded only after dropping
root and all Linux capabilities.

One persistent system-bus connection observes logind changes. Before admitting
each input event, the service re-reads the active session, lock state and kernel
VT and verifies the bound compositor identity. D-Bus signals wake the owner but
do not authorize from cached state. Process inspection is limited to binding or
rebuilding compositor identity; failed reads or identity checks revoke input.
GNOME's verified compositor binds its actual logind locker session from its
startup session identity or the user's Display session. This can differ from the
physical seat after another desktop login; both hints are checked without
replacing the physical seat or VT boundary. Unknown or foreign locker state
fails closed. The lock command targets that bound locker.
The first admitted interaction wakes idle DRM capture immediately; continuous
input retains the configured frame-rate budget. Kernel connector stalls remain
a separate host condition and never trigger a silent capture-backend switch.
Disconnect, session/VT transition, service stop and attachment replacement also
release held input before the next owner is admitted.

## Physical Scanout Formats

The unprivileged DRM converter retains the producer's DMA-BUF descriptor.
For the qualified legacy Rockchip SDR layout only, it imports single-plane XR24
with modifier `0x0800000000000051` as canonical AB24 and labels the validated
linear result XB24. The existing pixel owner restores BGRx exactly once. This
does not alter the exported descriptor or introduce another capture backend.
Other drivers, modifiers, HDR and multiplane buffers keep their native format.
Failed imports retain their real errno; a successful but invalid output fails
with `ENOTSUP`. Converter-owned output remains owned by its context.
The [orange AFBC record](../operations/remote-desktop-orange-afbc-results.md)
owns producer-source, pixel and physical-host evidence for this narrow mapping.

# Boundaries

Synthetic encoder probes and browser preferences are capabilities, not hardware
latency certification. Physical latency and real desktop behavior require their
own observable evidence. The [validation contract](../operations/remote-desktop-validation.md)
and linked results own those claims. Shared capture, input and player behavior
belongs upstream; the host must not add a duplicate implementation.

# Evidence

- Published `floe-native-apps` `host_desktop_media.py`, `host_desktop_pipewire.py` and `host_desktop_portal.py`: capture, refinement admission, cursor metadata and bounded input.
- Published `floe-native-apps` `host_desktop_drm.py`, `hostdesktop/login_seat_linux.go`, `hostdesktop/login_service_linux.go` and `hostdesktop/login_media_linux.go`: separate DRM cursor capture, live logind/compositor checks, uinput authority ownership and bounded media attachment.
- Published `floe-native-apps` `host_desktop_player.mjs`, `host_desktop_encoder.py`, `native/host-desktop/nvenc.c`, `mpp.c` and `native_pixels.h`: player queues, shared-slot ownership and native encoders.
- Published `floe-native-apps` `native/host-desktop/drm/worker.c`, `scanout_format.h` and `host_desktop_drm_native_test.py`: bounded scanout normalization, conversion errors and descriptor cleanup.
- `internal/remotedesktop/socket_test.go`: transport preserves current-frame cursor presentation and attachment authority.
- `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs`: published-player cursor and input behavior.
