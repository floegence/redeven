---
type: Acceptance Record
title: Desktop reconnect qualification results
tags: [desktop, validation, lifecycle, audio]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
---
# Summary

Native 0.22.7 reconnects Linux/macOS AudioWorklet sound and requires fresh paint for input. X11 two 100-sample rounds yield 66.5/67.6 ms input-paint P95. Mac lock/hotplug and Wayland mode recovery are separately scoped; udesk24 performance stays unpassed and functional-only.

# Contract

Old viewer closed player despite enabled sound. Published consumer 69cd04988970/native 29ed2f3f owns recovery; earlier X11cb2fd0c6c/Mac 07337d3098 evidence remains in Git. Native STALE_DESKTOP differs from equivalent product pre-dispatch ignore.

# Boundaries

Earlier Wayland DISPLAY_STREAM_LOST retires input/frames, reauthorizes Portal and produces fresh 1280×800; no stale input. Direct native results cannot substitute for product/performance qualification; restore original mode.

# Evidence

- `viewer-reconnect-audio-red.log`: deterministic previous-source failure.

- `viewer-reconnect-audio-sample-green.log`, `viewer-reconnect-linux-audio-sample-green.log` and `viewer-reconnect-electron-audio-sample-green.log`: controlled browser/Electron codec regressions.

- `server-product-reconnect-regression-v0226.json`: exact build identity, both actual capture sizes, sound readback and input measurements.

Private task records are under `task-evidence/remote-desktop-20261001/`:
