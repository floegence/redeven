---
type: Qualification Record
title: udesk26 DRM cadence RustDesk comparison
description: Inspect released capture cadence and current dynamic latency, quality and resource deficits.
tags: [desktop, performance, qualification]
timestamp: 2026-10-13T19:18:00Z
---
# Summary

The primary physical-desktop qualification task owns these observations.
Published native `v0.22.43` shortens DRM capture activity after static input,
wakes immediately for the first input and retains full-rate capture during
actual pixel changes. Isolated unchanged-input capture CPU improves. RustDesk
parity remains unaccepted: a fresh moving pair has higher candidate P95 latency,
more long presentation gaps, higher client memory and greater color error.
Three valid alternating pairs remain required. Source events invalidate the
earlier mislabeled candidate motion trial; its lower latency cannot establish
dynamic parity. Failed samples and original receipts remain retained.

# Contract

The [comparison contract](remote-desktop-rustdesk-comparison-results.md) owns
acceptance, accounting, viewport equality and delivered quality. The
[v0.22.42 record](remote-desktop-rustdesk-v42-results.md) owns preceding AV1
observations. Trials retain physical 1920 × 1280, 60 Hz output, source allocation
1152 × 768 and small ordinary windows: 1024 × 720 for Redeven and 1024 × 710
logical pixels for RustDesk. Focus switching and 100-input batches are authorized.
Only one remote encoding session runs in the replacement motion pair and moving
quality samples.

## Published Candidate

Native `v0.22.43` is commit `fdc28b5f7f173f67be170dcb4f7d344abeedfe61`,
module `h1:ueLHN8z9+RIYgARHrQ+DLqhVszVtGsaAm4vko2VGeD0=`. All 545 module
files match that commit. Module zip SHA-256 is
`bd32567b1fd316b2749c98d1f0003bcf555506ec5f03e8664890813424dd80f2`.
Qualification attempt three passes all 13 release jobs. Remote Runtime SHA-256
is `7b53d71e03d605dcc0b20ff02566e426bc76470778cbd3c24ffd584abe2eb49b`;
installed DRM worker SHA-256 is
`6aabbd44bdff870257e958ec207e4f5380fbf9c1ace16e8913f8409a488b5521`.
The candidate uses `vaav1enc`, AV1, Smooth and Host input method.
Decoder `prefer-hardware` is a preference, not hardware-decoding proof.
RustDesk remains the official 1.5.0 direct-LAN AV1/I420 baseline, custom quality
100% and target 60 FPS. Formal consumer checks use `GOWORK=off`.

Two isolated twelve-second unchanged-input DRM worker trials each deliver four
frames. Worker CPU falls from 61.988% to 22.745%. This identifies a capture
improvement, not complete Viewer acceptance. Configure, input and changed pixels
extend the same activity deadline; static capture returns to 5 Hz.

## Valid Dynamic Pair

The replacement pair runs Redeven before RustDesk. Both source logs prove moving
draws and 100 spaces; both observers match all 100 inputs on one Mac clock.

| Product | Motion P50 / P95 / maximum ms | Presented FPS | Gaps >250 ms |
| --- | --- | --- | --- |
| Redeven | 131.34 / 187.54 / 415.33 | 48.82 | 4 |
| RustDesk | 138.37 / 165.90 / 454.40 | 34.10 | 2 |

This pair improves median latency and FPS but fails P95 and long-gap parity.
The earlier RustDesk motion baseline is 124.14/140.46 ms P50/P95, 33.24 FPS
and zero long gaps. Candidate TCP median/P95 RTT is 7.26/11.05 ms, maximum
sampled send queue 42,996 bytes and retransmitted-byte increase 415,800.
The replacement baseline is 9.42/15.05 ms, 35,830 bytes and 332,711 bytes.
These observations do not isolate transport or encoding as the sole cause.

## Complete Dynamic Resources

Candidate host roots include SSH ancestors, Runtime and desktop service.
Client roots include Desktop, open Env App, GPU, renderers, local Runtime,
model source and SSH descendants. Workload intervals follow matching source
sequences using each host's own clock. CPU is percent of one core; RSS includes
shared pages. Physical footprint is retained separately without subtraction.

| Product | Host CPU % | Host RSS P95 MiB | Client CPU % | Client RSS P95 MiB | Client footprint P95 MiB | LAN Mbps |
| --- | --- | --- | --- | --- | --- | --- |
| Redeven | 155.02 | 532.77 | 30.19 | 1072.64 | 786.57 | 4.858 |
| RustDesk | 262.56 | 536.06 | 42.56 | 241.61 | 551.97 | 4.383 |

