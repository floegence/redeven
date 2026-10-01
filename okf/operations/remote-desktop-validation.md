---
type: Validation Guide
title: Current-desktop acceptance and performance evidence
description: Distinguish remote desktop contract checks, real office behavior, failed performance thresholds and remaining qualification.
tags: [desktop, linux, macos, validation, performance]
timestamp: 2026-10-01T18:20:00Z
---
# Summary

This is the acceptance record for the [desktop contract](../architecture/remote-desktop.md).
Acceptance remains incomplete. Preserve failures and thresholds; a connected
picture does not certify performance. Formal checks consume published dependencies
with `GOWORK=off`. Resolve failed real-environment checks before integration;
synthetic media cannot replace them.

# Contract

At both 1920×1080 and 2560×1440, measure scrolling and task-owned window motion
for at least 60 seconds, three times each, on a documented low-latency connection.
Each run requires painted FPS ≥55, frame interval P95 ≤33ms and input-to-visible
P95 ≤80ms. Native admission and packet arrival are not visible response.

Refinement must finish within 500ms and match a lossless text reference at the
same dimensions. Native pixels preserve coordinates. Ten-minute interaction
requires bounded queues, released keys and no accumulated audiovisual delay.
Record encoder, decoder preference, CPU/GPU attribution, bandwidth and failures;
4K does not substitute for either required resolution.

The host user completes OS authorization. Fixtures control only their own
applications and stop input on foreground loss. Display leases restore the
original mode; cleanup preserves user applications and unsaved work. Lock refusal
is paused sharing, never successful remote unlocking. Credentials and raw captures
remain outside the repository and audit payloads.

# Recorded evidence, 2026-10-01

## Current dependency

Redeven now pins the published `floe-native-apps` v0.22.4 Go module and Swift
package at `32e7efbce4d3ba9581f7606204eb4768630acc84`. Source checks and the
upstream Release gate passed; module proxy and checksum-database readback matched.
This ships the candidate playback and explicit macOS paste contract below.
Published-product requalification remains required; earlier results retain their
original dependency versions and measurement boundaries.

## Linux product behavior

`server` runs Ubuntu 24.04 GNOME X11 with RTX 4090 D, driver 550.90.07. Chromium
uses authenticated Redeven WebSockets over an SSH loopback forward. The isolated
Runtime upgraded published `floe-native-apps` v0.22.1 to v0.22.2 through the
preparation API, preserving the usable package until validation. It selects
software `x264enc`: the managed musl stack cannot use the glibc-only CUDA driver.
Aggregate GPU activity includes unrelated applications.

Real product checks passed first-paint authority, keys, Chinese/emoji paste,
clicks and bidirectional text clipboard. Official Electron 41.10.5 also passed
drag-selection, scrolling, native fullscreen, view-only and explicit takeover.
Logout closed both channels and rejected new tickets with 423. Live permission
revocation closed both channels and rejected new view-only sessions with 403.
Host fixtures survived both operations.

## Published performance and fidelity

Each v0.22.2 matrix cell below contains three 60-second runs. The 1440p lease
used a 2560×1440 framebuffer scaled to physical 3840×2160@59.94Hz scanout because
the native 1440p mode is only 30Hz. It restored 1920×1080@60Hz afterward.

| Resolution / scene | Painted FPS | Interval P95 | Result |
| --- | --- | --- | --- |
| 1440p scrolling | 52.55 / 53.86 / 52.48 | 33.3–33.5ms | fail |
| 1440p window motion | 52.95 / 53.76 / 52.51 | 33.3–33.5ms | fail |

No complete published matrix has passed. Three injected decoder failures recovered
to new draws in 49.2, 32.2 and 33.6ms with fresh-paint gating on v0.22.2.

An 80-key run at each resolution measured client physical keydown to the animation
frame after the changed task marker was drawn. P95 was 83.8ms at 1080p and
84.3ms at 1440p; both failed. Native-pixel PNG refinement matched an independent
lossless X11 800×120 text region byte-for-byte at both resolutions. Refinement
took 218–342ms in the v0.22.2 matrix. Task system-output tones reached the
production Opus decoder and AudioWorklet; headless playback is not a listening test.

A 600.3-second v0.22.2 run completed 656 interactions, ten task tones and 30,235
Opus packets without client errors. Sampled decoder depth stayed at zero and
AudioWorklet handoff had at most two pending blocks. Input P95 was 80.4ms, still
failing. Normalized audio arrival increased about 10ms, but uncalibrated clock
drift prevents an output-device delay conclusion. This proves bounded observed
handoff, not complete audiovisual synchronization.

## macOS product and input

Product Runtime `6990d5692`, using published
v0.22.2, passed authenticated 2560×1440 viewing and basic text/emoji, pointer,
bidirectional clipboard, fullscreen and view/control takeover. The office run
explicitly cancelled remote Pinyin composition before client text submission.
Leaving remote marked text active caused client submission to fail. Earlier
40-key and 100-key product runs recorded
86.4ms and 87.0ms P95, respectively, and failed.

The unlocked-host Electron contract regression passed takeover, transitions,
view-only clipboard cleanup, fullscreen, Files and all ten locales. These partial
results do not establish full macOS acceptance.

## macOS native candidate qualification

Upstream commit `6c53f6445b2f15f0185a66e0f0ab23b2f3ac67c6` was tested with
separate capture and fixture processes on this Apple Silicon host. The controlled
fixture covers the desktop; no user applications receive test input. Each matrix
cell contains three 60-second runs using VideoToolbox hardware H.264 and the
candidate browser player. These are native qualification results, not a
published Redeven product matrix.

