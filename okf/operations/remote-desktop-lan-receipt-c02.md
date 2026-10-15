---
type: Qualification Record
title: Confirmed presentation receipt crossover C02
description: Inspect the zero-wait receipt diagnostic, its negative recovery result and the independently verified input association failure.
tags: [desktop, performance, experiments]
timestamp: 2026-10-15T06:00:00Z
---
# Summary

The primary qualification task owns C02. Removing the current 50 ms receipt
wait did not recover historical throughput or demonstrate a latency benefit.
Keep the published implementation. The final restored-A trial also exposed a
missing source input, which makes its ordinal latency pairing unreliable after
the loss. Retain that adverse trial; do not retry it away or silently remap it.
No production code changed. Exact A Runtime bytes and the published service
were restored through the normal hash-authorizing manager. Historical recovery
and RustDesk parity remain unproven. The
[decision index](remote-desktop-lan-experiment-ledger.md) owns acceptance and
the requirement to consult prior experiments before another run.

# Hypothesis And Identity

Predeclared on 2026-10-14 PDT after reading C01 and transport T02/P02: does
local receipt batching contribute to exhausted frame credit? Compare A1/B1/A2,
100 local clicks each. A is consumer
`56b7275da340431c9c50ad8fed49c9b779983942`, native v0.22.47 (`99fa004`). B
changes only the embedded player expression `const delay = 50 -` to
`const delay =  0 -`. One byte differs at expression offset 55190752.

| Artifact | SHA-256 |
| --- | --- |
| A Runtime | `0ef0cde6d254fd11f4114fbbefad9655b02de26f1935ab7650d31a0a97541ce7` |
| Legal B Runtime | `13cb366a7a2ce516c9da5a80fd0074d72d68a0cebb3691b332ced61e62d70314` |
| Restored A installed digest | `22ff228dc02a0525aa5c320b03627e0c6bf836dfb825d9df479d0ca14fce4381` |
| B installed digest | `c16d3b6bd548198bca45e730ffbbe28879dd9e0972413e76547c5e1011c7d3a4` |

This embedded-resource overlay is diagnostic, not a published build. Confirmation
after RAF/task, cumulative receipts, generation/order fences, four credits,
media bytes, quality, transport, input and security fixes stay unchanged. The
privileged manager explicitly authorizes each Runtime hash; no integrity check
is bypassed. A/B/A uses the same unique-ID client wrapper and isolated profile.

# Controls And Validity

Use udesk26 physical 1920 x 1280 at 60 Hz, scene v8 allocation 1152 x 768,
1024 x 720 ordinary Viewer, Smooth, Host input and 2048 MiB compositor budget.
Confirm moving pixels before the unchanged bounded 180 s observer. The intended
450 ms wait is additional to native click/tool overhead; actual event timestamps
define measured intervals. Two 50-click batches have an inter-call pause.
No build, package transfer or second encoding session runs during sampling.
Read the experiment entry and T02 before each phase. Idle historical Runtimes
remain disclosed background work during all phases; no causal claim is made
about them. Delivered-detail parity is not newly qualified.

Initial A1 was interrupted by the computer-use app-change check (7 local inputs,
6 matches); retain it as an incomplete fixture, replaced by its complete retry.
B preparation initially used `50 -> 00`, an invalid strict-mode JavaScript
literal. Its blank Viewer had no observer or measured input. Preserve that
invalid provenance, restore A, then use the legal one-byte replacement and
parse-check it. The valid B run uses only the corrected identity above.
The first A2 was interrupted after 50/50; its 44.65 FPS/P95 159.94 ms/zero gaps
is diagnostic only. A2 retry1 completes all 100 local inputs and counts below,
including the observed input failure. An adverse complete result is not a
fixture invalidity and does not authorize another favorable-result search.

# Results And Decision

| Phase / raw name | Local / source inputs | FPS | P50 / P95 / max ms | Gaps >250 ms / max gap ms |
| --- | --- | --- | --- | --- |
| A1 / `r1-redeven-motion-retry1` | 100/100 | 37.74 | 135.80 / 283.54 / 560.27 | 3 / 349.92 |
| B1 / `r2-redeven-motion` | 100/100 | 39.60 | 144.28 / 346.19 / 581.20 | 1 / 295.40 |
| A2 / `r3-redeven-motion-retry1` | 100/99 | 44.22 | Ordinal output 113.41 / 713.36 / 737.37; affected by source-input loss | 0 / 140.51 |

