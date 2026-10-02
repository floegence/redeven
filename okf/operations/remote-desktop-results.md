---
type: Acceptance Record
title: Current-desktop qualification results
description: Assess published remote desktop measurements, retained failures and outstanding real-host qualification.
tags: [desktop, linux, macos, validation, performance]
timestamp: 2026-10-02T10:00:00Z
---
# Summary

Acceptance remains incomplete for the [desktop contract](../architecture/remote-desktop.md).
Published v0.22.6 passes macOS and Linux X11 performance repetitions and ten-minute
input/queue checks. Linux motion required a fixture clock correction; its initial
failure and narrow first-run margin remain recorded. Physical-host checks and
Wayland performance conditions still prevent final acceptance and integration.
Preserve the [thresholds](remote-desktop-validation.md) and failed measurements;
a passing retry neither erases a failure nor establishes its cause. Integrate
only after acceptance. No Redeven push, push gate or full integration gate is authorized.

# Published Dependency And Conditions

Both product binaries use source `6caee6df1da1eabdd5d9f4670d6eedcb578de1a3`
and published `floe-native-apps` v0.22.6
(`dec4e3f48dba9445704b08cf2ff78c683c0c679a`). Go/Swift pins, official module
readback and release qualification passed. Builds use `GOWORK=off`, native
Floeterm and no overrides. Subsequent `76c08c4ce` changes only a filesystem-scope
test fixture to preserve main's new Computer access default.

Apple Silicon uses VideoToolbox H.264 and authenticated task-loopback WebSockets.
Chromium's `no-preference` does not prove hardware decoding. Shared CPU/GPU
counters are not process attribution. Tests stop on fixture foreground loss.
Performance and stability measurements use headless Chromium with the actual
authenticated product viewer. FPS counts canvas draws; input latency spans DOM
keydown through a changed host marker to the player's post-render receipt. These
measurements exclude physical keyboard scanning and display scanout. Separate
Electron interaction checks exercise its real window and preload.

`server` is Ubuntu 24.04/GNOME X11 with an RTX 4090 D/driver 550.90.07. Its glibc
CUDA library cannot load into the isolated musl stack, which selects software
x264. System FFmpeg NVENC success does not qualify production GPU encoding.
Product WebSockets use an authenticated LAN SSH forward. The current ten-ping
readback has no loss and 4.285/4.832/5.279ms minimum/average/maximum RTT.

1440p leases scale a 2560x1440 framebuffer to physical 3840x2160@59.94Hz and
restore 1920x1080@60Hz. Native 1440p is 30Hz; a task 59.95Hz mode was rejected
and removed without changing driver policy. Alternative scanout is labeled.

# Current Product Results

## macOS v0.22.6

Both matrices passed all six cells: scrolling and window motion, each 60 seconds
repeated three times. Statistics are actual client canvas draws.

| Capture | Minimum FPS | Maximum interval P95 | Maximum refinement | Bandwidth |
| --- | --- | --- | --- | --- |
| 1920x1080 | 57.582 | 23ms | 329.5ms | 14.71-14.82Mbps |
| 2560x1440 | 57.657 | 24.7ms | 351.1ms | 26.21-26.33Mbps |

There were no decoder flushes, recoveries, protocol errors or failed requests.
Separate 100-input runs passed at P95 68.4ms/68.7ms for 1080p/1440p. Chinese and
emoji paste, pointer, drag selection, scrolling, bidirectional clipboard, full
screen, view-only and takeover also passed. The unlocked supplemental Electron
run also passed the current-version office flow, shortcut handoff and media
continuity.

Ten-minute interaction completed 600.5 seconds/637 physical-key protocol samples at
overall input-to-post-render-receipt P95 69.5ms. Decoder queue samples were zero.
Audio delivered 30,278 blocks, with at most two pending worklet handoffs and zero
at completion. No decoder recovery or protocol error occurred. Per-minute input
P95 values up to 80.9ms remain in the evidence; the acceptance statistic is the
complete run's P95.

Ten tone onsets were observed after the production worklet and mapped to the
destination clock. Spawn-to-estimated-output delay ranged from 230.8 to 277.4ms
without continuous growth. This includes process startup, not calibrated acoustic
latency. Client gain was zero to prevent same-host feedback. Physical listening
remains unqualified.

