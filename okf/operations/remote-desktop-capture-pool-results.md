---
type: Acceptance Record
title: Wayland capture pool optimization evidence
tags: [desktop, linux, wayland, validation, latency]
lifecycle: active_evidence
reviewed_at: "2026-10-22"
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
Upstream commit `ec0d9cc8e64fd3e9e2020da017bec57a56ce0f94` replaces full-frame Python allocation and copying with a bounded Gst buffer pool.

These results certify the tested host-desktop component, not the whole optional application distribution.

## Correctness
Thirty-six focused Python tests pass, including existing damage, sequence, mapping and cursor rules.

- BGRA, BGRx, RGBA and RGBx; packed, padded and non-aligned source rows. - Separate cursor updates and embedded composition without corrupting retained clean pixels. - Bounded pool capacity, final-frame recovery, parent lease retention and interruptible shutdown. - Retained frame bytes after pool deactivation and idempotent capture close.

These checks retain the cursor, mode, reconnect and permission contracts; neither a debug workspace nor sibling source overlay is used.

## Performance Of The Final Implementation
The same udesk24 VM ran alternating old/new/old/new tests at 2560 by 1440 with software x264. The real private PipeWire producer emits a moving rectangle through MemFd at 60 FPS and never reads the user desktop.

| Run | Encoded FPS | Capture median | Capture entry to encoded output, median / P95 |
| --- | ---: | ---: | ---: |
| Old A1 | 48.06 | 19.34 ms | 28.61 / 49.04 ms |
| New B1 | 59.90 | 2.79 ms | 11.65 / 13.01 ms |
| Old A2 | 46.86 | 19.96 ms | 29.94 / 52.37 ms |
| New B2 | 59.90 | 2.64 ms | 8.68 / 9.99 ms |

| Run | Paint confirmations per second | Capture entry to returned paint ACK, median / P95 |
| --- | ---: | ---: |
| Old A1 | 32.78 | 68.89 / 140.23 ms |
| New B1 | 60.07 | 24.19 / 25.36 ms |
| Old A2 | 26.19 | 99.17 / 144.48 ms |
| New B2 | 60.01 | 14.89 / 17.29 ms |

# Boundaries

The browser fixture uses a synthetic source, headless Chromium and a qualification SSH/WebSocket bridge. The original live GNOME workload was substantially slower than the controlled producer, so its improvement cannot be inferred directly from the tables.

Source integration alone does not replace a running executable or authorize a fresh screen-sharing session.

# Evidence

- Published `floe-native-apps` `host_desktop_pixels.py`, `host_desktop_pipewire.py` and `host_desktop_media.py`: authoritative pixel ownership and encoder lease implementation.

- Published `qualification/host_desktop_pixels.py` and `qualification/host_desktop_pipewire.py`: installed native lifetime, format, cursor and memory-path checks.

- [Release qualification 37320233514](https://github.com/floegence/floe-native-apps/actions/runs/37320233514): both native host-desktop architectures, macOS library and distribution status.