A2's tap reports 100 local clicks, zero outside-window events, zero top-window
mismatches and no capture errors. The scene logs 100 total inputs including one
preparation click, leaving 99 measured inputs. Source sequences 72 -> 73 have a
1201.52 ms gap while local events continue about 600 ms apart. From expected
sequence 73 onward, ordinal pairing assigns subsequent responses to earlier
local inputs. The missing sequence label 101 is a count consequence, not proof
that the last click was lost. Do not interpret the 713.36 ms aggregate as a
qualified end-to-end P95, and do not replace it with a favorable truncated P95.
Input loss is a real unresolved outcome; its owner is not isolated. A separate
source audit confirms all six C01 rounds and C02 A1/B1 have 100 source inputs.
This concrete A2 association defect does not invalidate the historical anchors
or explain the historical cadence deficit.

Reject zero-wait B as an established recovery or release candidate. Its FPS
remains below 40, its P95 is worse than A1, and restored A has higher cadence.
One B round cannot estimate a precise interval effect, and the A2 input defect
limits latency comparison. The experiment disproves neither all credit issues
nor return-path delay; it supplies no evidence that removing the 50 ms wait
alone is sufficient. Preserve the traffic reduction and all later fixes.

| Phase | Host CPU % | Client CPU % | Client RSS P95 MiB |
| --- | --- | --- | --- |
| A1 | 114.99 | 31.38 | 1094.88 |
| B1 | 121.88 | 38.24 | 1032.50 |
| A2 | 123.31 | 32.68 | 1097.98 |

100% is one core. Resource intervals use each host's own clock and source
sequence bounds; A2's host interval ends at its last actual input plus 600 ms.
Exited-process CPU is a lower bound and RSS includes shared pages. These samples
do not qualify memory, detail or network parity. Exact process roots and route
counters remain in the raw resource receipt, without subtraction of idle work.

# Unresolved Questions And Retry Conditions

Historical recovery still requires repeatable approximately 51 FPS, historical
tail/gap behavior, complete input delivery and matched delivered detail while
retaining current fixes. C01's two observations per candidate and order deviation
cannot identify a regression commit. Prior stage traces narrow some stalls to
publication/confirmed-credit return, but do not separate capture cadence,
carrier queues, local event scheduling and network recovery.

Before another receipt trial, obtain new timing evidence separating confirmed
paint, receipt scheduling, carrier send/arrival and credit release in one clock
domain per segment. Repeating this unchanged A/B/A is not justified. Before
using ordinal latency on any run with missing source inputs, establish explicit
event association or fail its latency qualification while preserving cadence
and input-loss evidence. An input diagnostic must distinguish local dispatch,
remote injection and scene receipt; it must not silently shift sequence labels.
The separate 3M/QP160 candidate remains unresolved in M03 until matched moving
quality and repetitions justify its rate/detail tradeoff. Do not sweep presets
or repeat rejected transport variants without new discriminating evidence.

# Evidence

Evidence root B is defined in the decision index. Durable copies are under
`/Volumes/JianDisk/.codex-cc/artifacts/redeven-lan-performance-20261014/crossover-20261015`.

- B/`receipt-c02/plan.json`, `control.py`, `runner.py`, `restart-client.py`,
  remote provenance/deploy/installed receipts and `invalid-leading-zero` retain
  preparation identities and failures.
- B/`receipt-c02/v47`: unchanged analysis outputs, capture JSONL, independent
  scene events, process resources and ping data for every measured attempt.
- B/`crossover-input-audit.json` and `audit-crossover-inputs.py`: independent
  source-count audit; B/`receipt-c02/v47/resources-c02.json` records resources.
- [C01](remote-desktop-lan-historical-c01.md),
  [transport T02/P02](remote-desktop-lan-transport-experiments.md) and
  [codec M03](remote-desktop-lan-codec-experiments.md) supply prerequisites and
  remaining controlled questions.
