---
type: Acceptance Record
title: Wayland cursor and scheduling optimization evidence
description: Assess separate cursor ownership, ordered nonblocking input and damage-aware capture without confusing synthetic results with desktop latency.
tags: [desktop, linux, wayland, validation, latency]
timestamp: 2026-10-04T18:10:00Z
---
# Summary

This record owns evidence for the Wayland cursor and scheduling changes in
`floe-native-apps` v0.22.12. The [session contract](../architecture/remote-desktop.md)
owns authorization and generation boundaries; the
[viewer contract](../architecture/remote-desktop-viewer.md) owns pointer presentation.
A separate-cursor frame must contain cursor-free pixels, while view-only capture
retains the host pointer. Input replies must not block capture or authority
callbacks, and damage information cannot hide changes after a sequence gap.
Distribution and browser evidence does not establish actual GNOME desktop latency.
The user explicitly waived performance thresholds for the weak `udesk24` VM on
2026-10-05. Functional regressions remain required; hardware availability is not
performance evidence.

# Contract

The GNOME portal advertises cursor metadata, but the preceding native component
requested embedded capture while the viewer showed a local pointer. The new
component selects metadata only when advertised, obtains pixels and cursor from
one public PipeWire/SPA stream, and declares presentation on each frame. The
player updates presentation only after drawing a current-generation frame.
Embedded-only capture hides the local pointer. Missing cursor metadata in a
negotiated metadata stream fails explicitly; it cannot prove embedded pixels.

Portal input uses one ordered D-Bus connection with at most 64 outstanding calls.
Input admission does not certify compositor or application delivery. Delivery
failure or an unresponsive input window closes the authorized OS session and
requires reconnect, preventing uncertain held input from retaining authority.
Key/button releases remain ordered before session closure.

SPA VideoDamage can skip copies for empty damage and compare changed regions.
This requires a complete retained baseline and contiguous header sequences.
Missing damage/header metadata, corruption and discontinuity force full-frame
inspection. Cursor-only buffers cannot restore a pixel baseline lost in a sequence
gap; only a complete inspected buffer can make damage trustworthy again. Changed pixels are copied before their PipeWire buffer is returned.
Static PNG refinement waits for both input and pixels to settle, and retires a
candidate if activity remains unsettled at admission. Already admitted binary packets
and H.264 dependencies remain ordered.

The [media contract](../architecture/remote-desktop-media.md) owns these scheduling
invariants. DMA-BUF encoder zero-copy, libei/EIS and network congestion adaptation are not
implemented. The published hardware encoder and decoder-preference optimizations
remain available according to actual platform capabilities; this change cannot
establish that a browser selected a particular physical GPU.

# Verification

## Isolated Linux Native Paths

The private PipeWire fixture sends synthetic BGRA pixels, header sequences,
VideoDamage and animated cursor metadata to the production client. A separate
daemon and socket isolate it from the logged-in desktop. Control/view/control
reuses the original connection descriptor while rebuilding each native stream.
The `udesk24` debug run produced one control video frame with 101 shape updates,
101 composited view frames with zero separate shapes, then one control frame
with 101 shapes again. All three runs had no capture errors. Control pixels
matched the complete cursor-free reference; view pixels contained the composited cursor.

A private synthetic D-Bus service withholds replies until all seven input and
release calls arrive. The installed Gio client delivered every event in order,
with zero pending replies at completion. This proves nonblocking input submission
and release ordering; it injects no OS input. Focused tests also cover asynchronous
failure, window saturation, corrupted buffers and invalid metadata bounds.

A synthetic 1920x1080 static-buffer comparison on `udesk24` measured 120 buffers
at 6.3497 ms/buffer before damage handling and 0.0057 ms/buffer afterward. Both
emitted only one video frame. This measures the processing avoided by trusted
empty damage; it is not capture-to-paint, network, dragging or physical latency.
There is no performance pass/fail threshold for this observation.

