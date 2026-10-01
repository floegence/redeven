---
type: Validation Guide
title: Current-desktop acceptance and performance evidence
description: Distinguish remote desktop contract checks, real office behavior, failed performance thresholds and remaining qualification.
tags: [desktop, linux, macos, validation, performance]
timestamp: 2026-10-01T10:35:00Z
---
# Summary

This is the acceptance record for the [desktop contract](../architecture/remote-desktop.md).
Acceptance remains incomplete. Preserve failures and thresholds; a connected
picture or preferred decoder does not certify performance. Formal checks consume
published dependencies with `GOWORK=off`.

# Contract

For both 1920×1080 and 2560×1440, measure scrolling and task-owned window motion
for at least 60 seconds, three times each, on a documented low-latency connection.
Every run requires painted FPS ≥55, frame interval P95 ≤33ms and input-to-visible
P95 ≤80ms. Native admission and packet arrival are not visible response.

Refinement must finish within 500ms and match a lossless text reference at the
same dimensions. Native pixels preserve coordinates. Ten-minute interaction
requires bounded queues, released keys and no accumulated audiovisual delay.
Record encoder, decoder preference, CPU/GPU attribution, bandwidth and failures;
4K does not substitute for either required resolution.

The host user completes OS authorization. Fixtures operate only their own
applications and stop input when the expected foreground is lost. Display leases
restore the original mode; cleanup preserves user applications and unsaved work.
Lock refusal is paused sharing, never successful remote unlocking.

# Recorded product evidence, 2026-10-01

## Environment and office behavior

`server`: Ubuntu 24.04 GNOME X11, RTX 4090 D, driver 550.90.07. Chromium uses
authenticated Redeven WebSockets over an SSH loopback forward. The isolated
Runtime upgraded published `floe-native-apps` v0.22.1 to v0.22.2 through the
preparation API, preserving the usable package until validation. Software
`x264enc` is selected because the managed musl stack cannot use the glibc-only
CUDA driver. Aggregate GPU activity includes unrelated applications.

Real product checks passed first-paint authority, keys, Chinese/emoji paste,
clicks and bidirectional text clipboard. Official Electron 41.10.5 also passed
drag-selection, scrolling, native fullscreen, view-only and explicit takeover
without client errors. Local UI logout closed
both channels and rejected new tickets with 423; live permission revocation
closed both channels and rejected new view-only sessions with 403. Host fixtures
survived both operations. This does not qualify all platforms or lock screens.

## Performance and fidelity

Each matrix cell below contains three 60-second runs. The 1440p lease used a
2560×1440 framebuffer scaled to physical 3840×2160@59.94Hz scanout: the host's
native 1440p mode is only 30Hz. The lease restored 1920×1080@60Hz.

| Published native version | Resolution / scene | Painted FPS | Interval P95 | Result |
| --- | --- | --- | --- | --- |
| v0.22.1 | 1080p scrolling | 55.20 / 57.87 / 58.88 | ≤33.0ms | pass |
| v0.22.1 | 1080p window motion | 58.03 / 57.29 / 53.48 | up to 33.4ms | fail |
| v0.22.1 | 1440p scrolling | 53.63 / 53.36 / 50.91 | 33.4–33.8ms | fail |
| v0.22.1 | 1440p window motion | 54.07 / 53.24 / 53.42 | 33.4–33.8ms | fail |
| v0.22.2 | 1440p scrolling | 52.55 / 53.86 / 52.48 | 33.3–33.5ms | fail |
| v0.22.2 | 1440p window motion | 52.95 / 53.76 / 52.51 | 33.3–33.5ms | fail |

One initial window run had a 924ms decoder-recovery gap. Published v0.22.2
preserves capture during encoder replacement. Three injected product failures
recovered to new draws in 49.2, 32.2 and 33.6ms with fresh-paint gating. This
does not establish steady-state performance.

Input measurement used 80 physical keys at each resolution and independent color
sampling of the task response marker. It starts at client keydown and ends at
the animation frame following the changed canvas draw. P95 was 83.8ms at 1080p
and 84.3ms at 1440p; both failed. Native-pixel PNG refinement at both resolutions
matched an independently read X11 lossless 800×120 text region byte-for-byte
(RGBA SHA-256 equality). Refinement was 235–279ms initially and 218–342ms in the
v0.22.2 matrix. Task system-output tones reached the production Opus decoder and
AudioWorklet at both resolutions; headless playback is not a listening test.

A 600.3-second v0.22.2 input/audio run completed 656 interactions, ten task tones
and 30,235 Opus packets without client errors. Sampled decoder depth stayed at
zero; the AudioWorklet handoff had at most two pending blocks. Input P95 was
80.4ms, still failing. Normalized audio arrival increased by about 10ms across
ten minutes; host/client clock drift was not calibrated. This establishes bounded
observed handoff, not output-device playout timing or complete audiovisual
synchronization. An earlier keyboard-only run completed 657 interactions with
81.9ms P95 and no sampled queue growth.

