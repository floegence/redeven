---
type: Acceptance Record
title: Wayland capture pool optimization evidence
description: Verify bounded pixel reuse and measure the released capture implementation on the udesk24 VM.
tags: [desktop, linux, wayland, validation, latency]
timestamp: 2026-10-05T14:00:00Z
---
# Summary

This record owns acceptance evidence for the capture pool implementation in
`floe-native-apps` v0.22.14. The [media contract](../architecture/remote-desktop-media.md)
owns pixel lifetime, cursor presentation and scheduling. Native copies must
preserve supported formats, clean comparison pixels and the final changed frame;
shutdown must interrupt exhausted-pool waits. Installed tests and controlled
latency measurements cannot certify physical input response or the user's
running GNOME session. Weak-VM performance remains observational.

# Contract

## Implementation And Distribution

Upstream commit `ec0d9cc8e64fd3e9e2020da017bec57a56ce0f94` replaces full-frame
Python allocation and copying with a bounded Gst buffer pool. Native memmove and
pixman conversion release the interpreter lock. Four buffers serve separate
cursor capture; six allow embedded composition to retain a clean baseline.
Shallow encoder views retain the parent's pool lease. Pool exhaustion waits on
the capture thread, preserving the producer's last changed frame until capacity
returns. Closing capture flushes the pool before joining its callback thread.
No timer-only dropping policy, new codec, GPU requirement or user setting is added.

The immutable module is verified through the Go proxy and checksum database.
Its amd64 host-desktop component digest is
`47b3bb68748223ef79d3cfd5bf4852bf048e463bb6858854eb1ec031272a5e77`.
Redeven pins the same published version in its Go and Swift manifests. Historical
v0.22.13 installation identities remain verifiable during component updates;
existing installed files are not patched in place.

Native host-desktop release qualification passes on amd64 and arm64, including
the new pool checks and existing X11, PipeWire and input checks. Source checks,
dependency vulnerability checks and the macOS native library job also pass.
The complete release gate fails because the unchanged general native and private
desktop recipes report `download_failed` on both architectures, again on retry.
An independent URL check confirms that their pinned
`python3-pycache-pyc0-3.12.14-r0.apk` returns HTTP 404 for both architectures;
the host-desktop recipe does not include this archive.
The immutable Go module tag is available, but no GitHub release is published
while this distribution gate remains failed. These results certify the tested
host-desktop component, not the whole optional application distribution.

## Correctness

Thirty-six focused Python tests pass, including existing damage, sequence,
mapping and cursor rules. Native installed-library qualification covers:

- BGRA, BGRx, RGBA and RGBx; packed, padded and non-aligned source rows.
- Separate cursor updates and embedded composition without corrupting retained clean pixels.
- Bounded pool capacity, final-frame recovery, parent lease retention and interruptible shutdown.
- Retained frame bytes after pool deactivation and idempotent capture close.

The fresh task-owned installation on udesk24 also passes real private PipeWire
control/view/control transitions with both library-mapped memory and legacy
producer-owned MemFd without MAPPABLE. Each control phase yields one cursor-free
frame and 101 shape updates; view yields 101 composited frames. No capture error
or surviving mapping is observed. The installed self-check now verifies pooled
native channel conversion before activating a component.

Consumer checks pass against the published module with `GOWORK=off`: remote
desktop race tests on macOS, the Linux remote desktop package on udesk24,
component-update and HTTP authorization tests, and the Wayland browser viewer
fixture. The Swift host helper passes 32 tests with the exact published pin.
These checks retain the cursor, mode, reconnect and permission contracts;
neither a debug workspace nor sibling source overlay is used.

## Performance Of The Final Implementation

The same udesk24 VM ran alternating old/new/old/new tests at 2560 by 1440 with
software x264. The old installation is v0.22.13; the candidate is the complete
v0.22.14 component, without source overlays. The real private PipeWire producer
emits a moving rectangle through MemFd at 60 FPS and never reads the user desktop.

| Run | Encoded FPS | Capture median | Capture entry to encoded output, median / P95 |
| --- | ---: | ---: | ---: |
| Old A1 | 48.06 | 19.34 ms | 28.61 / 49.04 ms |
| New B1 | 59.90 | 2.79 ms | 11.65 / 13.01 ms |
| Old A2 | 46.86 | 19.96 ms | 29.94 / 52.37 ms |
| New B2 | 59.90 | 2.64 ms | 8.68 / 9.99 ms |

Minor page faults fall from approximately 362,000–371,000 per second to 11,441;
helper CPU falls from 190–195% to 115–119% while encoding more frames. A separate
GLib callback probe's P95 falls from 8.85–9.80 ms to approximately 0.08 ms. This
probe measures dispatch responsiveness, not actual pointer delivery.

A second alternating test sends synthetic changed frames through actual capture,
encoding, SSH/WebSocket transport and the published player in local headless
Chromium. Browser paint acknowledgements return to the native frame-credit owner.

| Run | Paint confirmations per second | Capture entry to returned paint ACK, median / P95 |
| --- | ---: | ---: |
| Old A1 | 32.78 | 68.89 / 140.23 ms |
| New B1 | 60.07 | 24.19 / 25.36 ms |
| Old A2 | 26.19 | 99.17 / 144.48 ms |
| New B2 | 60.01 | 14.89 / 17.29 ms |

Both endpoints of the ACK interval use the remote monotonic clock. All eight
performance runs report no capture, media or decoder errors. Run-to-run scheduling
variation remains visible; results support the mechanism, not a fixed user FPS.

# Boundaries

The browser fixture uses a synthetic source, headless Chromium and a qualification
SSH/WebSocket bridge. A RAF/task paint receipt is not physical monitor scanout;
these measurements are not mouse-input-to-photon latency. The original live
GNOME workload was substantially slower than the controlled producer, so its
improvement cannot be inferred directly from the tables.

A fresh task-owned GNOME portal request waited for normal system consent and
timed out after 180 seconds with `CONSENT_OR_RUN_TIMEOUT`. No saved user grant
was copied and no actual desktop comparison ran. The tested optimization is
implemented, but improvement in the user's existing GNOME session remains
unmeasured.

The user Runtime and its installed active component require the normal update
path before this code affects existing sessions. Source integration alone does
not replace a running executable or authorize a fresh screen-sharing session.

# Evidence

- Published `floe-native-apps` `host_desktop_pixels.py`, `host_desktop_pipewire.py` and `host_desktop_media.py`: authoritative pixel ownership and encoder lease implementation.
- Published `qualification/host_desktop_pixels.py` and `qualification/host_desktop_pipewire.py`: installed native lifetime, format, cursor and memory-path checks.
- [Release qualification 37320233514](https://github.com/floegence/floe-native-apps/actions/runs/37320233514): both native host-desktop architectures, macOS library and distribution status.
- Private `task-evidence/wayland-pool-delivery-20261005/`: `published-module.json`, `final-install.log`, `native-final.jsonl`, `private-final.jsonl`, `browser-results.json` and reproducible harnesses.
- Private `task-evidence/udesk24-optimization-20261005/DECISION.md`: measured alternatives and the prototype's narrower support boundary.
