---
type: Qualification Record
title: LAN desktop receipt and window comparison
description: Inspect rejected exhausted-window receipts and the controlled four-versus-six-frame comparison before changing admission.
tags: [desktop, performance, experiments]
timestamp: 2026-10-15T02:00:00Z
---
# Summary

The primary qualification task owns C03/T11 and C04/T12. The timer-only C03
candidate does not establish improvement. C04's two six-frame rounds exceed
52 FPS and improve over both four-frame controls; released repeatability and
RustDesk/detail parity still need qualification. Keep optional compatibility,
finite admission, confirmed paint and current-generation input authority.
Incomplete fixtures and adverse complete rounds remain evidence. Restore a
rejected diagnostic rather than treating its peak as a release result.
The [decision index](remote-desktop-lan-experiment-ledger.md) owns acceptance.

# Exhausted Window Receipt Candidate C03

C03 / T11 is predeclared after P03/P04 and the rejected interval-only C02 and
two-frame early-receipt variant. Question: can returning credit immediately
only when all four available frame IDs have been confirmed remove avoidable
sender pauses without increasing ordinary partial-window receipt traffic?
P04's bounded client trace contains 334 such pending batches, with a local
wait median/P95/max of 3.15/17.10/25.80 ms (1.97 s total). This is a smaller,
separately supported cause; it does not explain every outbound tail.

Change only the client receipt deadline at confirmed four-frame exhaustion.
Keep 50 ms partial-window batching, real confirmed paint, ordered cumulative
credit, generation reset and all media/security/input behavior. This differs
from the rejected two-frame variant, which sends before window exhaustion.
Use an isolated player overlay for local debugging, then consume a published
module before formal compatibility checks. Retain every full trial; measure
100 source-matched inputs and unique client pixels before adoption. Reject if
repeatable performance or lifecycle behavior regresses. Raw B/`credit-c03`.

C03 disposition: reject as an established improvement and restore the original
player. Complete A/B/A rounds all match 100/100 source inputs: A1 44.11 FPS,
P95 161.86 ms, two gaps; B 44.59 FPS, P95 182.39 ms, one gap; A2 44.10 FPS,
P95 195.43 ms, zero gaps. The roughly 1% FPS difference is insufficient to
establish benefit, and latency does not improve consistently. Historical cadence
is not restored. The full patch and 29 passing player tests are retained as
`credit-c03/candidate.patch`; no production release uses it.
Incomplete attempts are retained: B lost focus; A2 first exceeded the 180-second
fixture; its next retry requested 600 seconds beyond the existing 300-second
observer limit and never started capture. The valid retry used 240 seconds,
verified readiness, and delivered source sequences 2 through 101 exactly.
C03 resource roots omit the SSH ancestor, so no complete resource-parity claim.
Retry only with a new, measured exhaustion mechanism or a sufficiently powered
same-condition comparison; do not cite the deterministic timer test as recovery.

# Six-Credit Diagnostic C04

C04 / T12 is predeclared on 2026-10-15 after C01-C03 and T01-T11. P02/P03
show confirmed-credit stalls; C02/C03 do not restore throughput by changing the
receipt timer. Test whether the four-frame in-flight limit, independently of
that timer, restricts throughput across the measured receipt cycle. Change only
Linux FrameCredit, service and Runtime authority, and client queue bounds from four to six, retaining
confirmed paint, 50 ms receipt batching, codec, rate and generation fencing.
This is a bounded diagnostic, not a decision to increase all platform windows.
A/B/A uses published v47 Runtime/server/player controls, identical small Viewer,
physical 1920 x 1280/60 Hz, scene v8, Smooth/Host, 2048 MiB GPU budget and 100
source-matched clicks per round. Record full Runtime/bridge/SSH resource lineage.
Accept only a repeatable throughput benefit without latency/detail regression;
otherwise restore four. Retain every complete round. Retry only a named fixture
failure or new causal evidence. Raw scripts/results: B/`window-c04`.
The first preparation changed worker/player bounds but omitted the independent
service authority limit. It rejected the fifth outstanding frame and disconnected;
no B performance workload was collected. Preserve that attempt and correct every
owner before retrying. Never bypass this rejection or grant early authority.

