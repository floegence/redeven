---
type: Validation Guide
title: Host application picture performance
tags: [applications, performance, validation, display]
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

Floe Native Apps owns picture capture/codec; Redeven forwards/qualifies display choices. Measure actual pixels/bytes and retain failed budgets; these workloads certify no video/WAN/physical-display/universal parity.

# Contract

## Reproducible measurements
Compare same host/browser/source size/workload, recording SSH overhead. Controlled viewer budgets:
- Input→pixels:DOM key through remote app to changed canvas at next rAF;20samples/nearest-rankP95<150ms in every mode. During continuous scroll<250ms including Save data.
- Presented FPS:one changed-canvas presentation/rAF; Motion first>=25FPS scrolling.
- Payload includes all WebSocket data/JSON, excludes WS/TLS/SSH framing/retransmits. Settled idle<0.25Mb/s, unchanged image ideally zero bytes. Motion<5Mb/s Automatic/Clarity/Save data,<15Motion first at recorded size.
- Decode<=two current frames plus one retired; picture change never reconnects. First frame starts navigation, excludes prior browser launch.

## Published-module product results
Sandboxed Chrome153/Ubuntu with published0.21.0 over loopback passed viewer budgets. Chrome Automatic2.14Mb/s, Motion27FPS, staticP95 46–65ms/scroll129–237; Firefox4.37Mb/s/37.4FPS/65–81ms/99–231ms. Networking was excluded.

## Observed native pipeline improvement
Sequential Ubuntu26.04amd64 authentic0.20→0.21 comparison used Chrome153.0.8010.36 at1292×753 and Firefox155.0.1 at1000×700. Values are baseline/Automatic/Motion-first/Save-data:

| Workload | Baseline | Automatic | Motion first | Save data |
| --- | --- | --- | --- | --- |
| Chrome Mb/s |25.04|1.59|10.61|0.64|
| Chrome FPS |25.1|19.4|34.0|8.8|
| Chrome inputP95ms |59.6|52.8|49.9|81.3|
| Firefox Mb/s |30.64|2.20|6.53|0.59|
| Firefox FPS |32.4|28.7|37.4|7.9|
| Firefox inputP95ms |103.3|54.5|54.5|78.3|

# Boundaries

Image regions/bounded frames improve measured document interaction;150ms is acceptance budget, not promised latency.

# Evidence

internal/hostapps/client_stream_test.go/testdata/client_stream.html own browser workload/cleanup. scripts/host_application_stream_acceptance.mjs measures pixels/bytes/failures; check_host_application_input.mjs verifies authenticated actual-engine transport and evidence.
