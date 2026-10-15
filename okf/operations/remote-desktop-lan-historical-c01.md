---
type: Qualification Record
title: Historical LAN desktop crossover C01
description: Compare complete v40, v42 and v47 active desktop paths with fixed current conditions and retain preparation failures.
tags: [desktop, performance, experiments]
timestamp: 2026-10-15T03:00:00Z
---
# Summary

The primary qualification task owns C01. The first pass does not reproduce the
historical 51 FPS advantage. Complete the reverse pass before interpreting the
candidate effect. This diagnostic preserves existing security checks and does
not authorize a production downgrade or establish RustDesk parity. Restore the
verified installed service after the crossover; keep all attempts and raw data.
The [decision index](remote-desktop-lan-experiment-ledger.md) owns historical
anchors and the requirement to consult prior experiments.

# Candidate Identity And Conditions

Status: active; first pass complete. Question: does the cadence/tail deficit track
the complete released software candidate when time, viewport and workload are
controlled? Compare H40, H42 and H47 in bounded alternating order, recording
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

VP9 and AV1 were confirmed in the actual Viewer statistics. Decoder preference
is not hardware decode proof. v40 service PID 894017, Runtime 896221, bridge
896395 under privileged SSH ancestor 896346; Mac Electron 59313. v42 service
898306, Runtime 893624, bridge 898706 under privileged ancestor 898657; Mac
Electron 78161. Sampling roots include the complete process descendants.

# Reverse-Pass Invalid Attempts

v42 r2 captured no source inputs or decoded markers after a user-window-change
interruption; its tap reports 45 top-window mismatches. Retry1 had 90/90 source
inputs, zero motion-frame matches, and the bounded 180 s capture ended before
completion. The scene's motion state was not visually confirmed, so it cannot
establish a codec or network failure. v40 r2 selected the retired v42 window ID
and was stopped before inputs. v40 retry1 kept the default 1440 x 960 size and
was interrupted mid-batch; it violates geometry and completeness. These are
fixture/operator invalidities, not valid unfavorable product measurements.

A bounded corrected retry must verify 1024 x 720 geometry and visibly moving
scene before starting the unchanged 180 s observer, then begin inputs promptly.
Do not weaken the workload or present partial samples as 100-input evidence.

# Repetition Contract

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

# Evidence

Evidence root B is defined in the decision index. B/`historical-c01/plan.json`,
`reconstructed-identities.json`, source/build/deploy receipts and `v40-runtime-stall.log`
preserve candidate preparation. Per-candidate `r*-analysis.json`, capture JSONL,
source logs, host/client resources and ping logs retain every measured attempt.
The analyzer hash is recorded in the plan; no metric definition changed.
