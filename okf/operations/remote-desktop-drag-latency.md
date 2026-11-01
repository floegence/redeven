---
type: Qualification Record
title: Remote desktop drag latency
tags: [desktop, input, latency, qualification]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
---
# Summary

October 4 X11/Floe 0.81.6 over Desktop SSH/HTTP 2 observes lower drag latency on i7-14700KF/RTX4090D/1080p60. Four baseline P95s84.06–86.51 ms and three candidate 69.13–74.06 ms retain all runs. Correlated frames cannot establish physical-photon latency or NoMachine parity.

# Contract

[Viewer](../architecture/remote-desktop-viewer.md) owns painted authority. Four cursor shapes, decoder recovery, view-only/control restoration pass; upstream owns pointer ordering/cancellation.

# Boundaries

[GPU record](remote-desktop-latency-results.md) owns encoder limits. Failed decoder still requires fresh generation/paint; Git retains source/version/sample tables.

# Evidence

- [Floe Webapp v0.81.6 source](https://github.com/floegence/floe-webapp/tree/v0.81.6): shared raw-motion implementation, unit and multi-engine browser coverage.

- [Floe Webapp release qualification](https://github.com/floegence/floe-webapp/actions/runs/37211906286): package build, packed/public consumers and registry readback; the exact run outcome is authoritative.

- `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs`: browser/Electron viewer and published input behavior.
