---
type: Acceptance Record
title: Current-desktop qualification results
description: Assess published macOS and X11 performance, functional-only Wayland validation and local delivery limits.
tags: [desktop, linux, macos, validation, performance]
timestamp: 2026-10-02T15:30:00Z
---
# Summary

The agreed host scope passes the tested [desktop contract](../architecture/remote-desktop.md).
Published v0.22.6 passes macOS and Linux X11 performance repetitions, office
interaction and ten-minute input/queue checks. The implementation was integrated
into local `main`. The user subsequently designated `udesk24` for functional
validation only; its [Wayland performance failures](remote-desktop-wayland-results.md)
are retained and do not block this delivery. Preserve the
[thresholds and measurement boundaries](remote-desktop-validation.md) and failed
measurements. Passing retries neither erase failures nor establish their causes.
No Redeven push, push gate or full integration gate is authorized.
Source integration does not substitute for real-host qualification or establish
release acceptance.
The [reconnect record](remote-desktop-recovery-results.md) separately qualifies
the published v0.22.7 sound fix, Mac physical hotplug, locked reconnect and
Wayland display recovery. These results do not claim passing Wayland performance
or hardware encoding.

# Contract

## Published Dependency And Conditions

Both product binaries use clean source `6caee6df1da1eabdd5d9f4670d6eedcb578de1a3`
and published `floe-native-apps` v0.22.6
(`dec4e3f48dba9445704b08cf2ff78c683c0c679a`). Go/Swift pins, official module
readback and release qualification passed. Builds use `GOWORK=off`, native
Floeterm and no overrides. Subsequent `76c08c4ce` changes only a filesystem-scope
test fixture to preserve main's new Computer access default.

Performance uses headless Chromium's actual authenticated product viewer. FPS
counts canvas draws; input latency spans DOM keydown, a changed host marker and
the player's post-render receipt. Physical keyboard scanning and display scanout
are excluded. Separate Electron checks exercise its real window and preload.
Chromium's `no-preference` does not certify hardware decoding. Whole-device
CPU/GPU counters are not process attribution. Mac input tests stop on fixture
foreground loss.

Apple Silicon uses VideoToolbox H.264 and authenticated task-loopback WebSockets.
`server` is Ubuntu 24.04/GNOME X11 with an RTX 4090 D/driver 550.90.07. Its glibc
CUDA library cannot load into the isolated musl stack, which selects x264.
System FFmpeg NVENC success does not qualify production GPU encoding. Product
WebSockets use an authenticated LAN SSH forward; ten pings had no loss and
4.285/4.832/5.279ms minimum/average/maximum RTT.

X11 1440p leases scale a 2560x1440 framebuffer to physical 3840x2160@59.94Hz
and restore 1920x1080@60Hz. Native 1440p is 30Hz; a task 59.95Hz mode was
rejected and removed. This is alternative scanout, not native 1440p60.

## Current Product Results

### macOS v0.22.6

Both matrices passed six cells: scrolling and window motion, each 60 seconds
repeated three times.

| Capture | Minimum FPS | Maximum interval P95 | Maximum refinement | Bandwidth |
| --- | --- | --- | --- | --- |
| 1920x1080 | 57.582 | 23ms | 329.5ms | 14.71-14.82Mbps |
| 2560x1440 | 57.657 | 24.7ms | 351.1ms | 26.21-26.33Mbps |

No decoder flush, recovery, protocol error or failed request occurred. Separate
100-input runs passed at P95 68.4ms/68.7ms. Chinese/emoji paste, pointer,
drag selection, scrolling, bidirectional clipboard, full screen, view-only and
takeover passed. The unlocked supplemental Electron run passed office flow,
shortcut handoff and media continuity.

Ten-minute interaction completed 600.5 seconds/637 physical-key protocol samples
at overall input P95 69.5ms. Decoder queue samples were zero. Audio delivered
30,278 blocks, at most two pending worklet handoffs and zero at completion.
No recovery or protocol error occurred. Per-minute P95 values up to 80.9ms remain
recorded; acceptance uses the complete run's P95.

