---
type: Acceptance Record
title: Desktop reconnect qualification results
tags: [desktop, validation, lifecycle, audio]
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

Published native v0.22.7 reconnects Linux X11/macOS audio to AudioWorklet and gates input on fresh paint. Mac hotplug/locked replacement and Wayland mode recovery pass. This does not certify Wayland performance; udesk24 is functional-only. Session contracts own behavior; overall results retain performance/delivery limits.

# Contract

Published product qualification uses clean Redeven source `69cd04988970`.

## Deterministic Regression
The previous viewer closed its player on transport loss while retaining an enabled sound preference.

This controlled codec check is separate from the real-host evidence below.

## Real X11 Product Reconnect
The task Runtime on `server` used source `cb2fd0c6c`, published native v0.22.6, native Floeterm, `GOWORK=off` and no dependency overrides.

| Capture | Input samples | Input-to-painted-response P95 | Reconnect sound |
| --- | --- | --- | --- |
| 1920x1080 | 100 | 66.5ms | Fresh samples, retained running output |
| 2560x1440 | 100 | 67.6ms | Fresh samples, retained running output |

## Real macOS Product Reconnect
Clean Redeven source `07337d30981561ffd9b72ecfdb5c80b68af67dae` contains the same product fix and an evidence-only follow-up.

This regression did not repeat the full performance matrix or certify physical hotplug.

## Published v0.22.7 Qualification
Upstream commit `29ed2f3f71b429f18cbea19811522931ce97cf0c` has an immutable v0.22.7 tag.

Native direct calls reject stale receipts with `STALE_DESKTOP`; the product's pre-dispatch ignore has the same authority boundary but a different observable response.

The original 1440p mode is restored.

# Boundaries

## Earlier Native Candidate Evidence
A real Wayland native candidate recognized Mutter's retired PipeWire node after a supported mode change as `DISPLAY_STREAM_LOST`. It retired held input and old frame authority, reconnected the authorized portal, produced a fresh 1280x800 frame after the initial 1920x1080 frame, and rejected stale-generation input.

Its direct native behavior remains separate from the product tests above.

# Evidence

- `viewer-reconnect-audio-red.log`: deterministic previous-source failure.

- `viewer-reconnect-audio-sample-green.log`, `viewer-reconnect-linux-audio-sample-green.log` and `viewer-reconnect-electron-audio-sample-green.log`: controlled browser/Electron codec regressions.

- `server-product-reconnect-regression-v0226.json`: exact build identity, both actual capture sizes, sound readback and input measurements.

Private task records are under `task-evidence/remote-desktop-20261001/`:
