---
type: Qualification Record
title: Published LAN C05 outcomes and unresolved boundaries
description: Inspect every retained v48 paired result, source-loss failure and resource/detail limit before another controlled experiment.
tags: [desktop, performance, experiments]
timestamp: 2026-10-15T13:00:00Z
---
# Summary

The primary qualification task owns C05 outcomes. The released six-frame path
restores the ability to exceed 51 FPS while retaining later fixes, but does not
restore the historical three-round stability or qualify complete RustDesk parity.
All complete adverse trials count. Source-input loss invalidates ordinal latency
association; missing presentation with all source inputs remains a valid failure.
The [comparison contract](remote-desktop-rustdesk-comparison-results.md) owns
acceptance and [C05 preparation](remote-desktop-lan-published-c05.md) owns immutable
identities, controls, release checks and compatibility. Retry only a named fixture
repair or a new discriminating hypothesis, after consulting the decision ledger.

# Retained Presentation Results

All rows use the same post-reboot host, physical 1920 x 1280/60 Hz scene v8,
small ordinary windows and approximately 1020 x 680 logical content viewports.
RustDesk uses official 1.5.0, direct LAN, Auto AV1, custom 100%, 60 FPS. Redeven
uses native v0.22.48, consumer `20bc99cb4`, Smooth/Host input and AV1/I420.
Pairs alternate RustDesk then Redeven, with one active encoder. The separate
Flowersec task and temporal/background differences remain disclosed limits.
Each row has 100 local and 100 independently counted source inputs.

| Pair/product | Idle P50/P95 ms | Motion P50/P95/P99 ms | Presented responses | Unique FPS | Gaps >250 ms / maximum ms |
| --- | --- | --- | --- | --- | --- |
| 1 RustDesk | 108.17/133.74 | 135.06/182.43/227.04 | 100/100 | 31.26 | 1 / 376.03 |
| 1 Redeven | 100.58/168.37 | 111.54/444.33/902.78 | 99/100 | 35.98 | 9 / 1264.14 |
| 2 RustDesk | 97.74/116.90 | 130.85/830.98/1681.42 | 98/100 | 32.24 | 1 / 384.70 |
| 2 Redeven | invalid source loss | 123.82/158.46/241.98 | 100/100 | 49.60 | 0 / 185.18 |
| 3 RustDesk | 98.19/106.31 | 124.17/191.92/272.44 | 100/100 | 34.12 | 1 / 253.77 |
| 3 Redeven | 99.29/178.35 | 125.39/150.20/229.15 | 100/100 | 53.04 | 0 / 153.78 |

Motion means are 46.205 FPS for Redeven and 32.541 for RustDesk (+42.0%).
Pooled observed-response P50/P95/P99 are 123.01/310.60/534.64 ms for Redeven
and 131.23/207.59/1343.09 ms for RustDesk. There are 299/300 versus 298/300
presented responses; report missing responses separately from the observed-only
percentiles. Redeven's nine long intervals all occur in its adverse first round.
Historical v40 produced 51.14/51.30/50.53 FPS with zero such intervals. Current
round three recovers that cadence and tail range, but three-round recovery fails.
C04's 16.7% controlled four-to-six-frame gain supports adoption, not a claim that
capacity is the sole regression cause. Later two good rounds do not erase round one.

# Fixture Validity And Source Failure

The first Redeven motion attempt has 45 tapped local inputs and 58 outside events
after the operator moved its window; preserve and exclude the whole attempt.
Its named complete retry has all 100 source inputs and one unpresented response,
so it remains an adverse valid performance trial, including a 1025 x 721 outer
window deviation. The second idle attempt also moved and is retained incomplete.
The revised passive observer reacquires the exact permitted window's bounds on
each mouse event and excludes titlebar gestures. It changes input scope only;
clock, sequence decoding and latency formula are unchanged. It is used for both
products in pair three. Any resizing still invalidates capture calibration.

The second Redeven idle retry has 100 local clicks but only 99 measured source
inputs (100 including preparation), with no outside/top-mismatch events. The
lost event's identity is unknown. Its ordinal latency values are invalid and
must not enter acceptance or a pooled percentile. Do not replace this unfavorable
complete input trial. Deterministic cause remains unresolved; no proven production
fix follows merely from counting the loss. The first and third idle results
remain valid, with higher P95 than their paired RustDesk observations.

RustDesk third idle has complete source/presentation evidence, but its host
resource sampler exits before output creation because a recorded session PID
has exited. Retain latency evidence and mark host resources unavailable. Later
resource samplers use verified stable service root 12123 and its descendants;
the renewed server 26612 was already below that root. The third RustDesk static
attempt lasts only 37 seconds and fails the 40-second minimum. One named static
retry completes 44 seconds after the last Redeven quality interval; disclose
this delayed resource order. Both raw intervals remain retained. These fixture
failures do not invalidate complete unrelated motion trials.