An 800x120 original-pixel text region at 4608x2592 capture dimensions matched an
independent ScreenCaptureKit lossless reference byte-for-byte. The initial
stability waiter instead sampled a previous-generation 2560x1440 PNG at the new
capture's coordinates, producing an empty out-of-bounds crop. The later current
frame matched. Requiring a newer generation's paint receipt and matching snapshot
dimensions fixed the harness; production code was unchanged. This does not explain
older mismatches without equivalent snapshots.

## Linux v0.22.6

The 1440p matrix passed all six 60-second cells with system audio enabled:
minimum 55.952 FPS, maximum interval P95 32.5ms, refinement 240.5ms and bandwidth
5.92-11.55Mbps. Original-pixel reference equality and 100-input P95 67.8ms passed.
The display lease restored 1920x1080@60Hz.

All three 1080p scroll cells passed at 57.936-58.205 FPS, interval P95 up to
26.7ms and refinement 218.1ms. The first window cell failed at 54.827 FPS,
30.4ms interval P95 and 228.8ms refinement. Three focused window repeats then
passed at 55.657/55.412/55.828 FPS, interval P95 up to 30.5ms and refinement
232.4ms. The initial failure is retained and the passing margin was narrow.
Source fixture updates were about 57.2 FPS in both the failed cell and first
repeat. Initial encoded arrival was 54.9 FPS and decode P95 1ms, locating loss
before decoding without identifying its cause. No decoder recovery was observed.
The separate 100-input 1080p P95 was 64ms. A 30-second instrumented comparison
observed 56.0 changed/encoded FPS, one coalesced frame and zero credit waits.
Doubling acquisition to about 224 reads/s yielded only 56.5 changed/encoded FPS.
The higher-cost sampling change was not adopted. The motion fixture attached
its callback to the background parent window rather than the moving window.
Changing that owner increased source updates from about 57.2 to 59.873 FPS and
product paints to 57.669 FPS in a 30-second comparison. Product code was unchanged;
three corrected 1080p 60-second repetitions pass at 55.567/58.633/58.628 FPS.
Source updates were 59.908-59.998 FPS. The lower first-run result remains visible;
matching corrected 1440p repetitions pass at 57.129/57.275/57.311 FPS, interval
P95 up to 28.7ms and refinement 242.2ms. Both resolutions used three 60-second
window runs with the moving window owning its clock. Earlier scroll results remain
valid because their callback already belonged to the scrolling window.

Ten-minute interaction completed 600.1 seconds/645 inputs at overall P95 61.3ms,
with zero sampled decode depth, 30,232 audio blocks and at most two pending audio
handoffs, ending at zero. No decoder recovery or protocol error occurred.
Spawn-to-estimated-output audio latency was 291.4-386.8ms, including SSH/player
startup. A second 600.5-second run with 646 inputs/P95 61.7ms measured ten decoded
audio onsets directly: decoded-to-estimated-destination delay was 39.7-74.0ms,
without continuous growth. It had at most one pending audio handoff, zero at end,
and no decoder recovery. This excludes upstream startup jitter but still is not
an acoustic measurement. Six unmuted tones advanced the destination clock; human
listening remains pending.
Drag selection, scroll, application switching and pixel references pass. Runtime
restart returned 404 for old sessions/tickets, required fresh paint, preserved
fixture text and replayed no input. Linux-target race checks pass nine desktop
and three shared application-transport tests.

# Capture Release And Regression

v0.22.6 source CI, CodeQL, both native architectures, private applications,
host-desktop media and macOS Swift checks passed. The amd64 private-application
job initially failed during host-service initialization, then passed on the same
immutable tag's rerun. Its root cause is not established.

Linux XCB acquisition avoids per-frame server grabs and caches cursor shapes.
Its native candidate passed twelve 60-second cells, with minimum 55.416 FPS and
maximum interval P95 32.6ms. Isolated authenticated Xvfb checks passed pixel
identity, resource lifetime, protocol isolation, cursor, input and recovery.

