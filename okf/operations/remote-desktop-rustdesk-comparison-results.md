---
type: Qualification Record
title: Physical desktop RustDesk comparison
description: Verify observed presentation, resource and quality evidence against the official RustDesk baseline.
tags: [desktop, performance, qualification]
timestamp: 2026-10-12T10:32:00Z
---
# Summary

The primary qualification task owns this comparison. Published native
`v0.22.37` remains below the required RustDesk parity boundary. The first complete
udesk26 pair matches every input, but Redeven has worse dynamic latency and
eight presentation freezes; the second candidate run reproduces the regression.
Earlier Orange evidence is limited by missing responses, failed carrier recovery
and unstable networking. Complete paired presentation, quality and resource
evidence is mandatory; retained failures cannot become successful samples.

# Contract

## Method And Acceptance

The official baseline is RustDesk `1.5.0`, source
`fada664df7a294d1d1a9ca3e7cd3637069122f17`. ARM64 Linux/macOS artifacts match
official digests. The operator authorizes a temporary direct-LAN session and
bounded native observation of only two test windows, without permanent service
installation or public broker registration.

Three paired alternating rounds must use equal physical output, resolution,
refresh rate, viewport and delivered detail quality, with one measured Viewer
at a time. Idle, motion and static workloads compare P50/P95 latency, unique
presented FPS, gaps/freezes and complete CPU/memory/bandwidth including SSH
wrappers. Retain codec/hardware/route/network conditions and every unmatched or
failed sample. Lowering quality cannot satisfy acceptance.

One Mac monotonic clock relates passive test input to its matching sequence in
client-window pixels. Native command-ID equality, packet arrival and CUA duration
are insufficient substitutes. Observation excludes physical photons; source age
requires clock-offset uncertainty and each viewport needs fresh marker calibration.

## Orange Attempts

Current published-candidate rounds retain every attempt. **Smooth** picture mode
and **Host input method** are selected for performance; earlier paste acceptance
uses **Use local input method**. The same 1920 × 1080 physical output is presented
in a 2880 × 1620 viewport. RustDesk retains AV1/I420, custom quality 100%, 60 FPS;
its adaptive bitrate falls during later rounds. Source scene v6 changes only
motion controls from letters to F6/F7 after the host input method intercepts `m`.

| Round / product | Idle responses | Matched idle P50 / P95 ms | Motion responses | Motion P50 / P95 ms | Presented FPS | Gaps >250 ms |
| --- | --- | --- | --- | --- | --- | --- |
| 1 / RustDesk | 100/100 | 190.34 / 292.66 | 100/100 | 117.34 / 361.58 | 22.37 | 45 |
| 1 / Redeven | 93/100 | 119.11 / 158.84 | 100/100 | 115.10 / 149.37 | 43.91 | 1 |
| 2 / Redeven | 100/100 | 128.06 / 179.93 | 100/100 | 117.44 / 165.58 | 42.81 | 0 |
| 2 / RustDesk | 98/100 | 308.95 / 838.28 | 100/100 | 156.25 / 606.92 | 16.07 | 72 |
| 3 / RustDesk | 66/100 | 295.09 / 928.13 | 100/100 | 283.14 / 1109.42 | 12.25 | 90 |

Matched-only percentiles exclude unanswered trials and cannot establish full
acceptance tails. Every listed measured source receives 100 inputs; preliminary
RustDesk captures with 70 or 50 observed inputs remain incomplete. The initial
round-two idle observer expires after 50 inputs; its replacement observes 100.
CUA batch pauses extend actual workload durations; resource comparisons must
use recorded intervals and rates, not nominal 60/85-second labels.

After round-one Redeven motion, the SSH carrier ends. Runtime and root service
remain alive, but automatic Viewer retries fail and the expired lease requires
a fresh Env App connection. The [Orange functional record](remote-desktop-orange-viewer-results.md) proves
exact native media worker recovery; that does not
establish SSH carrier recovery. Round-three RustDesk later disconnects and asks
for remote acceptance again. Independent SSH evidence retrieval also times out;
partial source files remain distinguishable from complete evidence.

A later Orange LAN probe receives 4/8 packets, with 50% loss and RTT
1515.379/1787.054/2100.008 ms min/mean/max. This identifies unstable conditions,
not the cause of each product tail. The control Mac is unlocked. The operator
requests udesk26 for the remaining comparison; Orange's third Redeven half is
not run. udesk26's ten-packet preflight has zero loss and RTT
5.177/7.716/10.346 ms. Its 1920 × 1280 physical output and fractional scale require
fresh marker calibration and an independent comparison; its results cannot
qualify Orange's hardware.

Round-two static text crops appear comparably readable, but motion quality,
source-age clock uncertainty, exact-window resources and all 30-second static
samples remain incomplete. One RustDesk static capture lasts about 19 seconds
and does not satisfy the contract. No resource or bandwidth parity is claimed.
Raw captures, source inputs, process identities and failed attempts live in the
task's `v37-paired-20261012` evidence set; it is an interim record, not completed
three-round acceptance.

## udesk26 Published Candidate

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

The control Mac automatically locks before the second RustDesk half. Native
window actions require manual unlock; bounded samplers have already ended. The
operator-authorized SSH password remains only in the isolated Desktop state
pending test completion and must be removed afterward. No credential is recorded in evidence. Thirty-six copied source and host
resource files pass SHA-256 readback after each scene ends; initially copied live
source tails remain separately identifiable.

Offline probes use the same synthetic scene pixels and the installed private
media interpreter. x264 ultrafast/veryfast/fast P50 encoding is
4.54/12.47/29.41 ms, with P95 10.34/18.46/67.45 ms. Slower presets therefore
need presentation evidence rather than a blind replacement. PNG compression
levels 1/6 encode identical pixels in 30.38/42.39 ms and produce
416236/335415 bytes. This approximately 19% byte reduction costs processing
time and does not itself resolve interactive full-frame refinement overhead.
No production encoder or transport behavior changes during these probes. This interim record does not complete three alternating pairs.

# Evidence

- [Orange functional deployment and recovery](remote-desktop-orange-viewer-results.md): candidate identity and functional boundaries.
- [RustDesk official release](https://github.com/rustdesk/rustdesk/releases/tag/1.5.0): baseline source and artifact digests.
- `internal/codeapp/appserver/remote_desktop_viewer/viewer.js`: displayed image, lock authority and input paths.
- `desktop/src/main/windowTransport.ts`: Desktop window transport lifecycle.