Ten tone onsets after the production worklet mapped to the destination clock.
Spawn-to-estimated-output delay was 230.8-277.4ms without continuous growth.
This includes process startup, not calibrated acoustic latency. Client gain was
zero to prevent same-host feedback; physical listening remains unqualified.

An 800x120 original-pixel text region at 4608x2592 matched an independent
ScreenCaptureKit lossless reference byte-for-byte. The initial waiter sampled a
previous-generation 2560x1440 PNG at the new capture's coordinates, yielding an
empty crop. Requiring current-generation paint and matching snapshot dimensions
fixed the harness; production code was unchanged. Older mismatches without
equivalent snapshots remain unexplained.

### Linux X11 v0.22.6

The initial 1440p matrix passed all six cells with audio: minimum 55.952 FPS,
maximum interval P95 32.5ms, refinement 240.5ms and bandwidth 5.92-11.55Mbps.
Original-pixel reference equality and 100-input P95 67.8ms passed.

1080p scrolling passed three cells at 57.936-58.205 FPS, interval P95 <=26.7ms
and refinement <=218.1ms. The first window cell failed at 54.827 FPS; three
focused retries passed at 55.657/55.412/55.828 FPS with a narrow margin.
Input P95 was 64ms. Arrival was 54.9 FPS while decode P95 was 1ms, locating
loss before decoding without identifying its cause. Doubling acquisition from
about 115 to 224 reads/s improved changed/encoded FPS only from 56.0 to 56.5;
that higher-cost change was not adopted.

The moving-window callback used the covered parent frame clock (about 57.2
updates/s). Moving the callback to its own window increased source updates to
59.873/s and product draws to 57.669 FPS in a diagnostic; product code did not
change. Three corrected 60-second window repetitions passed at each resolution:
1080p 55.567/58.633/58.628 FPS, P95 <=29.1ms, refinement <=214.2ms; 1440p
57.129/57.275/57.311 FPS, P95 <=28.7ms, refinement <=242.2ms. Source updates
were 59.908-59.998/s. Retain the original failure and lower first-run margin.

Ten-minute interaction completed 600.1 seconds/645 inputs at overall P95
61.3ms, zero sampled decode depth, 30,232 audio blocks, at most two pending
handoffs and zero at completion. A second 600.5-second/646-input run had P95
61.7ms and ten decoded-to-estimated-destination onsets at 39.7-74.0ms, without
continuous growth. It had at most one pending handoff and zero at completion.
Neither run had a decoder recovery or protocol error. Spawn-to-output estimates
of 291.4-386.8ms include SSH/player startup; neither method measures acoustics.
Six unmuted tones advanced the destination clock; human listening is pending.

Drag selection, scrolling, application switching and pixel references passed.
Runtime restart returned 404 for old sessions/tickets, required fresh paint,
preserved fixture text and replayed no input. Linux-target race checks passed
nine desktop and three shared application-transport tests.

## Release And Lifecycle Evidence

v0.22.6 source CI, CodeQL, both native architectures, private applications,
host-desktop media and Swift checks passed. The amd64 private-application job
initially failed during host-service initialization, then passed on the same
immutable tag's rerun; its root cause remains unestablished.

Linux XCB avoids per-frame server grabs and caches cursor shapes. Its candidate
passed twelve 60-second cells (minimum 55.416 FPS, maximum P95 32.6ms).
Authenticated Xvfb checks passed pixels, resource lifetime, protocol isolation,
cursor, input and recovery. macOS uses a bounded latest-sample mailbox to
separate comparison from encoding; callback wait P95 fell from about 8.6ms to
0.02ms. Cancellation and concurrent application/desktop capture passed.
Both platforms have regression coverage for last-display-return defects.

During the first user-confirmed Mac unplug/reconnect, the product reported
`generation 1 active -> generation 2 connecting -> generation 2 active` with
the same stable display catalog. The first harness required catalog changes
and missed the final paint receipt. A later physical run observed
`capture_unavailable` and `LOCKED`, then reached its ten-minute deadline before
client recovery. Read-only probe subsequently returned `ready` and the original
display. These failures do not certify client hotplug recovery. The revised
harness identifies each socket and generation and preserves client state on
failure. The subsequent user-confirmed v0.22.7 physical run passes socket and
generation recovery with fresh paint before input; the
[reconnect record](remote-desktop-recovery-results.md) owns that result.

