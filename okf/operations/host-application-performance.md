---
type: Validation Guide
title: Host application picture performance
tags: [applications, performance, validation, display]
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

The [display contract](../architecture/host-application-display.md) owns picture
behavior. Floe Native Apps owns capture, encoding and region decoding; Redeven owns
forwarding, picture choices and acceptance. Measure pixels and bytes, not limits.
Failed budgets retain their raw result and block the associated claim. Documents
do not certify video, WAN, physical displays or universal remote-desktop parity.

# Contract

## Reproducible measurements
Compare baseline and candidate on the same host, browser version, source size and workload.

An SSH tunnel changes transport overhead and must be recorded.

| Metric | Definition and controlled viewer acceptance budget |
| --- | --- |
| Input to presented pixels | DOM key event through remote application to changed canvas pixels on the next animation frame; nearest-rank P95 of 20 samples below 150 ms in every mode |
| Input during motion | The same 20-sample measurement while document scroll continues; P95 below 250 ms, including Save data cadence |
| Presented FPS | At most one changed-canvas presentation per animation frame; Motion first at least 25 FPS during document scroll |
| Received payload | All incoming WebSocket data bytes, including JSON; excludes WebSocket/TLS/SSH framing and network retransmissions |
| Idle bandwidth | Below 0.25 Mb/s after settling; a fully unchanged document should send zero image bytes |
| Document-motion bandwidth | Below 5 Mb/s for Automatic/Clarity/Save data and 15 Mb/s for Motion first at the recorded source size |
| Decode work | No more than two current-target frames plus one retired decode; no reconnect on a picture change |
| First frame | Navigation to first decoded canvas presentation; excludes browser-process launch before the viewer attaches |

## Published-module product results
A sandboxed Chrome 153 client on Ubuntu passed all v0.21.0 viewer budgets over loopback, isolating capture, forwarding, decoding and presentation from networking:

| Application | Automatic Mb/s | Motion-first FPS | Static-input P95 across modes | Scrolling-input P95 across modes |
| --- | --- | --- | --- | --- |
| Chrome | 2.14 | 27.0 | 46–65 ms | 129–237 ms |
| Firefox | 4.37 | 37.4 | 65–81 ms | 99–231 ms |

## Observed native pipeline improvement
Sequential tests on Ubuntu 26.04 amd64, Chrome 153.0.8010.36 (1292 by 753 pixels) and Firefox 155.0.1 (1000 by 700 pixels) compared the authentic v0.20.0 component with the v0.21.0 implementation.

| Workload | v0.20.0 | Automatic | Motion first | Save data |
| --- | --- | --- | --- | --- |
| Chrome scroll, Mb/s | 25.04 | 1.59 | 10.61 | 0.64 |
| Chrome scroll, FPS | 25.1 | 19.4 | 34.0 | 8.8 |
| Chrome input P95, ms | 59.6 | 52.8 | 49.9 | 81.3 |
| Firefox scroll, Mb/s | 30.64 | 2.20 | 6.53 | 0.59 |
| Firefox scroll, FPS | 32.4 | 28.7 | 37.4 | 7.9 |
| Firefox input P95, ms | 103.3 | 54.5 | 54.5 | 78.3 |

# Boundaries

The current modes improve document interaction using image regions and bounded in-flight frames. The 150 ms static-input threshold is an acceptance budget, not a universal latency promise.

# Evidence

- `internal/hostapps/client_stream_test.go` and `testdata/client_stream.html`: owned real-browser workload and termination.

- `scripts/host_application_stream_acceptance.mjs`: measured pixels/bytes, retained failures and explicit budgets.

- `scripts/check_host_application_input.mjs`: actual client engine, authenticated transport and evidence output.
