---
type: Acceptance Record
title: Current-desktop qualification results
tags: [desktop, linux, macos, validation, performance]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
---
# Summary

Native 0.22.6 passes scoped Mac/X11 office, performance and ten-minute queue/input checks. Mac minima 57.582/57.657 FPS cover 1080p/1440p. udesk24 is functional-only with retained Wayland failures; 0.22.7 owns later reconnect tests. Integration proves neither full release acceptance nor hardware encoding/parity.

# Contract

Consumer 6caee6df1da1/native dec4e3f4 uses x264 where glibc CUDA cannot load under musl. Higher acquisition cost gives negligible FPS and is rejected. Published regression/race pass; local integration 2945183 preserves prior commits.

# Boundaries

Retain Mac 38.323 FPS,33.3 ms interval,82.2 ms input and KEYFRAME_REQUIRED failures. Remote unlock unqualified. No 55 FPS Wayland claim. Git retains complete sample tables and build identities.

# Evidence

- `published-v0226-*-build-metadata.log` and `native-v0226-qualification-watch.log`: provenance and release qualification.

- `product-performance-macos-v0226-1080.json` and `product-performance-macos-v0226-1440-ready.json`: Mac matrices.

- `product-macos-v0226-stability-summary.json` and `product-linux-v0226-output-latency-summary.json`: complete stability and audio estimates.

Detailed identities, raw results and failures remain in private `task-evidence/remote-desktop-20261001/product-progress.json`. Representative records:
