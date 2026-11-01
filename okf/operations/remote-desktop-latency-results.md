---
type: Qualification Record
title: Remote desktop latency and NVIDIA encoding
tags: [desktop, media, latency, qualification]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
---
# Summary

Native 0.22.29 physical-seat and 0.22.10 X11/NVIDIA lanes measure different paths. X11 candidate click P95 improves 84.8→71.7 ms(light),88.3→75.2 ms(scroll), with lower decode-to-draw. Results qualify named hardware/configurations only, not photons, universal GPUs, zero-copy or WAN behavior.

# Contract

X11 i7-14700KF/RTX4090D/NVIDIA 550.90.07/1080p60 encodes server-side, Mac decodes. Physical Unix/DRM results on udesk26/Orange exclude SSH/browser. Initial NVENC omitted SPS restrictions.

# Boundaries

Cursor shapes grant no paint authority; capture failure requires new paint. X11 readback/scaling/IPC/upload stay CPU-visible. macOS/Wayland retain embedded cursors. Git retains full metrics.

# Evidence

- [Native release source](https://github.com/floegence/floe-native-apps/tree/v0.22.10): bounded player, cursor, driver worker, pinned build and real-driver qualifier.

- [Release qualification](https://github.com/floegence/floe-native-apps/actions/runs/37204885377): exact-tag native installation and platform checks; final job outcome is authoritative.

- `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs`: published-player cursor, paint authority, mode/reconnect and browser/Electron behavior.
