---
type: Qualification Record
title: udesk26 v0.22.37 RustDesk comparison
description: Retain the failing H.264 baseline before published VP9 negotiation.
tags: [desktop, performance, qualification]
timestamp: 2026-10-13T09:04:00Z
---
# Summary

The primary qualification task records three alternating udesk26 rounds against published native v0.22.37. Dynamic latency and frame pacing fail the parity boundary. Unmatched responses, clock uncertainty and incomplete quality remain visible; later native versions require an independent comparison.

# Contract

The [comparison owner](remote-desktop-rustdesk-comparison-results.md) defines the measurement and acceptance contract. This record preserves historical observations rather than current-product parity.

# Observations

The independent x86_64 Ubuntu 26.04.1 comparison retains the physical DP-3
1920 × 1280 output at 60 Hz and scale 1.6666666269. No physical display setting
changes. Both clients show the entire output in a 2760 × 1840 screenshot-pixel
viewport. Scene v8 uses the actual GTK allocation of 1152 × 768; an isolated
Ubuntu `python3-gi-cairo` archive supplies the missing Cairo bridge without a
system installation. Initial blank scenes and expired calibration remain failed
preparation attempts.

The official RustDesk 1.5.0 x86_64 AppImage SHA-256 is
`422ebb915b4c709f3511cfa2941abcefdcb1d3d60f673f5a20cf88a4ab2c9aa5`. Its
temporary direct-LAN session uses port 24441, custom quality 100%, 60 FPS,
AV1 and 4:2:0. Product setup updates the installed Runtime and root desktop
service through the existing Desktop and Env App flows. Runtime readback is
`bb6683b5ce18` with image SHA-256
`379bc8f4f4f3299f7b911082a62ca74d73aee0d66db7e8273cb336050747f82f`,
and the native dependency is immutable published v0.22.37. This is not a
clean-exact-current-worktree build claim. Redeven uses Smooth, Host input method,
x264enc/H.264 and a prefer-hardware client decoder preference; the preference
does not itself establish hardware decoding.

| Round / product | Idle responses | Idle P50 / P95 ms | Motion responses | Motion P50 / P95 ms | Presented FPS | Gaps >250 ms |
| --- | --- | --- | --- | --- | --- | --- |
| 1 / RustDesk | 100/100 | 101.74 / 147.97 | 100/100 | 130.67 / 448.16 | 32.77 | 0 |
| 1 / Redeven | 100/100 | 98.09 / 143.54 | 100/100 | 178.06 / 460.40 | 32.58 | 8 |
| 2 / Redeven | 100/100 | 128.05 / 230.85 | 100/100 | 181.55 / 715.30 | 30.89 | 23 |
| 2 / RustDesk | 100/100 | 95.13 / 130.41 | 99/100 | 131.06 / 258.91 | 29.72 | 4 |
| 3 / RustDesk | 100/100 | 99.44 / 124.03 | 100/100 | 126.44 / 146.86 | 33.37 | 2 |
| 3 / Redeven | 100/100 | 97.72 / 197.81 | 100/100 | 178.86 / 646.85 | 30.62 | 15 |

Round-two RustDesk source events contain all 100 measured inputs, but response
sequence 19 is absent from sampled client pixels; matched-only percentiles retain
that limitation. Round-three Redeven has an idle maximum of 945.30 ms and a
motion maximum of 1223.99 ms. All six latency workloads retain their failures.

Completed latency captures have exact-window input scope, no outside or mismatched
window events, and no stream errors. First-round static retries and second-round
Redeven static captures each contain 45 resource samples over approximately
44 seconds. The initial first-round RustDesk static sampler stops at 34 seconds
and is retained as incomplete rather than accepted. Candidate process trees
include Runtime, desktop service and the product SSH wrapper; LAN wire, public
control-plane and loopback counters must remain separate. Full sampler lifetimes
are not workload intervals. macOS CPU Mach ticks are verified against cumulative
`ps` CPU time. Subsequent samplers use mach_absolute_time directly; initial
RustDesk resource records retain their Python-interpreter-relative clock limit.

Motion networking differs: first-round ping P50/P95 is 9.31/65.09 ms for RustDesk
and 24.75/137.14 ms for Redeven. This supports investigation of bandwidth and
network contention, not attribution of every freeze to the network. Source
draw-to-client age uses an explicit cross-host offset bound; it is not source
scanout age or physical photon latency. The first dynamic workload sends 8.27 Mbps of LAN wire data for Redeven and
3.99 Mbps for RustDesk. Host tree CPU is 158.55% versus 242.80% of one core;
host tree RSS P95 is 564.80 versus 613.20 MiB. First-round Mac motion RSS P95
is 1436.28 versus 251.69 MiB, and footprint P95 is 1432.56 versus 618.75 MiB.
These are whole selected process-tree observations: the isolated Desktop still
contains its idle Orange connection and Env App, and the initial RustDesk Mac
clock requires full-lifetime rather than exact-workload reporting. They cannot
establish equivalent incremental Viewer memory. Static crops of five text rows
are comparably readable and yield identical OCR output, but dynamic quality
remains incomplete. Neither resource nor full quality parity is accepted yet. Raw evidence lives in the task-owned
`redeven-udesk26-rustdesk-baseline/paired-20261012` set.

All three pairs finish after the operator unlocks the control Mac. Every accepted
static sample contains at least 40 seconds of resource observations. Seventy-two
copied source and host resource files pass SHA-256 readback after scenes end;
initially copied live source tails remain separately identifiable. The temporary
SSH password remains only in the isolated Desktop state pending test completion
and must be removed afterward; no credential is recorded in evidence.

Across all three motion workloads, candidate LAN send rate is 7.76–8.27 Mbps
versus baseline 3.81–4.16 Mbps. Candidate idle input sends 3.95–4.81 Mbps versus
baseline approximately 0.014 Mbps. End-of-run clock-offset midpoint differs by
30.94 ms from the initial probe and their bounds do not intersect. One constant
offset therefore cannot establish source-age parity; input-to-client latency
uses only the Mac clock and is unaffected. Full quality and resource acceptance,
including incremental Viewer memory, remains open.

Offline probes use the same synthetic scene pixels and the installed private
media interpreter. x264 ultrafast/veryfast/fast P50 encoding is
4.54/12.47/29.41 ms, with P95 10.34/18.46/67.45 ms. Slower presets therefore
need presentation evidence rather than a blind replacement. PNG compression
levels 1/6 encode identical pixels in 30.38/42.39 ms and produce
416236/335415 bytes. This approximately 19% byte reduction costs processing
time and does not itself resolve interactive full-frame refinement overhead.
An installed-stack VP9 realtime probe produces approximately 3.62 Mbps with
14.62/18.01 ms P50/P95 encoding, versus AV1's 25–43 ms encoding in these probes.
These synthetic measurements identify candidates, not presentation acceptance.
No production encoder or transport behavior changes during these probes. Three
alternating pairs are recorded; they establish a failing baseline, not parity.

# Boundaries

These observations apply only to the recorded hardware, published candidate
and measured paths. Diagnostic runs, incomplete pairs and missing samples
do not establish RustDesk parity or support unmeasured quality, recovery
or resource claims. The acceptance results and unresolved cases above remain
authoritative.

# Evidence

- [Official RustDesk 1.5.0 release](https://github.com/rustdesk/rustdesk/releases/tag/1.5.0): baseline artifacts.
- [Comparison owner](remote-desktop-rustdesk-comparison-results.md): current candidate and acceptance status.
