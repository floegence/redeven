---
type: Qualification Record
title: Historical LAN desktop crossover C01
description: Compare complete v40, v42 and v47 active desktop paths with fixed current conditions and retain preparation failures.
tags: [desktop, performance, experiments]
timestamp: 2026-10-15T03:00:00Z
---
# Summary

The primary qualification task owns C01. Six valid rounds are complete. The
latest v40 sample approaches historical throughput; the historical three-round
advantage is not recovered. Candidate effects remain confounded by time/order.
This diagnostic preserves existing security checks and does not authorize a
production downgrade or establish RustDesk parity. The verified current service
was restored after diagnostics; all attempts and raw data are retained.
The [decision index](remote-desktop-lan-experiment-ledger.md) owns historical
anchors and the requirement to consult prior experiments.

# Candidate Identity And Conditions

Status: two valid rounds per candidate complete; order deviation declared.
Question: does the cadence/tail deficit track the complete released
software candidate when time, viewport and workload are controlled? Compare H40,
H42 and H47 in bounded alternating order, recording
immutable Runtime, service, worker, media and client bundle identities. Merely
forcing VP9 in H47 does not recreate H40. A mixed old-service/new-client path is
a separate diagnostic, never a complete historical candidate. C01 reconstructs
the active client/remote Runtime/native path from committed H40/H42 sources and
their frozen locks. Original H42 Runtime advertised `2bc640c19a72`; the rebuilt
candidate uses committed adoption `65ba364fa`, so it is not a byte-identical
replay. Unused auxiliary bundle helpers stay fixed at v47 bytes; no whole-product
resource qualification can be inferred. Plan and build receipts are under
B/`historical-c01`. Predeclared order is 47/40/42 then 42/40/47, 100 clicks per
motion run. Compilation and package transfers must finish before input sampling.

First v47 attempt was interrupted by CUA's user-app-change check (28 observed
inputs, 27 matches); it is retained and invalid for the 100-input workload.
Retry1 was aborted before inputs because a package transfer was still active;
it supplies no latency result. Retry2 addresses these named preparation failures.

# Preparation And Validity

v47 retry2 is valid. The v40 wrapper first failed an aggregate Runtime-file
manifest digest check. Regenerating the inventory digest fixed the fixture;
validation itself remained unchanged. Group-writable preparation directories
also correctly failed admission, then task-owned directories were set to 0700.

The first v40 launch clicks targeted a widget outside the visible Workbench
viewport. They did not establish a failed desktop connection. A Runtime stack
was retained and the isolated Runtime/client restarted during diagnosis; the
final visible-widget click connected immediately. A stale local Runtime and
model-source remained idle after the client restart and are included in sampled
Mac roots. Background idle test Runtimes are a limitation, not a demonstrated
performance cause. No package transfer or build ran during measurement.

# Valid Rounds

| Sequence | Inputs / matched | FPS | P50 / P95 / max response ms | Gaps >250 ms / max gap ms |
| --- | --- | --- | --- | --- |
| v47 r1 retry2 | 100/100 | 44.60 | 103.07 / 135.88 / 239.31 | 0 / 176.72 |
| v40 r1 | 100/100 | 42.77 | 112.92 / 212.21 / 449.86 | 1 / 283.30 |
| v42 r1 | 100/100 | 41.73 | 123.49 / 300.15 / 447.73 | 1 / 283.03 |
| v47 r2 retry1 | 100/100 | 41.22 | 111.81 / 150.46 / 651.36 | 1 / 279.77 |
| v42 r2 retry2 | 100/100 | 47.86 | 124.51 / 188.15 / 347.67 | 0 / 166.54 |
| v40 r2 retry2 | 100/100 | 49.53 | 134.18 / 161.60 / 214.13 | 0 / 120.70 |

VP9 and AV1 were confirmed in the actual Viewer statistics. Decoder preference
is not hardware decode proof. v40 service PID 894017, Runtime 896221, bridge
896395 under privileged SSH ancestor 896346; Mac Electron 59313. v42 service
898306, Runtime 893624, bridge 898706 under privileged ancestor 898657; Mac
Electron 78161. Sampling roots include the complete process descendants.

# Reverse Pass Validity And Order

