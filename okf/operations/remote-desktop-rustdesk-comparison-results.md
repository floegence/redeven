---
type: Qualification Record
title: Physical desktop RustDesk comparison
description: Check current paired presentation, resource and quality evidence before accepting RustDesk parity.
tags: [desktop, performance, qualification]
timestamp: 2026-10-13T09:04:00Z
---
# Summary

The primary qualification task owns this comparison contract. Complete RustDesk
parity remains unaccepted. The current published DRM cadence candidate and
its remaining latency, quality and resource failures are recorded in the
[v0.22.43 diagnostics](remote-desktop-rustdesk-v43-results.md). The software VP9
`v0.22.40` rounds below remain historical comparison evidence. Equal application
window sizes do not establish equal content viewports. Lower quality, omitted
SSH costs or failed samples cannot satisfy acceptance; each successor needs
published-artifact validation and a fresh real-window comparison.

# Contract

## Method And Acceptance

The official baseline is RustDesk `1.5.0`, source
`fada664df7a294d1d1a9ca3e7cd3637069122f17`. The operator authorizes temporary
direct-LAN control and native observation of the two test windows. Keep both
applications in small ordinary windows while the operator uses the Mac; input
sampling may briefly switch focus. No permanent RustDesk service or public
broker registration is part of this fixture.

Three paired alternating rounds must retain physical output, resolution,
refresh rate, content viewport and delivered detail quality, with one measured
Viewer at a time. Compare idle/motion/static P50/P95 latency, unique presented
FPS, gaps and complete CPU/memory/bandwidth including SSH. Record selected codec,
hardware, route, network, all unmatched inputs and failed attempts. A decoder
preference does not prove hardware decoding.

A single Mac monotonic clock relates observed input to its matching sequence in
client pixels. Native command equality, packet arrival and CUA call duration are
not presentation latency. The method excludes physical photons. Source age
requires bounded cross-host clock uncertainty. Derive marker geometry afresh;
use the same calibration and resampling algorithm for both products. Whole-tree
resources and incremental Viewer costs are distinct observations; baseline
subtraction cannot silently replace whole-tree reporting.

## Published v0.22.40 Identity And Conditions

udesk26 retains DP-3 at physical 1920 × 1280, 60 Hz, scale 1.6666666269 and GTK
allocation 1152 × 768. Display settings are unchanged. Native dependency
`v0.22.40` is the immutable published module; Runtime image SHA-256 is
`a4289b34c93774969d7317c8e7a99fd7cb0ca4b085c65a788d8e5cab3551bdcc` and
root service image SHA-256 is
`e59e8d23932d4c5f901b2989111aa38afa83a43e796452e24f6ea514ca70cd8d`.
Formal consumer checks run with `GOWORK=off`.

The official x86_64 RustDesk 1.5.0 Debian binary SHA-256 is
`58ef1e984727d827836c8ad84ad50a4971db4a3cb80ad7a646982594af155c52`.
Its direct LAN port is 24441; the fixture broker stays on loopback 24442.
RustDesk uses AV1/I420, custom quality 100% and 60 FPS. Redeven uses VP9/I420,
Smooth and Host input method. Both ordinary application windows are 1280 × 721
logical pixels. Marker edges reveal approximately 2073 × 1382 versus
2043 × 1362 screenshot-pixel content extents, because the headers differ.
Normalized quality receipts retain that difference; these trials cannot alone
satisfy strict equal-viewport acceptance.

## Three Alternating Presentation Rounds

Every accepted workload observes all 100 source inputs and matches 100 responses.
Pairs alternate RustDesk→Redeven, Redeven→RustDesk and RustDesk→Redeven.

| Round / product | Idle P50 / P95 ms | Motion P50 / P95 ms | Presented FPS | Motion gaps >250 ms |
| --- | --- | --- | --- | --- |
| 1 / RustDesk | 105.39 / 123.50 | 140.86 / 160.29 | 30.98 | 0 |
| 1 / Redeven | 96.98 / 130.82 | 134.56 / 168.11 | 51.14 | 0 |
| 2 / Redeven | 101.04 / 133.48 | 134.62 / 157.15 | 51.30 | 0 |
| 2 / RustDesk | 115.39 / 158.05 | 140.93 / 174.42 | 33.76 | 1 |
| 3 / RustDesk | 128.36 / 193.75 | 139.45 / 173.92 | 31.98 | 0 |
| 3 / Redeven | 92.74 / 127.32 | 109.49 / 149.47 | 50.53 | 0 |

Round-two RustDesk has an 868.78 ms maximum response and 257.61 ms presentation
gap. Round-three Redeven has a 279.23 ms maximum response and 167.89 ms gap.
Candidate first-round idle and motion P95 remain worse than the paired baseline.
Higher FPS and matched median improvements do not establish every acceptance
boundary. Earlier expired scenes, incomplete CUA batches and concurrent encoding
remain invalid trials, including `r3-redeven-idle-retry6`.