| Resolution / scene | Painted FPS | Maximum interval P95 |
| --- | --- | --- |
| 1080p scrolling | 55.52 / 57.32 / 57.58 | 30.6ms |
| 1080p window motion | 56.59 / 56.76 / 57.45 | 27.2ms |
| 1440p scrolling | 57.70 / 57.22 / 57.43 | 28.8ms |
| 1440p window motion | 57.40 / 57.33 / 57.41 | 27.1ms |

All twelve runs passed FPS, interval and refinement thresholds without errors;
maximum refinement was 346.7ms. A separate 100-key test measured 65.8ms P95
from client command to a task after the rendering opportunity that displayed the
changed fixture pixel. The native Q shortcut changes that marker independently
of IME composition. A 611.1-second run completed 3,000 transitions with 67.5ms
P95 and no errors. Sampled pending/decoder queues stayed empty and tracked frames
never exceeded one. This proves observed input/video stability, not output-device
audiovisual synchronization. Earlier foreground-loss and latency failures remain
retained; aggregate CPU/GPU attribution for this matrix is still incomplete.

At the actual 4608×2592 size, the hardware encoder rejected a real test frame.
The explicitly reported software path produced a PNG refinement whose 800×120
multilingual text/emoji region matched an independent authorized screenshot
byte-for-byte. No 4K60 claim follows. Three injected decoder failures recovered
in 42–46.4ms without restarting capture. A task-generated system-output tone
produced 227 decoded Opus frames with nonzero energy and no errors; this was not
a listening or output-device latency test. Concurrent owned-window JPEG/H.264
and display H.264 streams preserved independent generations and start/stop state.

Explicit native paste passed AppKit and Electron after completing host
composition. Unfinished Electron Pinyin composition consumes the paste shortcut;
advertised accessibility text replacement can also report success without
inserting text. Those fallback experiments were removed. The accepted product
policy defaults to the host input method and requires an explicit client-text
paste choice, explaining clipboard replacement and completion/cancellation of
host composition before switching. The product viewer implements this choice,
with all ten locales and browser/Electron contract tests passing. Real product
requalification remains pending.

## Capture and playback diagnostics

`udesk24` GNOME 46 Wayland completed user authorization, upstream functional
capture/input/clipboard/audio and grant restoration. Its 1080p result was about
37.6 FPS; capture alone reached 38–41 FPS. It exposes neither 1440p nor usable
hardware encoding. These are limitations, not Linux GPU qualification.

Unpublished X11 experiments with faster capture, format/cursor changes, a capture
queue and XDamage did not resolve cadence. A 120Hz scanout improved capture but
cannot certify the original 60Hz case. None was adopted by Redeven.

A candidate player retains the freshest decoded pending picture while decoding
every H.264 dependency. Paired 100-key 1440p diagnostics with identical published
Linux capture measured P95 81.0ms with the old player and 65.3ms with the candidate.
A 20-second synthetic source received/decoded 60.04 frames/s and drew 59.29
frames/s with interval P95 17.5ms. Real X11 window motion still failed: the GTK
frame clock requested 59.93 updates/s, capture observed 54.33 different pictures/s,
and the candidate drew 51.40 frames/s with P95 33.4ms. Reducing presentation backlog
alone does not repair capture cadence. The subsequent progress-aware decoder
drain fix eliminated false keyframe stalls in a 60-second X11 run, but its
53.39 FPS and 33.5ms interval P95 still failed the hard thresholds.

A view-only public-portal capture comparison is prepared for `server`, pending
host consent. Two requests expired without a consent result; the second kept its
fixture hidden until authorization. No request remains active. This diagnostic
retains real login identity and does not change product backend selection.

# Remaining qualification

- Resolve Linux capture cadence and complete both published-product matrices.
- Integrate explicit text-input modes and requalify office interaction, app/desktop
  takeover, reference pixels and stability against the published dependency.
- Coordinate Linux/macOS lock and host-side unlock; distinguish OS refusal from
  remote-unlock success.
- Complete actual shortcuts, display hotplug and output-device audiovisual delay.
- Validate subsequent viewer changes on unlocked Electron before integration.
  Runtime restart invalidates credentials and requires a new product session;
  transport reconnect does not recreate expired sessions.

# Verification

Run affected `GOWORK=off go test -race` checks for `internal/remotedesktop`,
`internal/codeapp/appserver`, `internal/hostapps`, `internal/config` and Local UI
access lifetime, plus Swift `HostApplicationHostTests`.

From `internal/envapp/ui_src`, run `node scripts/checkRemoteDesktopViewer.mjs`
and its `--electron` variant. These synthetic fixtures exercise the production
viewer/preload without controlling host applications. Electron requires the
official runtime and a unique profile/process marker. Checks cover input,
clipboard, display removal, lock/permission states, tickets, old-paint rejection,
serialized transitions and view-only clipboard cleanup. Declined takeover stays
view-only. Initial `LOCKED` rejection exposes reconnect without prior paint
authority. Electron also checks native fullscreen, Files and all ten locales at
narrow width. These are contract checks, not performance proof.

# Evidence

- `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs` and `desktop/scripts/fixtures/remote-desktop.ts`: browser/Electron interaction fixtures.
- `internal/remotedesktop/socket_test.go` and `internal/remotedesktop/manager_test.go`: session and input authority checks.
- `internal/codeapp/appserver/remote_desktop_test.go`: API permissions and remembered-display persistence.
- `desktop/native/computer-host/Tests/RedevenComputerHostTests/HostApplicationHostTests.swift`: shared-helper channel and failed acquisition checks.
