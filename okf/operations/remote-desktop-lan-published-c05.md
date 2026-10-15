---
type: Qualification Record
title: Published six-frame LAN qualification C05
description: Verify the released optional frame window against RustDesk and retain preparation failures separately from performance evidence.
tags: [desktop, performance, qualification]
timestamp: 2026-10-15T10:45:00Z
---
# Summary

The primary qualification task owns C05. The optional six-frame implementation
must use a published native module and preserve four-frame legacy/macOS behavior,
confirmed paint, generation/order fences and finite admission. C04 establishes a
diagnostic throughput benefit, not released recovery or full RustDesk parity.
The [comparison contract](remote-desktop-rustdesk-comparison-results.md) owns
acceptance. A failed release gate or invalid fixture stops qualification; retain
its evidence and repair the named failure before retrying.

# Contract

Read the [decision ledger](remote-desktop-lan-experiment-ledger.md), C01 historical
crossover, C02 receipt rejection, C03/C04 window comparison and P03/P04 timing
record before C05. Scope: qualify native v0.22.48 (`2b40002537003bd6fc9d976bbf0fa1f817423525`)
and Redeven's explicit capability selection, without downgrading later fixes.
No codec, bitrate, receipt deadline, display configuration or platform capability
expansion is part of this experiment. Do not infer a sole Wi-Fi or encoder cause.

Use three alternating RustDesk/Redeven pairs on udesk26's physical 1920 x 1280
60 Hz output and scene v8 (GTK allocation 1152 x 768). Recalibrate the actual
content viewport after restart; ordinary outer window equality is insufficient.
Keep small ordinary windows, one encoding Viewer at a time, Smooth/Host input,
AV1/I420 and the existing 2048 MiB client GPU budget. RustDesk 1.5.0 remains the
verified official direct-LAN binary, custom quality 100% and 60 FPS.

Each idle and motion workload requires 100 independently associated source inputs
and 100 presented responses. Retain every complete round, including adverse
tails; do not replace an unfavorable valid round. Observe unique pixel FPS,
P50/P95/P99 input latency, maximum interval and intervals over 250 ms. Use one
Mac clock domain for input/presentation. Include the complete Runtime, bridge,
SSH, native-service and client lineage, with resources cropped in each host's
own clock. Collect static resources and ten exact-source moving quality frames
per product/round using identical calibration/resampling. Report whole-tree
memory explicitly; do not silently replace it with baseline subtraction.

Acceptance requires repeatable historical cadence/tails and the comparison
contract's latency, detail and resource boundaries. A favorable FPS result alone
does not qualify full parity. Retry only a named fixture defect, after checking
sampler readiness, source focus and source sequence association. Keep the failed
attempt's complete raw files. Use bounded 300-second motion samplers and two
50-click input batches to avoid the documented C04 timeout.

# Preparation Record

The immutable v0.22.48 tag's release qualification run is `38721381321`.
Attempt 1's AMD64 native installation stopped with `download_failed` after
162349469 of 177102489 bytes; no package activation or performance sample followed.
AMD64 private desktop's strict Snap Firefox fixture stopped at host-service
preparation (`APPLICATION_HOST_SERVICE_UNAVAILABLE`); its private permission-store
process exited 1 and the browser never loaded. ARM64 private desktop and both
host-media lanes pass. Keep the failing artifacts and retry only after examining
these boundaries. No GitHub release is valid before the complete Release gate.

At approximately 10:43 UTC, the authenticated udesk26 SSH master could open a
channel but `/bin/bash` returned `Input/output error`, including for
`/usr/bin/true`. RustDesk also disconnected. This is a preparation failure, not a
measured performance regression or a diagnosis of its cause. The operator rebooted
the host. New boot ID `f4c6eedd-8995-4e3b-934f-46c4b2d19c2f` is reachable at 10:47 UTC;
`/tmp` is tmpfs and all remote task fixtures were lost. The installed C04 service
survives and must be replaced through the authoritative manager before formal
sampling. Rebuild fixtures and record new process identities; do not join
pre-reboot and post-reboot intervals or reuse stale credentials/geometry.

# Published Module And Compatibility

The Go proxy/checksum database resolves the immutable tag to the native commit
above with module sum `h1:wlvpKFaGY5zYhA20QzUTXCfVEQvYpT5rj1bTivcn8VY=`.
Consumer checks use `GOWORK=off`, with no sibling imports or player overlay.
Runtime race tests cover the actual control capability, four/six-frame socket
admission, overflow teardown and unchanged paint/input authority. Viewer codec
checks pass for Linux six-frame, absent legacy offer and macOS four-frame paths,
including reconnect from six to an absent offer. The full Linux service Viewer
fixture passes input, lock, recovery, audio, clipboard, display, takeover and
disconnect checks. Its first attempt exposed a fixture-only capability refresh
that omitted the selected window while the assertion retained six; preserve
the failure and carry the same offer in unrelated capability refreshes.
These checks establish compatibility behavior, not LAN performance acceptance.

# Evidence

- B/`published-v48-paired/release-attempt1`: original qualification artifacts.
- B/`window-c04/input-audit.json`: diagnostic evidence, separate from C05.
- [C03/C04](remote-desktop-lan-window-c04.md): window comparison and adoption rationale.
- [Stage tracing](remote-desktop-lan-stage-tracing.md): clock and transport limits.
- `internal/remotedesktop/attachment.go`: native-offered capacity and unchanged input authority.
- `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs`: extended/legacy reconnect and platform fixture.
