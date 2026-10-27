---
type: Acceptance Record
title: Current-desktop qualification results
description: Assess published macOS and X11 performance, functional-only Wayland validation and local delivery limits.
tags: [desktop, linux, macos, validation, performance]
timestamp: 2026-10-02T15:30:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

Published v0.22.6 passes scoped macOS/X11 performance, office and ten-minute input/queue checks. User designated udesk24 functional-only; preserve its Wayland failures. v0.22.7 reconnect evidence covers audio, Mac hotplug/lock and Wayland modes. Integration proves neither release acceptance, Wayland performance nor hardware encoding; retries do not establish causes.

# Contract

## Published Dependency And Conditions
Both product binaries use clean source `6caee6df1da1eabdd5d9f4670d6eedcb578de1a3` and published `floe-native-apps` v0.22.6 (`dec4e3f48dba9445704b08cf2ff78c683c0c679a`).

Its glibc CUDA library cannot load into the isolated musl stack, which selects x264.

This is alternative scanout, not native 1440p60.

## Current Product Results
### macOS v0.22.6

| Capture | Minimum FPS | Maximum interval P95 | Maximum refinement | Bandwidth |
| --- | --- | --- | --- | --- |
| 1920x1080 | 57.582 | 23ms | 329.5ms | 14.71-14.82Mbps |
| 2560x1440 | 57.657 | 24.7ms | 351.1ms | 26.21-26.33Mbps |

Doubling acquisition from about 115 to 224 reads/s improved changed/encoded FPS only from 56.0 to 56.5; that higher-cost change was not adopted.

It had at most one pending handoff and zero at completion.

## Release And Lifecycle Evidence
v0.22.6 source CI, CodeQL, both native architectures, private applications, host-desktop media and Swift checks passed.

Authenticated Xvfb checks passed pixels, resource lifetime, protocol isolation, cursor, input and recovery. macOS uses a bounded latest-sample mailbox to separate comparison from encoding; callback wait P95 fell from about 8.6ms to 0.02ms.

Final focused desktop/appserver race tests were repeated against the published dependency and passed.

# Boundaries

## Retained Failures And Limits
Earlier Mac results retain 38.323 FPS, 33.3ms interval P95 and 82.2ms input P95 failures, plus `KEYFRAME_REQUIRED` despite verified foreground.

Neither host is qualified for remote unlock.

## Local Delivery And Qualification Limits
The implementation and subsequent records were fast-forwarded into local `main` through `2945183a90e46f382410fa7ae23d4b35d8b63998`, preserving existing unpublished commits.

Its performance is outside this delivery's acceptance scope by explicit user instruction; no 55 FPS Wayland claim is made. - Any broader release claim requires its own host qualification; source integration alone is not release acceptance.

# Evidence

- `published-v0226-*-build-metadata.log` and `native-v0226-qualification-watch.log`: provenance and release qualification.

- `product-performance-macos-v0226-1080.json` and `product-performance-macos-v0226-1440-ready.json`: Mac matrices.

- `product-macos-v0226-stability-summary.json` and `product-linux-v0226-output-latency-summary.json`: complete stability and audio estimates.

Detailed identities, raw results and failures remain in private `task-evidence/remote-desktop-20261001/product-progress.json`. Representative records:
