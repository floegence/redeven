---
type: Qualification Record
title: LAN transport and tracing experiments
description: Consult ACK, credit, HTTP2, SSH and stage diagnostics before repeating latency hypotheses.
tags: [desktop, performance, experiments]
timestamp: 2026-10-15T02:00:00Z
---
# Summary

The primary qualification task owns these transport decisions. Existing traces
show publication-to-confirmed-receipt tails and some capture-to-submit waits;
they do not isolate the cause of historical decline. Preserve bounded queues,
confirmed presentation semantics, generation fencing and transport security.
Neither retransmissions nor a synthetic carrier result proves the whole cause.
Rejected variants must be restored; diagnostics never qualify a release.
The [decision index](remote-desktop-lan-experiment-ledger.md) owns C01 and acceptance.

# Contract

Evidence root `B`, dates and common controls are defined in the decision index.
Temporary diagnostics have their exact overlays in retained preparation scripts;
where an exact consumer hash is not established, identity remains unresolved.
Before another trial, declare its changed variable and consult its owning row.
Preserve the complete workload, source matching and original measurements.

# Decision Ledger

| ID / variable and identity | Validity / result | Decision, tradeoff and evidence needed to retry | Raw evidence under B |
| --- | --- | --- | --- |
| T01 / bounded asynchronous media writer, native `60e12f2`, reuse `4387b0e` | Moves pipe writes off dispatcher; bounded queue, cancellation/restart tests; later formal tails remain | Adopt dispatcher/backpressure repair. Isolate only if new trace shows writer ownership stalls; do not undo cancellation or bounds | `writer-v45-module-provenance.json`, `host_desktop_wire_test.py` upstream |
| T02 / confirmed cumulative receipts, native `ec3dc73`, v0.22.46 | Coalesce at most 50 ms, immediate first/idle receipt, four credits. Diagnostic r4: 100/100, 45.03 FPS/P95 125.16 ms/max416.71 ms, one gap | Adopt traffic reduction with confirmed paint semantics; stable parity unresolved. Retry interval only with evidence of exhausted credit, distinguishing local batching from return-path delay | `proxy-frame-coalescing/cumulative-receipt-analysis-r4.json`; player tests |
| T03 / four -> two credits, v45 diagnostic | 100/100; 33.17 FPS/P95 258.04 ms, maximum gap234.38 ms, zero gaps >250 ms | Rejected; lower buffering reduced throughput and did not fix P95. Restored four. Retry only if new evidence isolates excess in-flight latency | `v45-credit2-diagnostic/r1-redeven-motion-analysis.json` |
| T04 / remove redundant ACK success response | P95 776 ms, one unmatched response | Rejected/restored. Retry only if protocol trace proves this response blocks a necessary path | `lan-ack-oneway-analysis.json`, `prepare/deploy-lan-ack-oneway` scripts; history ordinal55514 |
| T05 / restrict sending cadence | 100/100, about36 FPS/P95 374 ms | Rejected/restored. Do not repeat pacing without causal enqueue evidence | `lan-ssh-pacing-analysis.json`, history ordinal54247 |
| T06 / placement HTTP2 frame size 64 KiB, Redeven `5759db07e`; efficiency `279a5b1b0` | Adopted transport efficiency; current complete H47 still fails tails | Keep transport/security contracts. Synthetic throughput is not actual Viewer qualification. Retry only same-candidate isolated frame-size test answering new evidence | `h2-frame-probe.json`, `h2-frame64k-analysis.json`, `h2-revert16k-analysis.json`, `deploy-formal-279a5b1b0.py` |
| T07 / larger HTTP2 receive window | 11.48 FPS/P95 1626.74 ms | Rejected. Retry only with demonstrated receive-window starvation and a bounded prediction | Existing [comparison record](remote-desktop-rustdesk-comparison-results.md), `h2-flow-diagnostic.cjs` |
| T08 / SSH IPQoS none | Stalls remained | Rejected as established fix. Retry requires matched route/QoS evidence, not Wi-Fi conjecture | [v42 record](remote-desktop-rustdesk-v42-results.md) |
| T09 / loopback TCP_NODELAY and SSH Nagle hypothesis | 1024-byte/60 Hz local noDelay false/true both P95 about1 ms; OpenSSH10.2 apply_qos always enables TCP_NODELAY | No reproduced Nagle defect. Do not claim missing explicit proxy setNoDelay caused decline. Retry only with packet timing proving batching in the actual socket | `nagle-probe.cjs`, `nagle-probe.json`, `openssh-10.2-packet.c` |
| T10 / long synthetic SSH/H2 carrier | 7200 x20 KB, 58.88 FPS/P95 26.56 ms/max413.55 ms | Diagnostic capacity only; does not qualify source-to-presentation. Retry only a new carrier ownership question | `h2-long-carrier-probe.json` |

# Boundaries

Different-time results cannot isolate a software variable. Command arrival,
capture FPS and panel FPS are distinct from observed client presentation.
Retain confirmed cumulative credit, generation fences, bounded queues and
authorization when changing scheduling. A carrier-only result cannot qualify
RustDesk parity; a trace must isolate a previously unresolved interval.

# Further Diagnostics

The [stage tracing record](remote-desktop-lan-stage-tracing.md) owns P01-P04,
including clock validity and outbound boundaries. The
[window comparison](remote-desktop-lan-window-c04.md) owns rejected C03/T11 and
six-frame C04/T12. Consult those records before repeating receipt or capacity
experiments. Both retain their invalid attempts and complete adverse rounds.

# Evidence

- [Comparison contract](remote-desktop-rustdesk-comparison-results.md): current acceptance and method owner.
- [Historical handoff and current candidate index](remote-desktop-lan-experiment-ledger.md): complete released identities, raw roots and retry discipline.
- `desktop/src/main/runtimePlacementConnector.ts`, `desktop/src/main/runtimePlacementLoopbackProxy.ts`: carrier ownership.
- Upstream `host_desktop_player.mjs`, `host_desktop_wire.py`: confirmed receipts and bounded dispatch ownership.