CPU improves, while client memory and bandwidth remain higher. Earlier static
candidate resources are 6.34% host CPU, 5.12% client CPU and 1138.79 MiB
footprint versus 3.14%, 3.95% and 443.47 MiB for RustDesk. Those candidate host
roots omit Runtime/SSH and retain a different launcher/window state, so they
cannot qualify resource parity.

## Exact Moving Quality

Each replacement quality set has ten snapshots matching exact moving source
frames. Both use the same magic-marker edge fit and fractional Lanczos
normalization to 1920 × 1280.

| Product | Text PSNR dB / RGB MAE | Color PSNR dB / RGB MAE |
| --- | --- | --- |
| Redeven | 12.83 / 25.93 | 18.75 / 14.48 |
| RustDesk | 13.11 / 24.90 | 20.17 / 12.03 |

Candidate errors are greater. Fractional compositor rasterization and viewport
resampling limit these metrics; they alone cannot establish perceptual parity.

## Clarity Diagnostic

The formal Clarity selector provides a diagnostic without an encoder overlay.
`r3-redeven-motion` has 100 matching spaces and a continuously moving source.
It reports 136.82/282.61 ms P50/P95, 479.04 ms maximum, 46.11 presented FPS
and seven gaps above 250 ms. Complete host/client CPU is 143.67%/33.59%,
host RSS P95 is 535.55 MiB, client footprint P95 is 809.56 MiB and LAN send
rate is 9.158 Mbps. Sampled TCP median/P95 RTT is 8.38/17.03 ms.

`r3-redeven-quality` retains ten exact moving matches. Identical calibrated
analysis gives text PSNR/MAE 12.83/25.87 and color PSNR/MAE 18.77/14.05.
Clarity's limited pixel-metric improvement does not compensate for the latency
and bandwidth regression. This is a candidate setting diagnostic, not a new
contemporaneous RustDesk pair or acceptance result. A swatch-interior diagnostic
also finds similar color bias in both products; it does not isolate compression
as the source of the full-image error.

## Hidden Host Renderer Diagnostic

Before the local window adjustment, the task Desktop has three renderer
processes: Env App, application target and the hidden native host document.
The application controller now defers that unused native document's navigation.
The target view continues to own loading and the first DOM-ready presentation.
An isolated, invisible Electron 41.10.7 diagnostic repeats both paths twice:
loading the hidden document adds two renderers; deferring it adds one. Every
target emits DOM-ready and no diagnostic window becomes visible. This verifies
the native API behavior, not whole-client memory or latency parity. A fresh
real-Viewer comparison of the local change remains required.

## Invalid And Incomplete Attempts

`r1-redeven-motion-retry1` matches 100 spaces plus a focus click and reports
88.00/126.62 ms P50/P95, but its source log has zero moving draws. It is invalid
as motion; zero FPS reflects the static source, not an observer failure. Its
host roots also omit Runtime/SSH. The preceding motion attempt times out before
completing input. `r1-redeven-idle` has no input and cannot supply idle latency.
`r2-redeven-quality` matches ten static frame-zero snapshots; its separate static
analysis cannot qualify moving quality.

# Evidence

- Task-owned `redeven-udesk26-rustdesk-baseline/published-v43-paired`: original inputs, pixels, source logs and explicit validity records.
- `r1-redeven-motion-retry2`, `r1-rustdesk-motion-retry1`: complete moving pair and `resources-current-dynamic.json`.
- `r2-redeven-quality-retry1`, `r2-rustdesk-quality`: ten moving matches each and identical calibrated analysis.
- `r3-redeven-motion`, `r3-redeven-quality`: formal Clarity diagnostics, complete resource accounting and retained calibrated quality receipts.
- `blank-host-native-probe.json`, `blank-host-before-processes.json`: invisible native renderer-count diagnostic and preceding task process identities.
- `drm-cadence-v43-module-provenance.json` and `drm-cadence-v43-module-readback.json`: published module identity.
- [Native v0.22.43 release](https://github.com/floegence/floe-native-apps/releases/tag/v0.22.43): immutable candidate.
- [v0.22.43 qualification](https://github.com/floegence/floe-native-apps/actions/runs/38434313176): all jobs pass.
- `internal/codeapp/appserver/remote_desktop_viewer/viewer.js`: Viewer image and input boundary.
- `desktop/src/main/main.ts`: Desktop compositor memory policy.