| Attempt / evidence prefix | Named invalidity and disposition |
| --- | --- |
| v42 `r2-redeven-motion` | App-change interruption; no source inputs or markers, 45 top-window mismatches. Exclude the whole attempt. |
| v42 `r2-redeven-motion-retry1` | 90/90 source inputs, zero motion-frame matches; 180 s capture expired before completion, moving state not visually verified. Fixture failure, not codec/network evidence. |
| v40 `r2-redeven-motion` | Retired v42 window ID selected; stopped before inputs. |
| v40 `r2-redeven-motion-retry1` | Default 1440 x 960 size and mid-batch interruption; geometry/completeness fail. |
| v47 reverse preparation | Simulated password typing omitted its final character; authorized complete paste authenticated, then exposed a stopped task Runtime. No scene or measurement started; no performance result. |
| v47 `r2-redeven-motion` | Correct 1024 x 720, Smooth/Host input and visible AV1 motion; app-change interruption at 58 local inputs/57 matches. Its 37.19 FPS/P95 242.92 ms is partial diagnostic only. |

Every invalid attempt is retained. Corrected retries verify geometry and moving
scene first, then start the unchanged observer and promptly begin all 100 inputs.
No valid unfavorable result is replaced. The corrected v47 r2 occurred before
valid v42/v40 retries: actual valid order is 47/40/42/47/42/40, deviating from
predeclared 47/40/42/42/40/47. This is not perfect counterbalancing.

v47 r2 retry1 uses window 71035 at 1024 x 720 and the same published identities.
The maximum 651.36 ms response remains in the valid result. Host roots
909942/921525/923326 and Mac roots 51439/18967 cover service, Runtime, SSH and
descendants. v42 r2 retry2 verifies frozen-wrapper dist byte equality, window
71570, Smooth/Host input and moving frame 1386; roots 932384/931976/934643 and
Mac 71847 cover the active paths. v40 r2 retry2 verifies the same controls,
window 71670 and moving frame 1689; roots 937398/936959/937756 and Mac 16283.
No build, package transfer or second encoding session ran during valid repeats.
Some inactive Mac clients survived SIGTERM; idle Runtimes also remained. They
are disclosed background limitations, not a demonstrated cause. Task clients
and C01 remote Runtimes were stopped after C02, and temporary credentials
removed. The exact current service/Runtime restoration is recorded in C02.

# Contract

Hold physical/source dimensions, display refresh, scene version, exact content
viewport, compositor budget, Host input mode and workload constant. Record
negotiated codec/rate, client decoder observation, all Runtime/bridge/SSH roots,
route, background work and network counters for each run. Only one encoding
session may run. Do not tune settings between repetitions. Keep clients in small
ordinary windows. Preserve every attempt and validity reason. Use unchanged
measurement/calibration code and complete source matching. A repeat needs either
completion of this planned alternating sequence or a named invalidity, never an
unfavorable valid result. Subsequent component isolation depends on its outcome.

Historical packages are comparison fixtures only. Any selected production change
must retain later fixes and pass current focused contracts and published-artifact
qualification; do not downgrade the product as a performance remedy.

# Boundaries

All six valid rounds count. FPS means are v40 46.15, v42 44.80 and v47 42.91;
two observations per candidate and the order deviation are insufficient for a
causal effect estimate. The late v40 result (49.53 FPS/P95 161.60 ms/zero gaps)
approaches the old throughput and latency range, but its first round is weaker.
The corresponding current second round is 41.22 FPS/P95 150.46 ms/one gap.
There is no basis to discard either valid result or call the current path optimal.

C01 does not support a codec-only or Wi-Fi explanation. The follow-on
question was whether the current 50 ms confirmed-receipt batching contributes
to credit waits. P02 traces support the interval-only C02 A/B/A diagnostic,
which retains confirmation, fences and all later fixes.
C02 subsequently found no established recovery from removing that wait; see its
[full decision and input association limits](remote-desktop-lan-receipt-c02.md).
Historical capture ROI cell widths 14.2 versus 14.167 imply only 0.23% scale
change. Window outer widths differ by 256, while marker origins differ by 127.5:
most extra width is letterboxing. Geometry alone has no causal support for the
cross-time 24% FPS deficit. Raw-pixel detail equivalence remains unqualified.

# Evidence

Evidence root B is defined in the decision index. B/`historical-c01/plan.json`,
`reconstructed-identities.json`, source/build/deploy receipts and `v40-runtime-stall.log`
preserve candidate preparation. Per-candidate `r*-analysis.json`, capture JSONL,
source logs, host/client resources and ping logs retain every measured attempt.
The analyzer hash is recorded in the plan; no metric definition changed.

The durable `crossover-20261015` artifact archive retains every C01 attempt.
Its independent `crossover-input-audit.json` verifies all six accepted C01 rounds
have 100 measured source inputs, with no capture error. The C02 association
defect is therefore not evidence against these complete historical comparisons.
