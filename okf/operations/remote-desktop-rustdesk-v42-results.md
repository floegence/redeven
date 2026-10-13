---
type: Qualification Record
title: udesk26 hardware AV1 RustDesk comparison
description: Inspect published hardware AV1 diagnostics and unresolved acceptance failures before accepting RustDesk parity.
tags: [desktop, performance, qualification]
timestamp: 2026-10-13T14:58:00Z
---
# Summary

The primary physical-desktop qualification task owns these observations.
Published native `v0.22.42` uses Intel VA-API AV1 on udesk26 and substantially
reduces dynamic host CPU relative to the earlier software VP9 candidate.
RustDesk parity remains unaccepted: dynamic P95 latency, presentation gaps,
input-workload idle cost and whole-client memory still fail the comparison.
Three valid alternating pairs and equal-detail quality evidence remain required.
Failed or interrupted trials remain retained and cannot qualify acceptance.

# Contract

The [comparison contract](remote-desktop-rustdesk-comparison-results.md) owns
method, resource accounting, viewport equality and acceptance. These diagnostics
use the same physical 1920 × 1280 output and fixture. Both clients remain small
ordinary windows while the operator uses the Mac. Focus switching is authorized;
an interrupted input batch cannot be counted as completed.

## Published Candidate

Native `v0.22.42` is commit `f86d542a573212b520e85e1aff8632350b205552`, module
`h1:xeoRpEe3U1aqFg4QtAKF63e+NvcXBE+l9/rR6KwGe6o=`. All 545 published module
entries match that commit. Consumer checks use `GOWORK=off`. The remote Runtime
SHA-256 is `0080cc11138154d7185a216ad44d65d7b0471a1edbec70834712b2318e918c85`;
service SHA-256 is
`90c8128093bfb7b85068f573ae44b21f81860246ae978fcbe7454ab6a0a9aed3`.
The candidate selects `vaav1enc`, AV1, Smooth and Host input method.
`prefer-hardware` reports a decoder preference, not proof of hardware decoding.
The control Mac is Apple M5 Pro, Mac17,8.

Candidate window size is 1024 × 720 and RustDesk is 1024 × 710 logical pixels.
Calibrated marker pitch is approximately 28.333 screenshot pixels; marker left
edges differ by one screenshot pixel. That observation alone does not establish
equal content extents or detail quality. RustDesk retains its official 1.5.0
binary, direct LAN route, AV1/I420, 100% custom quality and 60 FPS target.

## Presentation Diagnostics

The first complete diagnostic pair matches all 100 inputs in each workload.
It is insufficient for three-pair acceptance and fails dynamic tail latency.

| Product | Idle P50 / P95 ms | Motion P50 / P95 ms | Presented FPS | Motion gaps >250 ms |
| --- | --- | --- | --- | --- |
| Redeven | 99.76 / 136.54 | 127.62 / 368.47 | 35.39 | 4 |
| RustDesk | 114.09 / 142.98 | 140.89 / 165.04 | 33.86 | 0 |

The second candidate motion attempt includes ten focus clicks in addition to
100 spaces. It matches 108/110 total inputs and 99/100 spaces, with P50/P95
150.27/432.22 ms, maximum 994.67 ms, 37.22 FPS and five gaps over 250 ms.
It is diagnostic failure evidence, not a clean 100-input acceptance workload.
Unmatched expected sequences are 56 (click) and 60 (space). Earlier expired
scenes, coalesced input batches and incomplete focus changes remain invalid.

## Complete Product Resources

Host candidate roots include Runtime, service and the SSH ancestor/bridge.
Client candidate root includes Desktop, its launcher and Env App, local Runtime,
GPU, renderers, model source and SSH descendants. RustDesk uses its complete
task-owned service/client trees. No resource subtraction replaces these costs.

| Product / motion | Host CPU % | Host RSS P95 MiB | Client CPU % | Client RSS P95 MiB | Client footprint P95 MiB | LAN Mbps |
| --- | --- | --- | --- | --- | --- | --- |
| Redeven | 129.77 | 543.86 | 31.48 | 737.56 | 1144.25 | 4.011 |
| RustDesk | 263.20 | 540.08 | 50.76 | 195.78 | 546.74 | 4.424 |

The idle input workload costs 60.25% host CPU and 0.331 Mbps for Redeven,
versus 6.47% and 0.0177 Mbps for RustDesk. Candidate/client CPU is 9.22%,
versus 6.05%. Independent unchanged-idle candidate diagnostics are approximately
2.7% host and 5.4% client CPU; those observations cannot replace the input
workload or establish paired parity.

## Unresolved Diagnosis

First candidate motion ping median/P95 is 15.95/190.25 ms; baseline is
7.53/22.02 ms. Candidate motion TCP median/P95 RTT is 20.12/73.69 ms and
maximum sampled send queue is 58,468 bytes. Baseline is 9.17/14.42 ms and
34,990 bytes. The task SSH master is verified by its local process ancestry
and remote peer; evidence-collection SSH is excluded from product roots.
The physical source draw cadence has median 16.66 ms, P95 18.42 ms and
maximum 52.41 ms. These observations locate deficits after source drawing but
do not isolate encoding, Wi-Fi, transport or presentation as the sole cause.
An earlier `IPQoS=none` trial also stalls and does not establish a fix.

A later GPU memory map shows a 542.4 MiB physical footprint, including about
319.5 MiB resident IOSurface allocations, after repeated Viewer trials.
The Desktop compositor budget is a hypothesis requiring controlled comparison;
removing its existing Workbench behavior without evidence is not a remedy.
Decoder frame closure is present in the published player. Memory ownership and
actual decoder behavior remain unresolved.

# Evidence

- Task-owned `redeven-udesk26-rustdesk-baseline/published-v42-paired`: raw pixels, inputs, source events, TCP counters, failed preparations and combined `resources-three-rounds.json` diagnostic output.
- `r1-redeven-idle-retry8`, `r1-redeven-motion-retry1`, `r1-rustdesk-idle-retry1`, `r1-rustdesk-motion-retry1`: complete first diagnostic workloads.
- `r2-redeven-motion-retry2`: unmatched input and dynamic-tail failure evidence.
- [Native v0.22.42 release](https://github.com/floegence/floe-native-apps/releases/tag/v0.22.42): immutable candidate source.
- [v0.22.42 qualification](https://github.com/floegence/floe-native-apps/actions/runs/38382529287): release qualification passes.
- `desktop/src/main/sshTransportManager.ts`: task-owned SSH transport authority.
- `desktop/src/main/main.ts`: Desktop compositor memory policy.
