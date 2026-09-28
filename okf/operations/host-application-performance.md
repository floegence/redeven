---
type: Validation Guide
title: Host application picture performance
description: Measure native host application bandwidth, presented frames, input latency and bounded decoding with repeatable browser workloads.
tags: [applications, performance, validation, display]
timestamp: 2026-09-29T00:00:00Z
---
# Summary

The [display contract](../architecture/host-application-display.md) owns picture
behavior. Floe Native Apps owns capture, encoding and region decoding; Redeven owns
forwarding, picture choices and acceptance. Measure pixels and bytes, not limits.
Failed budgets retain their raw result and block the associated claim. Documents
do not certify video, WAN, physical displays or universal remote-desktop parity.

# Contract

## Reproducible measurements

Compare baseline and candidate on the same host, browser version, source size and workload. Run performance fixtures sequentially, without concurrent builds,
renderer suites or other benchmark workloads. Record OS/CPU, client and module/component versions, resolution, mode, transport,
RTT and network shaping. Preserve all runs, including failures; investigate
contention and repeat the affected case without silently discarding its evidence.

Upstream `stream_session_probe.py` compares the genuine v0.20.0 launcher/component
with the new module using owned browser profiles and an animated raster document.
Its timer runs from host input to Pillow-decoded pixels, isolating the native pipeline.

`TestInstalledClientStreamViewer` exercises product inventory, profiles, launch and transport. Set an unused absolute
`REDEVEN_TEST_CLIENT_STREAM_EVIDENCE`, `REDEVEN_TEST_CLIENT_STREAM_TARGET` (`chrome`
or `firefox`) and the released `REDEVEN_TEST_DESKTOP_COMPONENT_STATE`. Build and
run it with `GOWORK=off`. Drive its published connection fixture with:

```sh
REDEVEN_INPUT_BROWSER=chromium node scripts/check_host_application_input.mjs \
  <ssh-host> <remote-evidence-directory> <local-evidence-directory>
```

`REDEVEN_TEST_SSH_CONFIG` optionally selects the task's existing SSH configuration.
Use `local` as the host when the client runs on the same Linux machine. Qualify
that controlled loopback first, then repeat across the intended network; do not
label loopback as LAN evidence. An SSH tunnel changes transport overhead and must
be recorded. The Go fixture terminates only its own instance after success or failure.

For each picture mode, the scrollable HTML workload must settle for 1.5 seconds, measure two seconds of idle, twenty
Space-key marker changes, five seconds of continuous scrolling, twenty more
marker changes while scrolling, and 1.5 seconds of settling. Mode changes retain one attachment; reload restores the preference. Separate input
qualification checks text, cursor, clipboard and lifecycle receipts.

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

`metrics.json` is written before assertions so an over-budget run remains
inspectable. `result.json` contains the client version, component and process
identity without credentials. Screenshots include settled picture controls and a
controlled waiting presentation. The latter checks icon exclusivity, progress and reduced motion, not a real delay.

## Published-module product results

A sandboxed Chrome 153 client on Ubuntu passed all v0.21.0 viewer budgets over
loopback, isolating capture, forwarding, decoding and presentation from networking:

| Application | Automatic Mb/s | Motion-first FPS | Static-input P95 across modes | Scrolling-input P95 across modes |
| --- | --- | --- | --- | --- |
| Chrome | 2.14 | 27.0 | 46–65 ms | 129–237 ms |
| Firefox | 4.37 | 37.4 | 65–81 ms | 99–231 ms |

Both fixtures emitted zero payload bytes in their settled idle intervals, kept
one attachment across mode changes and peaked at two decoder jobs/packets. Save
data used 0.81 Mb/s for Chrome and 1.11 Mb/s for Firefox document scrolling.

Mac-to-host SSH-tunnel development runs passed static-input and bandwidth budgets
but did not consistently pass motion FPS and scrolling-input latency. Diagnostic
runs recorded zero client long tasks, network RTT up to 114 ms, input submission
replies up to 324 ms and presentation outliers above 600 ms. A reply confirms native
submission, not application consumption. These failures are retained, not reported
as a universal LAN pass or hidden by relaxed budgets. Deployments must repeat the
same workload on their actual network; low bandwidth alone does not remove jitter.

## Observed native pipeline improvement

Sequential tests on Ubuntu 26.04 amd64, Chrome 153.0.8010.36 (1292 by 753 pixels)
and Firefox 155.0.1 (1000 by 700 pixels) compared the authentic v0.20.0 component
with the v0.21.0 implementation. These are the upstream host-input/Pillow results:

| Workload | v0.20.0 | Automatic | Motion first | Save data |
| --- | --- | --- | --- | --- |
| Chrome scroll, Mb/s | 25.04 | 1.59 | 10.61 | 0.64 |
| Chrome scroll, FPS | 25.1 | 19.4 | 34.0 | 8.8 |
| Chrome input P95, ms | 59.6 | 52.8 | 49.9 | 81.3 |
| Firefox scroll, Mb/s | 30.64 | 2.20 | 6.53 | 0.59 |
| Firefox scroll, FPS | 32.4 | 28.7 | 37.4 | 7.9 |
| Firefox input P95, ms | 103.3 | 54.5 | 54.5 | 78.3 |

Automatic reduced this document workload's image bytes by about 94% for Chrome
and 93% for Firefox. Twenty marker changes used 4,585 image bytes versus 2,461,795
and 4,927,587 respectively. Unchanged raster scenes emitted no image bytes;
Firefox's initial browser activity can still produce real updates. Product
WebSocket measurements include metadata and browser presentation, so their values
must not be substituted into this host-only comparison.

# Boundaries

The current modes improve document interaction using image regions and bounded
in-flight frames. They are not inter-frame video codecs or GPU encoder claims.
High-motion video, WAN loss/jitter, constrained bandwidth, high-DPI/4K sources,
multiple simultaneous viewers and physical display scanout require separate
recorded trials before claiming parity with a specific remote desktop product.
The 150 ms static-input threshold is an acceptance budget, not a universal latency promise.

# Evidence

- `internal/hostapps/client_stream_test.go` and `testdata/client_stream.html`: owned real-browser workload and termination.
- `scripts/host_application_stream_acceptance.mjs`: measured pixels/bytes, retained failures and explicit budgets.
- `scripts/check_host_application_input.mjs`: actual client engine, authenticated transport and evidence output.
- `internal/envapp/ui_src/src/ui/services/linuxHostApplicationViewer.test.ts`: negotiated modes, retained legacy sessions, icon, loading and region composition.
- [Floe Native Apps stream probe](https://github.com/floegence/floe-native-apps/blob/v0.21.0/qualification/desktop_compatibility/stream_session_probe.py): baseline isolation and host pipeline measurements.