C04 first B reaches 52.30 FPS/P95 143.13 ms/one 283.38 ms gap, versus A1
45.98 FPS/P95 147.43 ms/zero gaps. Both match 100/100 inputs. Repeat with
worker capacity four restored while retaining six-entry safety ceilings in the
service, Runtime and player, then worker six again. This removes the timer
variable and keeps the same diagnostic Runtime build/client during A2/B2.
A1 used the exact published Runtime; B1 uses an otherwise matching native
Floeterm build with the four-to-six attachment ceiling patch, SHA-256
`ecee8e85567f1bbeba9d058bd52437b0351d42aed94d76f80588a8e061f7424f`.
This rebuild is a comparison limitation until A2/B2 isolate worker capacity.
Do not infer historical stability from the favorable first B.

A2 retains 100/100 inputs: 44.66 FPS/P95 168.52 ms/one 276.65 ms gap.
B2's first attempt reached its 240-second sampler deadline during the input
batches (control binding also interrupted once). Only 60 captured responses and
87 source inputs exist; retain its 54.12 FPS/P95 138.75 ms as incomplete fixture
evidence, not a 100-input comparison. Retry B2 once with the same six-frame build,
300-second bounded samplers and two consecutive 50-click batches. No parameter
or acceptance threshold changes. Do not discard this attempt's gap data.

# Complete C04 Results And Disposition

All four complete rounds independently match local inputs to source sequences
2 through 101 and to client presentation. B2's incomplete first attempt remains
excluded as a whole. The sequence is A1/B1/A2/B2, with the disclosed Runtime
rebuild between A1 and B1; A2/B2 share the exact Runtime and client process.

| Round | Window | Presented FPS | Input P95 ms | Maximum frame gap ms | Gaps >250 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| A1 | 4 | 45.98 | 147.43 | 199.73 | 0 |
| B1 | 6 | 52.30 | 143.13 | 283.38 | 1 |
| A2 | 4 | 44.66 | 168.52 | 276.65 | 1 |
| B2 retry 1 | 6 | 53.48 | 119.13 | 131.10 | 0 |

Mean throughput rises from 45.32 to 52.89 FPS (16.7%). This supports a capacity
constraint under these conditions; it does not identify the complete historical
regression or recover three stable released rounds. The receipt timer and encoder
settings are unchanged. Full lineage resources, cropped in each host's own clock,
show host CPU 125.1/137.9/133.3/138.2% (one core =100%), client CPU
26.0/29.7/26.8/30.1%, LAN send 4.39/4.86/4.22/4.97 Mbps. Client RSS P95 is
993.5/1187.6/1032.3/1013.1 MiB; startup/order and the complete Desktop profile
limit memory inference. Six frames increase admission and carried frames; this is
not a bitrate reduction. Moving detail and paired RustDesk qualification remain.

Decision: proceed to an explicit optional window contract, not a blanket platform
limit change. Native implementation `2b40002537003bd6fc9d976bbf0fa1f817423525`
retains four when the picture field is absent, advertises six on Linux, validates
only four or six, and resets the player's bounded video window per generation.
macOS retains four and Windows physical capture remains unsupported. Runtime must
require the native offer and fix the selected capacity for its attachment; legacy
and mixed components continue to omit the new picture field. Audio, refinements,
confirmed paint, receipt timing, input authority and generation/order fences remain.
No published-product parity claim follows from this diagnostic. Retry C04 only
for a named fixture defect or new capacity evidence; qualify the published pair
separately rather than repeating this overlay.

# Evidence

- B/`window-c04/input-audit.json`: all complete workload/source associations.
- B/`window-c04/v47/resources-three-rounds.json`: full process identities and workload resource intervals for four rounds.
- B/`window-c04/v47/*-analysis.json`: original presentation summaries, including the incomplete B2 attempt.
- B/`credit-c03/candidate.patch`: rejected receipt-only candidate and tests.
- Upstream `host_desktop_player.mjs`, `host_desktop_media.py`, `hostdesktop/protocol.go`: optional bounded window ownership.