## Resource Boundary

All six accepted static resource samples last 45 seconds. Workload resource
intervals derive from corresponding fixture sequences, rather than complete
sampler lifetimes. CPU is percent of one core. RSS includes shared pages;
macOS physical footprint is also retained. Host/client clocks remain independent.

| Motion round / product | Host CPU % | Host RSS P95 MiB | Client CPU % | Client RSS P95 MiB | Client footprint P95 MiB | LAN Mbps |
| --- | --- | --- | --- | --- | --- | --- |
| 1 / RustDesk | 251.3 | 560.3 | 45.0 | 277.3 | 554.6 | 4.400 |
| 1 / Redeven | 297.2* | 672.3 | 37.1 | 1054.8 | 1232.1 | missing* |
| 2 / Redeven | 308.3 | 754.2 | 37.7 | 1065.5 | 1184.0 | 4.716 |
| 2 / RustDesk | 250.6 | 537.9 | 46.5 | 288.0 | 547.6 | 4.437 |
| 3 / RustDesk | 250.7 | 616.1 | 45.5 | 282.3 | 587.8 | 4.385 |
| 3 / Redeven | 299.8 | 755.5 | 35.0 | 1073.1 | 1195.7 | 4.696 |

*First-round Redeven host roots omit the SSH ancestor: CPU and RSS are lower
bounds and LAN counters are missing. Subsequent complete roots are
194093, 194675 and 195615, including the bridge, Runtime and service descendants.
Those initial resources do not qualify parity. No remote encoding session runs
concurrently in accepted replacement trials.

Third-round idle Redeven host CPU is 31.4%, host RSS P95 758.2 MiB and LAN
0.174 Mbps; RustDesk is 5.7%, 617.6 MiB and 0.009 Mbps. Candidate client CPU is
5.4%, RSS P95 977.6 MiB and footprint P95 1174.2 MiB; baseline is 4.3%, 245.4 MiB
and 518.2 MiB. Static candidate host/client CPU is 11.2%/4.9%, versus 3.8%/2.8%.
The complete Desktop tree includes its launcher, Env App and task Runtime/bridge.
These are whole-tree costs with no subtraction, not equivalent isolated Viewer
memory. Resource parity remains open.

## Exact Moving Quality And Calibration

Six accepted quality sets each contain 10 snapshots with an exact moving source
frame and sequence match. The replacement second-round RustDesk moving sample
is acquired after the third pair; it completes product coverage but is not a
contemporaneous second-round quality pairing. The earlier moving=false sample
remains invalid. Both products retain source references and all original receipts.

A second analysis fits the same 16-cell magic marker edges per snapshot and uses
fractional viewport Lanczos resampling to 1920 × 1280 for both products. Mean
text PSNR/MAE is 13.23/24.56, 13.22/24.56 and 13.23/24.48 for RustDesk, versus
13.45/24.55, 13.49/24.30 and 13.45/24.47 for Redeven. Mean color PSNR/MAE is
20.00/12.30, 20.02/12.26 and 20.01/12.27, versus 19.76/14.00, 20.28/13.14 and
20.28/13.20. These supersede rounded-viewport metrics for geometric comparison,
without deleting those original results. Fractional compositor rasterization,
resampling and unequal delivered extents limit pixel metrics; they alone cannot
establish perceptual detail parity.

# Evidence

- Task-owned `redeven-udesk26-rustdesk-baseline/published-v40-paired`: immutable raw inputs, window captures, exact source matches, calibrated receipts and `resources-three-rounds.json`; invalid attempts retain separate validity records.
- [Orange comparison attempts](remote-desktop-rustdesk-orange-results.md): incomplete physical-host and network evidence.
- [udesk26 v0.22.37 baseline](remote-desktop-rustdesk-v37-results.md): failing H.264 baseline and source-clock limits.
- [Orange functional deployment and recovery](remote-desktop-orange-viewer-results.md): functional boundaries, distinct from performance acceptance.
- [Native v0.22.40 release](https://github.com/floegence/floe-native-apps/releases/tag/v0.22.40): commit `eeddccc4a3b42e126e82406628705e2a0715541b`, module `h1:rKsKYiAnc4aMIp+0za1hsQ4pOZGwozSj+tij+lSblPo=`; all 545 module entries match source.
- [v0.22.40 qualification](https://github.com/floegence/floe-native-apps/actions/runs/38335810377): all lanes pass on rerun; initial AMD64 host-service initialization failure remains unexplained and retained.
- [v0.22.40 CodeQL](https://github.com/floegence/floe-native-apps/actions/runs/38335574962): extended security analysis.
- [Official RustDesk release](https://github.com/rustdesk/rustdesk/releases/tag/1.5.0): baseline provenance.
- `internal/codeapp/appserver/remote_desktop_viewer/viewer.js`: rendered image and input authority.
- `desktop/src/main/windowTransport.ts`: Desktop transport lifecycle.
