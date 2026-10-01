---
type: Validation Guide
title: Current-desktop acceptance and performance evidence
description: Distinguish remote desktop contract checks, real office behavior, failed performance thresholds and remaining qualification.
tags: [desktop, linux, macos, validation, performance]
timestamp: 2026-10-01T15:00:00Z
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

Native macOS FPS/interval checks passed both resolutions, but input-to-next-frame
confirmation remained above 80ms. Product Runtime `6990d5692`, using published
v0.22.2, passed authenticated 2560×1440 viewing and basic text/emoji, pointer,
bidirectional clipboard, fullscreen and view/control takeover. The office run
explicitly cancelled remote Pinyin composition before client text submission.
Leaving remote marked text active caused client submission to fail; mixed
composition remains unresolved. Earlier 40-key and 100-key product runs recorded
86.4ms and 87.0ms P95, respectively, and failed.

The input fixture now responds visibly to a native Q event as an app shortcut,
consuming the key independently of IME text-commit notifications. A run with that
corrected detector lost foreground and stopped; it supplies no passing latency
or stability evidence. Independent native-pixel reference and expanded office
fixtures build, but real execution is pending foreground coordination. The
unlocked-host Electron contract regression passed takeover, transitions,
view-only clipboard cleanup, fullscreen, Files and all ten locales. These partial
results do not establish full macOS acceptance.

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
alone does not repair capture cadence. This candidate is not ready to publish.

A view-only public-portal capture comparison is prepared for `server`, pending
host consent. It retains real login identity and does not change product selection.

# Remaining qualification

- Resolve published-product FPS, input latency and mixed macOS composition.
- Complete macOS office behavior, app/desktop takeover, independent reference
  pixels and uninterrupted foreground stability.
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
