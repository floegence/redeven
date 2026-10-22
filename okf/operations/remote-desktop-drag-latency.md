---
type: Qualification Record
title: Remote desktop drag latency
description: Assess raw-pointer dispatch using repeated native drag and client-window observations over the production Desktop SSH placement bridge.
tags: [desktop, input, latency, qualification]
timestamp: 2026-10-04T15:40:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

The 2026-10-04 X11 qualification observes lower continuous window-drag latency
with published Floe Webapp v0.81.6 over the production Desktop SSH/HTTP2 placement
bridge. The [viewer contract](../architecture/remote-desktop-viewer.md) owns input
and painted-frame authority; the published pointer controller owns raw motion,
button ordering and cancellation. A failed decoder still requires a fresh
generation and paint. This record establishes one tested configuration, not
physical input-to-photon latency or parity with NoMachine.

# Contract

## Configuration and method
The server runs Ubuntu 24.04 X11, i7-14700KF, RTX 4090 D, NVIDIA 550.90.07 and a 1920x1080 60 Hz display.

All seven final runs are reported; frames are correlated observations, not independent trials.

## Observed results
Values are milliseconds, empirical median / P95 of native input to the first observed matching client-window position.

| Run | Steady samples | Baseline | Candidate |
| --- | ---: | ---: | ---: |
| Baseline 1 | 236 | 68.07 / 86.51 | |
| Baseline 2 | 218 | 71.36 / 85.23 | |
| Baseline 3 | 245 | 68.59 / 84.51 | |
| Baseline 4 | 228 | 62.67 / 84.06 | |
| Candidate 1 | 238 | | 56.51 / 69.13 |
| Candidate 2 | 237 | | 57.07 / 69.86 |
| Candidate 3 | 233 | | 58.80 / 74.06 |

# Boundaries

## Correctness and remaining limits
Four real X11 host cursor shapes, explicit decoder failure/recovery, view-only mode and accepted control restoration pass on the final candidate.

The earlier [GPU qualification](remote-desktop-latency-results.md) records encoder and copy-path limits separately.

# Evidence

- [Floe Webapp v0.81.6 source](https://github.com/floegence/floe-webapp/tree/v0.81.6): shared raw-motion implementation, unit and multi-engine browser coverage.

- [Floe Webapp release qualification](https://github.com/floegence/floe-webapp/actions/runs/37211906286): package build, packed/public consumers and registry readback; the exact run outcome is authoritative.

- `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs`: browser/Electron viewer and published input behavior.
