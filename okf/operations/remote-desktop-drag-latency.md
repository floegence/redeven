---
type: Qualification Record
title: Remote desktop drag latency
description: Assess raw-pointer dispatch using repeated native drag and client-window observations over the production Desktop SSH placement bridge.
tags: [desktop, input, latency, qualification]
timestamp: 2026-10-04T15:40:00Z
---
# Summary

The 2026-10-04 X11 qualification observes lower continuous window-drag latency
with published Floe Webapp v0.81.6 over the production Desktop SSH/HTTP2 placement
bridge. The [viewer contract](../architecture/remote-desktop-viewer.md) owns input
and painted-frame authority; the published pointer controller owns raw motion,
button ordering and cancellation. A failed decoder still requires a fresh
generation and paint. This record establishes one tested configuration, not
physical input-to-photon latency or parity with NoMachine.

# Configuration and method

The server runs Ubuntu 24.04 X11, i7-14700KF, RTX 4090 D, NVIDIA 550.90.07 and a
1920x1080 60 Hz display. A task-owned Electron 41.10.5 window on the Mac is
1440x960. Its harness imports the production Desktop SSH manager, placement
bridge and private request-header helper. Both variants use the same authorized
remote-desktop viewer through that bridge, rather than a plain SSH port forward.
The user's existing Runtime and NoMachine sessions remain running.

Both variants use published `floe-native-apps` v0.22.10. Baseline Redeven
`adb07878d4afdcda06a5702b545f4ff30e1f3c20` uses Floe Webapp v0.81.5. The candidate
is based on `69a202ac66c624ca4492ba063712ce59499f81b5`, with v0.81.6 manifests,
locks and regenerated pointer assets. Candidate history also contains an
unrelated Flower fix; no Flower workload runs in this test. The placement bridge
is identical for both variants. Builds use `GOWORK=off` and public packages.
The same baseline Env App/Code App dist is reused for embedding; the standalone
desktop viewer assets are rebuilt. This is focused viewer qualification, not a
full application or installer build.

Native macOS CGEvents drag a decorated 640x480 test window through eight
alternating 480-pixel legs. Each leg lasts 800 ms, followed by a 300 ms pause;
one button remains held across the sequence. A 60 Hz ScreenCaptureKit stream
observes colored window markers in the exact test client's window. The primary
endpoint maps each newly visible marker position back to the interpolated
native input position, using same-client-clock presentation timestamps. It
excludes the first 150 ms and last 50 ms of each leg and 50 pixels near endpoints.
No canvas pixel readback runs in the viewer during these measurements.

Four baseline and three candidate runs retain 927 and 708 steady-motion samples.
All have one initial button-down, a final release plus cleanup release, stable
window Y coordinates and no decoder recovery. Exploratory runs with physical
mouse interference, ineffective event substitution or per-leg button releases
are excluded and retained separately in the evidence corpus. All seven final
runs are reported; frames are correlated observations, not independent trials.

# Observed results

Values are milliseconds, empirical median / P95 of native input to the first
observed matching client-window position.

| Run | Steady samples | Baseline | Candidate |
| --- | ---: | ---: | ---: |
| Baseline 1 | 236 | 68.07 / 86.51 | |
| Baseline 2 | 218 | 71.36 / 85.23 | |
| Baseline 3 | 245 | 68.59 / 84.51 | |
| Baseline 4 | 228 | 62.67 / 84.06 | |
| Candidate 1 | 238 | | 56.51 / 69.13 |
| Candidate 2 | 237 | | 57.07 / 69.86 |
| Candidate 3 | 233 | | 58.80 / 74.06 |

The median of run medians changes from 68.33 to 57.07 ms; the median of run P95s
changes from 84.87 to 69.86 ms. These describe the repeated runs, not pooled
percentiles or confidence bounds. The observed improvement is about 10-15 ms,
not several-fold acceleration.

Browser input dispatch accounts for the main difference: its run medians fall
from 14.59-20.32 to 5.35-5.73 ms. Capture-to-receive run medians remain
13.80-15.22 ms across both variants, with cross-host clock uncertainty. Receive
to player presentation-call entry is about 1.2 ms, P95 1.6-1.8 ms; that diagnostic
does not include completed canvas drawing or compositor presentation. Visible
position-update intervals remain about 17.3 ms median and 34-38 ms P95. Video
quality, frame receipts and H.264 ordering are unchanged.

Each run also has eight stop observations. Baseline stop-to-settled-window run
medians range 61.51-67.46 ms, candidate 52.59-62.74 ms. This secondary metric
matches the host's actual final geometry in the same pause: leftward held-button
stops can end 2-12 pixels short on both versions. It does not establish exact
arrival at every requested endpoint or mouse-up latency.

Media headers identify `nvidia-nvenc`, and NVIDIA's session listing identifies
the task worker's 1080p H.264 session. CDP Media reports
`VideoToolboxVideoDecoder` and `kIsPlatformVideoDecoder=true` on the final Mac
candidate. The server's RTX 4090 D encodes; the Mac decodes. WebCodecs' hardware
preference alone is not evidence of a selected hardware path. The browser does
not expose VideoToolbox's per-session physical hardware-use property.

# Correctness and remaining limits

Four real X11 host cursor shapes, explicit decoder failure/recovery, view-only
mode and accepted control restoration pass on the final candidate. Product
confirmation is exercised normally. Published-package browser and Electron
viewer checks cover raw drag before animation-frame/media progress, local
cursor and paint authority, clipboard, fullscreen and disconnect. The shared
Host Application pointer browser tests pass on Chromium, Firefox and WebKit;
140 adapter unit tests and focused remote-desktop/application Go tests pass.
Upstream checks cover mouse/pen button-only chords, target loss, reset/disposal,
touch, and browser fallback without duplicate motion.

ScreenCaptureKit observes a compositor-provided window surface, not physical
panel light. Sampling, OS scheduling and native event injection remain in the
result. These runs do not compare NoMachine simultaneously, qualify WAN loss,
prove 120 Hz operation, or qualify packaged Desktop delivery. The input change
removes a browser wait; host repaint/capture and client composition still consume
refresh intervals. Further capture or transport changes require new stage-level
evidence. The earlier [GPU qualification](remote-desktop-latency-results.md)
records encoder and copy-path limits separately.

# Evidence

- [Floe Webapp v0.81.6 source](https://github.com/floegence/floe-webapp/tree/v0.81.6): shared raw-motion implementation, unit and multi-engine browser coverage.
- [Floe Webapp release qualification](https://github.com/floegence/floe-webapp/actions/runs/37211906286): package build, packed/public consumers and registry readback; the exact run outcome is authoritative.
- `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs`: browser/Electron viewer and published input behavior.
- `internal/envapp/ui_src/src/styles/hostApplicationPointer.browser.test.tsx`: product pointer ownership across browser engines.
- Local corpus `task-evidence/desktop-drag-latency-20261004`: native events, window observations, all final runs, `final-results.json`, lifecycle/decoder evidence, binary SHA256 provenance and reproducible harness/analysis scripts; not shipped product content.
