---
type: Qualification Record
title: LAN desktop stage tracing
description: Locate measured native, Runtime, client and receipt intervals without assigning an unproven cause.
tags: [desktop, performance, experiments]
timestamp: 2026-10-15T02:00:00Z
---
# Summary

The primary qualification task owns these timestamp diagnostics. P03/P04 narrow
some long tails to delivery after accepted outbound writes; they do not isolate
SSH, kernel, network or client scheduling, or explain every historical result.
Keep clock domains and calibration uncertainty explicit. Instrumentation must
preserve confirmed paint, generation fences and bounded queues, and be restored
after measurement. A stage trace never substitutes for presented-pixel acceptance.
The [decision index](remote-desktop-lan-experiment-ledger.md) owns common controls.

# Stage Evidence And Limits

P01, existing post-v42/v45 tracing: source-to-capture medians45-47 ms,
descriptor about8 ms, pool1.6-1.7 ms, encode12-13 ms, receive-to-draw1-3 ms.
Publication-to-ACK has tails above400 ms; some intervals wait capture-to-submit.
Sources: B/`lan-capture-phase-stages.json`,
`proxy-frame-coalescing/marker-stages.json`. Instrumentation and cross-host clock
uncertainty remain explicit. Another trace must name an interval these cannot
answer. TCP retransmissions occur in both products, without sole-cause proof.

P02, 2026-10-14 PDT temporary v47 timestamp overlay (not native v0.22.48):
consumer `56b7275da`, base native `99fa004`, diagnostic media archive SHA-256
`4e9caa61179857033bb7ffdf54839f234ca35fe7ea557244e1a056ad41e859e3`.
Question: do long publication gaps follow encode stalls or blocked frame credit?
Bounded capture/media timestamps were the only changes. Service PID876399 used
systemd PrivateTmp; no marker decoding was added, so source-to-capture latency
cannot be inferred from this overlay.

- r1: 50/50, P50/P95 128.90/159.64 ms, 46.11 FPS, zero gaps. Encode median/P95
  13.71/18.97 ms; publish-to-ACK35.16/60.55 ms; maximum publish gap67.73 ms.
  No tail reproduced; short diagnostic, not acceptance.
- r2: 52/52, P50/P95 96.95/125.73 ms, 43.27 FPS, three gaps. Initial CUA batch
  interrupted by app change; two clicks23 ms apart then50 regular clicks.
  Retain as diagnostic with this validity caveat, not a clean100-input trial.
- Port-scoped120 s pcap:24018 packets, zero kernel drops. Simple overlapping
  TCP-sequence classifier finds48 retransmission packets/142724 bytes; not an
  exhaustive cause classifier. Frame4340 has248.91 ms publication gap, ACK at
  +233.47 ms and next submit+233.50 ms. Several stalls overlap retransmissions;
  frame4803 has217.75 ms gap/ACK+207.16 ms with none in its narrow window.

Decision: unresolved credit/return-path ownership. This narrows stalls but does
not isolate historical regression or Wi-Fi. Do not repeat unchanged tracing;
first complete C01 or state a new discriminating timing question. Raw scripts
`prepare-v48-trace.py`, `v48-trace-runner.py`, outputs `v48-trace-paired`,
`v48-trace-export`, `v48-bridge.pcap`, `v48-clock.json`, `analyze-v48-gaps.py`.

# Client Segment Trace

P03 is predeclared after C02 and inspection of the retained
`receipt-transit-20261014` diagnostic. That older two-frame early-receipt variant
reported 44.74/48.22 FPS, P95 168.10/336.99 ms and three/nine gaps; its saved
disposition rejects publication. Do not repeat it as an untested proposal.
P03 changes instrumentation only, on consumer `56b7275da` and native v0.22.47.
It measures decoded draw, confirmation scheduling, confirmed paint, receipt
selection/send and carrier delivery by frame ID, plus the duration of product
paint callbacks. Existing P01/P02 cannot separate those client intervals.
Use the same small Viewer, physical output, scene and quality controls as C02.
Keep timestamps in their host clock domains; cross-host comparisons must retain
measured clock-offset bounds. No performance candidate is selected in advance.
Retain incomplete attempts, restore any diagnostic service and remove temporary
credentials. Another trace needs a newly unresolved segment or a named fixture
failure. Raw evidence will be under B/`receipt-p03`.

P03 first snapshot matches 747 receipts: publication-to-release P95 137.65 ms,
client receive-to-send P95 48.50 ms, and worker ingress-to-release P95 0.412 ms.
The product paint callback is at most 0.20 ms. With a Node-hrtime-based clock
probe (4.45 ms host-offset interval), publication-to-receive P95 is 101.46 ms;
the worst 332.70 ms receipt includes about 264.89 ms outbound, 28.8 ms client
and 38.64 ms return. Delta frames also exhibit tails. This isolates an outbound
interval, not a specific writer or network cause. A Python-monotonic/Node-hrtime
calibration is invalid because those Mac clock domains differ; retain it as a
fixture failure. The prior RustDesk test window was still open during this
snapshot; it was closed before the next diagnostic. No acceptance claim.

P04 is predeclared on 2026-10-15 after reading P01-P03 and T01/T06-T10.
Question: does the outbound tail occur before native pipe completion, before
Runtime WebSocket write completion, before bridge stdio completion, or after
those writes? Timestamp-only overlays add those boundaries; they preserve all
media, flow-control, security and input settings. Use the same small v47 Viewer
and scene. Close the exact prior RustDesk test session first. Retain host clock
calibration and complete traces; this remains stage diagnosis, not acceptance.
Raw scripts and receipts: B/`outbound-p04`. Restore all overlays afterward.

P04 matches 1,740 frame IDs. Median/P95/max ms: publication-to-writer-complete
0.327/0.600/48.78; writer-to-Runtime-receive 1.695/2.958/51.17;
Runtime-receive-to-WebSocket-write-complete 0.114/0.204/0.427;
WebSocket-write-complete-to-client-receive 6.592/24.856/150.40.
The combined clock interval is 5.679 ms. The next shared-stream stdio write is
usually within 0.894 ms (P95); it is not an exact encrypted-frame identity.
Some native stalls exist, but the largest matched tail is after accepted writes.
This does not distinguish SSH, kernel, network and client scheduling. A short
steady receive/draw rate of 51.35 FPS is not presented-pixel acceptance.
A non-task demand-diagnostic workload was observed on udesk26 and left alone;
it had exited by the later comparison. Original service and Runtime hashes were
restored; temporary Go tracing changes are retained only in the artifact patch.

# Evidence

- [Transport decisions](remote-desktop-lan-transport-experiments.md): adopted and rejected carrier hypotheses.
- B/`receipt-p03` and B/`outbound-p04`: scripts, calibration, traces and restoration receipts.
- `internal/remotedesktop/attachment.go` and `desktop/src/main/runtimePlacementConnector.ts`: product transport boundaries.
