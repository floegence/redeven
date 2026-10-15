---
type: Qualification Record
title: LAN desktop experiment decision ledger
description: Consult historical winners, rejected hypotheses and retry conditions before another LAN performance experiment.
tags: [desktop, performance, experiments]
timestamp: 2026-10-15T02:00:00Z
---
# Summary

The primary desktop qualification task owns this ledger. RustDesk parity and
recovery of the historical three-round performance remain unproven. Published
v0.22.40 delivered about 51 presented FPS; v0.22.42 also delivered 50.53 FPS with
hardware AV1. The v0.22.47 baseline lowers CPU but has weaker measured tails and cadence.
Published v0.22.48 recovers a 53.04 FPS round, but not three-round stability. Cross-time observations establish a deficit, not its cause.
Preserve current security, authorization, input, ordering and recovery contracts.
Diagnostics cannot qualify a release. Restore the verified installed service
after a diagnostic; retain invalid attempts and explain their exclusion.

# Contract

Before each experiment, read this index and the relevant
[codec/capture ledger](remote-desktop-lan-codec-experiments.md) or
[transport ledger](remote-desktop-lan-transport-experiments.md). Record a new ID,
the unresolved question, changed variables, candidate identities, controls and
retry boundary before deployment. Update the same entry after analysis. An old
failed hypothesis requires new discriminating evidence before another run.

The [comparison contract](remote-desktop-rustdesk-comparison-results.md) owns
acceptance and measurement semantics. This ledger records decisions; it does
not replace that contract. Performance, quality, CPU and memory are separate
axes. Neither lower CPU nor a panel peak can substitute for complete presented
latency, unique FPS, gaps, source matches and delivered-detail evidence.

Evidence root `B` is `/private/tmp/redeven-udesk26-rustdesk-baseline`.
Durable C01/C02 copies and scripts are under the artifact archive
`redeven-lan-performance-20261014/crossover-20261015`, with checksums.
All dates below refer to the 2026-10-11 through 2026-10-14 PDT campaign unless
specified. Missing exact consumer hashes or timestamps remain unknown, not
inferred from a directory name. Original scripts and receipts under B retain
the diagnostic build parameters. No credentials belong in this ledger.

# Historical And Current Anchors

All rows use udesk26 physical 1920 x 1280 at 60 Hz, scene v8 and source allocation
1152 x 768. The older v40 windows were 1280 x 721; later candidate windows were
1024 x 720. Unequal content extents and sampling at different times prevent
causal or equal-detail claims from these aggregates alone.

| ID / candidate | Identity and conditions | Valid presentation results | Decision and raw evidence |
| --- | --- | --- | --- |
| H40 / native v0.22.40 | `eeddccc4a3b42e126e82406628705e2a0715541b`; consumer `c4a0f10a9827`; VP9/I420, Smooth, Host input | Three 100/100 rounds: FPS 51.14/51.30/50.53; P95 168.10/157.15/149.47 ms; zero gaps >250 ms each | Historical throughput/stability anchor, not full parity. Host CPU about 300-308%; client RSS 1.05-1.07 GiB. B/`published-v40-paired`, round 3 `r3-redeven-motion-retry1`; plan `published-v40-comparison-plan.json` |
| H42 / native v0.22.42 | `f86d542a573212b520e85e1aff8632350b205552`; consumer adoption `65ba364fa`; hardware AV1, Smooth, Host input, GPU budget 2048 MiB | Second complete motion round: 100/100, P50/P95 107.33/206.38 ms, 50.53 FPS, one gap. First pair: 35.39 FPS/P95 368.47 ms/four gaps | AV1 is capable of the historical cadence; repeatability unresolved. Host CPU 145.47%, client 35.70%, LAN 4.885 Mbps in stronger round. B/`published-v42-paired/r2-redeven-motion-retry8-analysis.json`; [full record](remote-desktop-rustdesk-v42-results.md) |
| H43 / native v0.22.43 | `fdc28b5f7f173f67be170dcb4f7d344abeedfe61`; released idle-cadence fix | Valid replacement moving pair: 100/100, 48.82 FPS/P95 187.54 ms/four gaps | Adopt idle CPU benefit; dynamic parity fails. Earlier mislabeled nonmoving trial invalid. [Full record](remote-desktop-rustdesk-v43-results.md) |
| H47 / native v0.22.47 | implementation `e400c37`, artifact tip `99fa004`; consumer `56b7275da340431c9c50ad8fed49c9b779983942`; AV1, Smooth, Host input | Three 100/100 motion rounds: FPS 43.36/34.62/38.61; P95 166.56/316.12/247.61 ms; gaps 1/1/3 | Current published anchor, not winner. B/`v47-paired/pooled-summary.json`: pooled P50/P95/P99 132.59/247.61/413.00 ms, mean 38.86 FPS, five gaps; RustDesk 131.22/169.11/297.59 ms, 32.29 FPS, one gap |