macOS separates pixel comparison from encoding with a bounded latest-sample
mailbox. Callback-queue wait P95 fell from about 8.6ms to 0.02ms; cancellation
and concurrent owned application/desktop capture passed. Both platforms have
red/green coverage for last-display-return defects. Physical hotplug is pending.

Current published checks pass Go race/vet for desktop, host applications and
appserver, 32 Swift helper tests, both browser viewer variants, Electron 41.10.5
viewer/preload interaction, module sums, generated appearance, affected dependency
boundaries and localization. Electron covers all ten narrow locales, dialog
keyboard, input authority, composition, clipboard, display selection and reconnect.

# Retained Earlier Evidence And Limits

Earlier macOS runs retain 38.323 FPS, 33.3ms interval P95 and 82.2ms input P95
failures; one native run reported `KEYFRAME_REQUIRED` despite verified foreground.
Shared build load was observed, but causal attribution remains unproven. Linux
v0.22.5 scrolling failed at 44.325 FPS; capture diagnostics located loss before
decoding. A disappearing seatless SSH-login race was fixed in v0.22.5. Historical
reference failures without PNG snapshots remain unattributed. All records survive.

v0.22.5 lock/resume passed on both hosts: product confirmation locked the host,
media/input stopped, and local unlock resumed only after fresh paint. Neither
host is qualified for remote unlock. v0.22.6 initial-lock rejection on macOS
also passed with zero frames/draws and disabled input. The first v0.22.6
supplemental run was stopped before input because the host was locked; after the
host was normally unlocked, the replacement run passed office interaction and
Runtime restart: old sessions and tickets returned 404, fresh paint was required,
the fixture text was preserved, and no input was replayed. Physical remote unlock
remains unqualified.

`udesk24` GNOME 46 Wayland passed authorization, input, clipboard, audio handoff
and grant restoration. Dynamic 1080p was about 37.6 FPS, capture alone 38-41 FPS.
It remains KVM/`bochs-drm` with no render device or 2560x1440 mode. X11 results
neither repair this capture limit nor qualify Wayland performance. No system
security, driver or hardware configuration was changed.

# Remaining Qualification

- Verify physical display hotplug and affected lifecycle recovery.
- Confirm physical audio output; retain destination-clock measurement limits.
- Qualify an accelerated 1440p Wayland desktop; udesk24 remains blocked by capture and display limits.
- Regenerate OKF, run affected checks and integrate locally only after acceptance.

# Evidence

Detailed identities, measurements and retained failures remain outside the
repository in `task-evidence/remote-desktop-20261001/product-progress.json`.
Screen/clipboard content is not committed. Representative records:

- `published-v0226-*-build-metadata.log`: official dependency/build provenance.
- `native-v0226-qualification-watch.log`: release qualification and rerun history.
- `product-performance-macos-v0226-1080.json` and `product-performance-macos-v0226-1440-ready.json`: complete product matrices.
- `product-macos-v0226-stability-summary.json`: full-run, per-minute and audio-output statistics.
- `product-linux-v0226-stability-summary.json` and `product-linux-v0226-output-latency-summary.json`: complete Linux input/queue and decoded-to-output observations.
- `product-failure-macos-v0226-stability.json` and `product-macos-media-1440-macos-v0226-original-pixel-generation.json`: failed waiter and corrected reference.
- `product-performance-*-v0225-*.json`: earlier published performance failures.
- `product-audiovisual-stability-1080-linux-v0225-stability-native-runtime.json`: earlier Linux stability.
- `lifecycle-*-lock*.json` and `product-*-restart-*-v0225-*.json`: lock/local-unlock and restart.
- `macos-takeover-published-app-desktop-normalized-display.json`: shared control ownership.
- `server-xcb-candidate-matrix-summary.json`: native Linux matrix.
- `linux-capture-stage-comparisons.json` and `linux-v0226-sampling-comparison.json`: acquisition diagnostics and rejected approaches.
- `product-performance-linux-v0226-1080-moving-clock.json` and `product-performance-linux-v0226-1440-moving-clock.json`: corrected motion-clock repetitions.
- `product-macos-restart-macos-v0226-office-restart-unlocked.json` and `product-shortcut-macos-v0226-office-restart-unlocked.json`: unlocked macOS Runtime restart and shortcut/media continuity.
