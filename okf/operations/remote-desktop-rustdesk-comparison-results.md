---
type: Qualification Record
title: Physical desktop RustDesk comparison
description: Apply paired presentation, detail, compatibility and resource criteria before accepting RustDesk parity.
tags: [desktop, performance, qualification]
timestamp: 2026-10-15T13:00:00Z
---
# Summary

The primary qualification task owns acceptance. Full RustDesk parity and
repeatable restoration of historical performance remain unaccepted. Published
native v0.22.48 with negotiated six-frame delivery averages 46.21 FPS against
RustDesk 32.54 FPS in three retained motion rounds. Candidate pooled P95 is
310.60 ms against 207.59 ms, with nine versus three gaps over 250 ms. Candidate
round three reaches 53.04 FPS/P95 150.20 ms with no long gaps, but the adverse
first round cannot be replaced. Keep current security, authorization, confirmed
paint, ordering and recovery safeguards. The [C05 result](remote-desktop-lan-c05-results.md) owns current
results and open cases; the [decision ledger](remote-desktop-lan-experiment-ledger.md)
records adopted, rejected and unresolved experiments.

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

# Current Qualification

[C05 preparation and compatibility](remote-desktop-lan-published-c05.md) records
published v0.22.48, consumer identity, source-only tests, platform contracts,
release qualification and the reboot boundary. [C05 outcomes](remote-desktop-lan-c05-results.md)
retains all three pairs, source-input loss, missing presentation, fixture repairs,
whole-tree resources, exact-source detail and controlled retry conditions.
No complete parity claim follows from the six-frame diagnostic's 52-53 FPS.

# Historical Evidence

- [Published v40 and v45 results](remote-desktop-rustdesk-v40-v45-results.md): original three-round v40 advantage, host-input regression, complete resources and calibration limits.
- [Matched historical C01](remote-desktop-lan-historical-c01.md): same-condition v47/v40/v42 crossover; order deviation and all invalid trials retained.
- [Receipt C02](remote-desktop-lan-receipt-c02.md): rejected immediate-receipt candidate and source-loss association boundary.
- [Window C03/C04](remote-desktop-lan-window-c04.md): rejected exhausted-only timer and controlled four/six-frame crossover.
- [Orange comparison attempts](remote-desktop-rustdesk-orange-results.md): physical-host preparation and network limitations.
- [v37 results](remote-desktop-rustdesk-v37-results.md), [v42 results](remote-desktop-rustdesk-v42-results.md) and [v43 results](remote-desktop-rustdesk-v43-results.md): retained release-specific evidence.

# Boundaries

Results apply only to the recorded hardware, path and fixture. Cross-time
historical differences establish a deficit without isolating its cause. Do not
attribute it to Wi-Fi, codec or statistics without a discriminating measurement.
Do not discard adverse complete trials or silently remap inputs after loss.
Do not downgrade later security/functionality fixes. Unsupported physical
platforms cannot inherit Linux qualification; macOS and legacy four-frame
contracts remain distinct. Unmeasured hardware decoding and photon latency
remain unclaimed.

# Evidence

- B is `/private/tmp/redeven-udesk26-rustdesk-baseline`; durable C05 evidence is `/Volumes/JianDisk/.codex-cc/artifacts/redeven-lan-performance-20261014/published-c05-20261015`, with a SHA-256 manifest.
- `internal/codeapp/appserver/remote_desktop_viewer/viewer.js`: rendered-image and input authority.
- `internal/remotedesktop/socket_test.go`: offered capacity, actual socket overflow and unchanged paint authority.
- `desktop/src/main/windowTransport.ts`: Desktop transport lifecycle.