# Resources And Delivered Detail

CPU is percent of one core. Whole-tree client RSS/footprint includes Desktop,
Env App, disconnected Viewer windows and task Runtime/SSH, with no subtraction.
No missing-cleanup leak was proven: disconnect closes the player/decoder, frame
images, audio, observer and transports; retained application surfaces remain an
explicit workload difference. Do not relabel the footprint as isolated Viewer RAM.

| Motion pair/product | Host CPU % | Host RSS P95 MiB | Client CPU % | Client RSS/footprint P95 MiB | LAN send Mbps |
| --- | --- | --- | --- | --- | --- |
| 1 RustDesk | 189.08 | 499.25 | 45.62 | 294.58/521.52 | 3.598 |
| 1 Redeven | 115.99 | 492.91 | 28.59 | 1177.39/1299.62 | 3.722 |
| 2 RustDesk | 249.72 | 521.05 | 44.39 | 305.11/523.28 | 4.205 |
| 2 Redeven | 130.67 | 500.29 | 32.78 | 1186.47/1424.26 | 4.799 |
| 3 RustDesk | 255.61 | 515.49 | 42.40 | 290.31/514.64 | 4.371 |
| 3 Redeven | 130.33 | 494.18 | 30.26 | 1206.30/1433.51 | 4.908 |

Static host/client CPU is RustDesk 3.27/1.96%, 3.32/2.01%, 3.77/2.28%, versus
Redeven 6.59/4.94%, 8.64/4.46%, 10.16/4.83%. Each accepted interval lasts about
44 seconds. Candidate static LAN sends 0.016-0.017 Mbps versus approximately
0.000064 Mbps for RustDesk. Candidate lower moving CPU does not qualify static
or client-memory parity. Each machine's resource crop uses its own source or
input clock; no cross-host timestamp subtraction is introduced.

All six moving quality sets contain ten exact matching source frames. Text PSNR
is RustDesk 13.90/13.91/13.92 dB versus Redeven 13.25/13.87/13.89 dB; color is
21.02/21.01/21.00 versus 16.15/20.76/20.74 dB. OCR source/delivery similarity
is approximately 0.968-0.990 and 0.967-0.988. These are diagnostic metrics after
the same viewport/Lanczos normalization. Fractional compositor rasterization,
round one's one-pixel geometry deviation and imperfect source OCR limit detail
inference. The first color deficit remains unexplained; no equal-detail or
perceptual parity claim is justified from PSNR/OCR alone.

# Decisions And Retry Conditions

Adopt the optional negotiated six-frame Linux path with published v48; keep
legacy/macOS four-frame behavior and unsupported Windows physical capture
unchanged. Do not increase rate, change codec, weaken confirmed-paint/input
fences or expand queues to conceal residual tails. C01/C02/C03 rejected hypotheses
remain rejected; M03 requires matched detail evidence before another rate trial.

Before another performance run, retain the present complete three-round baseline
and preregister one discriminating variable. For the input loss, instrument local
pointer dispatch, Runtime command acceptance, native injection and source events
with an explicit association that survives missing input. For the first-round
tail, correlate capture/encode, accepted write, encrypted transport, decode and
confirmed paint with bounded clock uncertainty; outbound stalls alone cannot
isolate SSH/kernel/network/client scheduling. For memory, compare one fresh
Viewer lifecycle with equal open surfaces and complete process attribution while
continuing to report whole-tree costs. Require matched static/color detail before
adopting any quality change. A further unchanged run is not a diagnosis.

# Evidence

All paths below are relative to B/`published-v48-paired`. The durable copy is
`/Volumes/JianDisk/.codex-cc/artifacts/redeven-lan-performance-20261014/published-c05-20261015`.

- `input-audit-and-pooled.json` and `audit-c05.py`: independent source counts, observed response percentiles, invalid fixtures and every motion trial.
- `resources-three-rounds.json` and `resources-final.log`: complete lineages, intervals, CPU, RSS, footprint and route counters.
- `quality-summary.json` and six `*-quality-quality-analysis/results.json` sets: raw screenshots, exact references, resampling and OCR.
- `c05-fixture-deviations.jsonl`, `r2-player-state.json` and `observer-c05-build.log`: fixture repairs, selected six-frame state and compiler output.
- `local-cleanup.json` and `remote-cleanup.json`: removed temporary credentials/options, closed test listeners and retained verified published service.