## Platform limits and diagnostics

`udesk24` GNOME 46 Wayland completed user authorization and upstream functional
capture/input/clipboard/audio and grant restoration. Its 1080p result was about
37.6 FPS; capture alone reached 38–41 FPS. It exposes neither 1440p nor usable
hardware encoding. These are limitations, not Linux GPU qualification.

Native macOS passed FPS/interval checks at both resolutions. A 1440p input run
recorded 80.6ms P95 to canvas draw and 95.0ms to the following animation-frame
confirmation. A later cadence experiment recorded 69.9ms and 83.6ms respectively;
confirmation still failed the 80ms requirement. Its ten-minute fixture lost
foreground and safely stopped; stability remains unqualified. The latest
unlocked-host Electron regression passed takeover, transitions, view-only
clipboard cleanup, native fullscreen, Files and all ten locales. An isolated
macOS product Runtime using published v0.22.2 also passed authenticated view-only
connection and 2560×1440 H.264 decoding/rendering without errors. These checks do
not establish full macOS office or performance acceptance.

An unpublished X11 diagnostic requested capture at 240Hz while retaining a 60 FPS
encoder limit. Three 60-second 1440p scroll runs reached 57.20 / 57.12 / 57.40 FPS
with P95 19.1 / 31.7 / 18.7ms. Window motion reached 55.33 / 55.18 / 55.57 FPS but
failed interval P95 at 33.2 / 33.3 / 33.3ms. A separate instrumented 20-second run
observed 62.2 fixture updates/s, 98.0 capture samples/s, 54.9 changed pictures/s
and 54.6 client draws/s: the loss existed before encoding. This source outside
the repositories was neither released nor consumed by Redeven. A requested
capture rate is not measured FPS and this experiment is not formal acceptance.

Follow-up diagnostics used the GTK frame clock to animate real task windows.
The fixture requested about 59.7 updates/s, while capture still observed about
55.4 changed pictures/s. Removing BGRA conversion, removing the cursor in a
diagnostic, decoupling capture with a one-buffer queue, and enabling XDamage did
not meet the required motion thresholds. They are not product changes. A
temporary 120Hz physical-scanout experiment improved changed-picture cadence,
but its different display conditions cannot certify the original 60Hz case.

An unpublished player candidate keeps only the freshest fully decoded picture
before each animation-frame draw. With the same published v0.22.2 Linux capture,
paired 100-key 1440p diagnostics measured input-to-next-frame-confirmation P95
of 81.0ms for the published player and 65.3ms for the candidate. This does not
qualify sustained motion: fewer queued decoded pictures can also reduce painted
FPS when capture or arrival is uneven. Keep formal acceptance on published
artifacts and resolve both latency and cadence before release.

# Remaining qualification

- Resolve published-product FPS and input failures without lowering thresholds.
- Complete unlocked macOS product behavior, app/desktop takeover, reference
  pixels and uninterrupted foreground stability.
- Coordinate real Linux/macOS lock and host-side unlock; distinguish OS refusal
  from remote-unlock success.
- Complete actual shortcut, display-hotplug and output-device audiovisual delay
  evidence. Synthetic state transitions do not replace these checks.
- Validate subsequent viewer changes on an unlocked Electron host before local-main
  integration. Runtime restart invalidates credentials and requires a new product
  session; transport reconnect alone does not recreate an expired session.

# Verification

Run affected `GOWORK=off go test -race` checks for `internal/remotedesktop`,
`internal/codeapp/appserver`, `internal/hostapps`, `internal/config` and Local UI
access lifetime, plus Swift `HostApplicationHostTests`.

From `internal/envapp/ui_src`, run `node scripts/checkRemoteDesktopViewer.mjs`
and its `--electron` variant. They use synthetic media, record input without
controlling host applications, and exercise the production viewer/preload. The
Electron fixture requires the official runtime and a unique profile/process
marker. Both cover Chinese input, clipboard fallback, monitor removal,
lock/permission states and transient ticket recovery. They reject old paint
receipts during transitions, disable competing transition controls and clear the
former controller's clipboard when moving to view-only. Declining native takeover
continues view-only on the selected display; connect cannot escalate that mode.
An initially rejected `LOCKED` connection must show a locked status and an
explicit reconnect action; that reconnect cannot reuse prior painted authority.
Electron additionally checks actual native fullscreen, the owning Files bridge
and all ten locales at narrow width. These are contract checks, not performance
proof.

Credentials and raw captures remain outside the repository and audit payloads.

# Evidence

- `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs` and `desktop/scripts/fixtures/remote-desktop.ts`: browser/Electron interaction fixtures.
- `internal/remotedesktop/socket_test.go` and `internal/remotedesktop/manager_test.go`: session and input authority checks.
- `internal/codeapp/appserver/remote_desktop_test.go`: API permissions and remembered-display persistence.
- `desktop/native/computer-host/Tests/RedevenComputerHostTests/HostApplicationHostTests.swift`: shared-helper channel and failed acquisition checks.