## Product And Distribution

The immutable v0.22.12 tag resolves through the Go proxy and checksum database to
upstream commit `ba8ecda3294a732c25a4829734896139f6df7ad8`. Fresh installed
host-desktop qualification passed on amd64 and arm64, including private PipeWire
and D-Bus fixtures. Browser checks with the published module passed for separate
Wayland/X11 and embedded macOS/Wayland cursor modes, control/view
switches, fresh-generation paint, reconnect, fullscreen and local chrome.
The isolated Electron 41.10.5 viewer also passes the embedded macOS path with
real native window fullscreen and toolbar behavior. Embedded and unlabelled frames never display a second local pointer. These are
product fixtures, not physical-desktop certification.

Focused Redeven Go checks preserve cursor metadata across the product socket and
cover desktop session/attachment authority. The macOS helper's 32 Swift tests pass
with the exact published package. Source checks, CodeQL and dependency scanning
pass. The preceding v0.22.11 candidate had two general native amd64 attempts stop during
component download with `download_failed`. All 183 original archives subsequently
passed independent size/hash verification. A later candidate fixes a deterministic
cursor-only sequence-gap regression; tags and their failure evidence stay immutable.
The first v0.22.12 general native attempt also hit download failures on both
architectures before graphical checks. Its second arm64 attempt failed the GNOME
editor's final saved-byte assertion at density 1: the file retained the preceding
successful save, while text-commit receipts had no error. The density-2 case passed
in the same job. The Xpra input implementation and GNOME fixture were unchanged;
this trace does not determine whether input processing or asynchronous save
admission caused the missing final file update. The unchanged input check passed on attempt 3. The failed artifact remains part
of the evidence; its unresolved intermittency is not waived as a weak-VM
performance result.

The complete [v0.22.12 Release gate](https://github.com/floegence/floe-native-apps/actions/runs/37226216285)
passed on attempt 3, including native amd64/arm64, private desktop, macOS,
source and vulnerability jobs. The [immutable release](https://github.com/floegence/floe-native-apps/releases/tag/v0.22.12)
retains these qualification limits. Redeven consumes its published Go/Swift
artifacts; local integration does not publish or restart the product Runtime.

# Boundaries

A fresh GNOME sharing request timed out with `HOST_CONSENT_TIMEOUT`. No user
restore grant was copied or reused. Real GNOME sharing and end-to-end latency
therefore remain unverified for this release. The existing user Runtime was not
restarted or replaced; integrated source does not update that running process.
Historical real-desktop measurements remain in the
[Wayland results](remote-desktop-wayland-results.md) and must not be relabelled
as evidence for this candidate.

# Evidence

Private task evidence lives in `task-evidence/desktop-cursor-ownership-20261005/`:

- `pipewire-qualification.log` and `portal-input-qualification.log`: isolated installed-library paths, transitions and ordered releases.
- `damage-benchmark.json` and `benchmark-damage.py`: synthetic static-buffer observation with retained baseline code.
- `upstream-main-push-final.log` and `upstream-qualification-status.json`: exact source and release qualification identity.
- `v0.22.12-arm64-attempt2-diagnosis.json` and `v0.22.12-arm64-attempt2/`: retained GNOME save failure, document bytes and input-phase trace.
- `published-module-v0.22.12.json`, `v0.22.12-native-amd64/` and `v0.22.12-native-arm64/`: public module integrity and fresh installed host-desktop checks.
- `published-v0.22.12-*.log`, `redeven-v0.22.12-go.log` and `redeven-v0.22.12-swift.log`: product cursor, session and native-helper checks.
- `portal-probe.log`: retained GNOME consent timeout, without screen pixels or credentials.
- Upstream `qualification/host_desktop_pipewire.py`, `qualification/host_desktop_pipewire_source.c` and `qualification/host_desktop_portal_input.py`: reproducible native release fixtures.
- `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs`: published-player browser contract checks.