H47 host CPU is 110-128% and client CPU 24-35%, versus RustDesk 240-270% and
44-45%. Candidate client RSS is 1.08-1.28 GiB versus 311-324 MiB. Candidate LAN
rounds 2/3 are 3.579/3.859 Mbps; round 1 omits the SSH owner and has no complete
LAN claim. Calibrated ten-frame moving sets report text PSNR 12.82 versus 13.10
and color 18.74 versus 20.24 dB, with resampling limits. The invalid RustDesk
third attempt stayed at authentication UI and supplied no source inputs; retain
it, exclude the whole attempt and use its complete retry. All valid rounds count.

# Controlled Historical Comparison

[C01: historical candidate crossover](remote-desktop-lan-historical-c01.md) owns
the matched candidate crossover, fixture validity and all raw rounds.
Two valid rounds per candidate are complete, with a declared order deviation.
FPS pairs are v47 44.60/41.22, v40 42.77/49.53 and v42 41.73/47.86. The late v40
round has P95 161.60 ms and zero gaps, approaching historical performance;
three-round repeatability and causality remain unresolved. Inactive clients and
Runtimes are disclosed background limitations. All valid and invalid trials count
in their proper scope. C02 isolates confirmed-receipt batching in current code
with an A/B/A sequence and unchanged safeguards.

# Confirmed Receipt Comparison

[C02: confirmed receipt crossover](remote-desktop-lan-receipt-c02.md) records the
predeclared A/B/A interval-only diagnostic, exact one-byte artifacts and rejected
preparation fixture. A1/B1 have 100/100 source inputs, 37.74/39.60 FPS and
P95 283.54/346.19 ms. Restored A2 completes 100 local clicks but delivers 99 to
the scene, at 44.22 FPS and zero gaps. Its ordinal P95 is affected by sequence
misassociation after input loss and cannot qualify latency. The full adverse
trial is retained, with no favorable replacement. Zero-wait B is not adopted;
it does not recover the historical cadence. Exact A and the released service
are restored. No production implementation or dependency was downgraded.

# Window Capacity Comparison

[C03/C04](remote-desktop-lan-window-c04.md) retains the rejected exhausted-window
timer candidate and the four/six-frame A/B/A/B comparison. Four-frame controls
produce 45.98/44.66 FPS; six-frame rounds produce 52.30/53.48 FPS with
100/100 inputs and P95 143.13/119.13 ms. Six-frame B1 still has one long gap;
B2 has none. This supports an optional capacity contract, not complete recovery
or RustDesk parity. The [stage record](remote-desktop-lan-stage-tracing.md)
separates outbound timing from confirmed-paint and receipt delays. Native v0.22.48 is published at `2b40002`; release qualification and
published consumer compatibility pass. Performance acceptance remains open. Current security and platform boundaries remain mandatory.

[C05: published qualification](remote-desktop-lan-published-c05.md) predeclares
three alternating pairs, equal content viewports, source-associated inputs,
moving detail and complete resource lineage. It retains release qualification
failures and the udesk26 reboot as preparation boundaries, not performance data.
[C05 outcomes](remote-desktop-lan-c05-results.md) retains three complete motion
pairs: candidate 35.98/49.60/53.04 FPS, pooled observed P95 310.60 ms and nine
long gaps; RustDesk 31.26/32.24/34.12 FPS, P95 207.59 ms and three gaps. The
candidate has one unpresented response and one separate idle source-input loss.
Six-frame throughput is adopted; historical repeatability, source completeness,
static cost, whole-tree client memory and delivered-detail parity remain open.
Do not repeat C05 unchanged; follow the named instrumentation/fixture conditions.

# Boundaries

Historical performance is not restored in the current product. C01's late v40
49.53 FPS/P95 161.60 ms/zero gaps approaches the historical range, while its
other valid round remains weaker. Version, order/time and background effects
are not isolated. Codec choice, Wi-Fi and outer window size are not established
causes. C02 does not demonstrate that removing receipt batching fixes the loss.
The [transport ledger](remote-desktop-lan-transport-experiments.md) owns the
publication/credit evidence and the segment timing needed before another trace.

Keep current security, authorization, input, generation/order and recovery
fixes. Do not release an old package or select a diagnostic peak. Remaining
qualification includes repeatable throughput/tails, exact delivered detail,
client memory, input completeness and paired RustDesk acceptance. C02 owns the
newly verified input association limitation and retry boundaries. The source
count audit verifies all six C01 rounds and C02 A1/B1, so that defect is not a
reason to discard older valid results. M03 requires matched quality evidence before another rate/detail trial.
The archive retains cleanup and restoration receipts. The final GitHub snapshot
for `floegence/floe-native-apps` has zero open PRs and zero open Dependabot,
CodeQL and secret-scanning alerts; this is a dated snapshot, not a future guarantee.

# Evidence

- Handoff: `/Volumes/JianDisk/.codex-cc/artifacts/redeven-lan-performance-20261014/side-history-comparison-20261014.md`; read in full before this ledger was created.
- B/`v47-paired`: all current accepted and invalid raw trials, source logs, captures, `resources-three-rounds.json` and quality receipts.
- [Codec and capture decisions](remote-desktop-lan-codec-experiments.md): rate, quantization, hardware, cadence and shared-output variables.
- [Transport and tracing decisions](remote-desktop-lan-transport-experiments.md): credit, receipt, HTTP2, SSH and stage evidence.