Published checks pass Go race/vet for desktop, host applications and appserver,
32 Swift helper tests, both browser variants, Electron 41.10.5, module sums,
generated appearance, affected dependency boundaries and localization. Electron
covers ten narrow locales, dialog keyboard, authority, composition, clipboard,
display selection and reconnect. Final focused desktop/appserver race tests
were repeated against the published dependency and passed.

# Boundaries

## Retained Failures And Limits

Earlier Mac results retain 38.323 FPS, 33.3ms interval P95 and 82.2ms input P95
failures, plus `KEYFRAME_REQUIRED` despite verified foreground. Shared build
load was observed; causality is unproven. X11 v0.22.5 scrolling failed at
44.325 FPS with loss located before decoding. A disappearing seatless SSH-login
race was fixed in v0.22.5. Historical reference failures remain unattributed.

v0.22.5 lock/local-unlock passed on both hosts: media/input stopped and fresh
paint gated recovery. Mac v0.22.6 initial-lock rejection passed with zero frames,
draws and input. Its first supplemental run stopped before input on a locked
host; the normally unlocked retry passed office and Runtime restart, preserving
text and invalidating old tickets. Neither host is qualified for remote unlock.

## Local Delivery And Qualification Limits

The implementation and subsequent records were fast-forwarded into local
`main` through `2945183a90e46f382410fa7ae23d4b35d8b63998`, preserving existing
unpublished commits. The original feature worktrees/branches were removed.
Redeven was not pushed and neither excluded gate ran. Follow-up implementation
source `69cd04988970c8b456f751838523e61625531d3c` consumes published v0.22.7.
Its product checks are owned by the reconnect and Wayland records. Delivery uses
another fast-forward preserving every prior local-main commit; private
`final-local-delivery.json` records the final documentation tip, clean-main
readback, excluded gates and task-only cleanup. Local main may remain ahead of
origin by explicit user instruction. Integration preserves the user's
functional-only Wayland scope and does not relabel its failed FPS results.

- The published v0.22.7 Mac physical hotplug and locked reconnect checks pass; see the reconnect record for their authority and local-unlock boundaries.
- Linux-to-Mac physical output was subsequently confirmed in the [Wayland record](remote-desktop-wayland-results.md); the earlier same-host Mac and X11 clock measurements retain their limits.
- `udesk24` passes the tested Wayland office and display-recovery flow. Its performance is outside this delivery's acceptance scope by explicit user instruction; no 55 FPS Wayland claim is made.
- Any broader release claim requires its own host qualification; source integration alone is not release acceptance.

# Evidence

Detailed identities, raw results and failures remain in private
`task-evidence/remote-desktop-20261001/product-progress.json`. Screen and
clipboard contents are not committed. Representative records:

- `published-v0226-*-build-metadata.log` and `native-v0226-qualification-watch.log`: provenance and release qualification.
- `product-performance-macos-v0226-1080.json` and `product-performance-macos-v0226-1440-ready.json`: Mac matrices.
- `product-macos-v0226-stability-summary.json` and `product-linux-v0226-output-latency-summary.json`: complete stability and audio estimates.
- `product-performance-linux-v0226-1080-moving-clock.json` and `product-performance-linux-v0226-1440-moving-clock.json`: corrected motion repetitions.
- `product-macos-media-1440-macos-v0226-original-pixel-generation.json`: corrected original-pixel reference.
- `product-macos-restart-macos-v0226-office-restart-unlocked.json`: unlocked office and Runtime restart.
- `lifecycle-*-lock*.json` and `macos-takeover-published-app-desktop-normalized-display.json`: lock and control ownership.
- `hotplug-macos-v0226-hotplug.json` and `hotplug-macos-v0226-final-hotplug.json`: retained physical actions and harness limits.
- `final-focused-desktop.log`: current published-dependency session/API race tests.
