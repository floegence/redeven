---
type: Acceptance Record
title: Current-desktop qualification results
description: Assess published remote desktop measurements, retained failures and outstanding real-host qualification.
tags: [desktop, linux, macos, validation, performance]
timestamp: 2026-10-02T04:00:00Z
---
# Summary

Acceptance remains incomplete for the [desktop contract](../architecture/remote-desktop.md).
Published dependencies pass office checks, the macOS 1080p matrix and Linux
ten-minute input stability. Failed or unfinished performance and real-host checks
prevent integration. Preserve the [acceptance thresholds](remote-desktop-validation.md);
a passing retry neither erases a failure nor establishes its cause. Current
macOS foreground/performance work is deferred at the user's request while other
workloads continue. No Redeven push, push gate or full integration gate is authorized.

# Published Dependency And Conditions

Redeven binary `a0ab99cb3f4fe725de039321d72fc22f42ba4492` uses published
`floe-native-apps` v0.22.5 (`a2c11dabc0c5d4860887f075e79a577ba82447a0`).
Release qualification/checksum readback passed. Builds use `GOWORK=off`, native
Floeterm and no overrides. Earlier v0.22.4 evidence is labeled.

Apple Silicon uses VideoToolbox H.264 and task loopback. Chromium's
`no-preference` does not prove hardware decoding. Shared CPU/GPU observations
are not process attribution; foreground tests stop on focus loss.

`server` is Ubuntu 24.04/GNOME X11, RTX 4090 D/driver 550.90.07. Its glibc CUDA
library cannot load into the isolated musl stack, which selects `x264enc`.
System FFmpeg NVENC test-pattern success does not qualify production GPU
encoding. Authenticated WebSockets use a task LAN SSH forward; ten pings had
no loss and 4.242/5.985/9.329ms minimum/average/maximum RTT.

1440p leases scale a 2560x1440 framebuffer to physical 3840x2160@59.94Hz and
restore 1920x1080@60Hz. Native 1440p is 30Hz; a task 59.95Hz mode was rejected
and removed without changing driver policy. Alternative scanout is labeled.

# Published Product Results

## macOS

The v0.22.4 1080p matrix passed all six 60-second runs: minimum 57.321 FPS,
maximum interval P95 29ms, refinement 341.9ms and bandwidth 14.70-14.86Mbps.
The Electron office workflow passed Chinese/emoji paste, drag, wheel, clipboard,
native full screen, view-only and takeover. One hundred physical inputs measured
P95 70.1ms to the changed marker's post-render receipt.

The incomplete v0.22.4 1440p matrix includes a passing scroll cell
(57.523 FPS/24.2ms/321.1ms), office/reference checks and 100-key P95 54.5ms.
v0.22.5 scrolling failed at 38.323 FPS/33ms/359.2ms. Xcode compilation was
observed, but attribution to load remains unproven.

A v0.22.5 stability attempt stopped after 12 keys on decoder recovery. The
driver now waits for authority and focus before every key without replay. Its
100-key retry failed P95 at 82.2ms; another stability run lost foreground. The
1440p matrix and ten-minute stability remain unqualified and deferred.

The v0.22.5 Runtime restart passed: both channels closed, old session/ticket
returned 404, fresh paint was required, and fixture/text survived without replay.
Expected connection-refused messages during the stopped interval are retained.
Toolbar switching between two owned applications passed; application-mode/desktop
control-ownership takeover is a separate outstanding check.

## Linux

The v0.22.4 office workflow passed Chinese/emoji paste, pointer, clipboard,
full screen, view-only and takeover. Input P95 was 68.4ms/67.3ms at 1080p/1440p;
an 800x120 original-pixel crop matched its independent reference. v0.22.5
toolbar application switching also passed with current X server timestamps.

The v0.22.4 1080p third scroll cell failed at 52.398 FPS/35.4ms; a 1440p window
cell failed at 52.77 FPS/34.5ms. All 3,183 received frames decoded, 3,176 drew,
and decode P95 was 2.1ms. Fixture updates reached 60.02/s but media only 52.89/s.
v0.22.5 1080p scrolling failed at 44.325 FPS/37.4ms/237.8ms refinement; media
was 44.34/s and decode P95 1.7ms. Loss precedes decoding. Neither matrix passes.

A v0.22.4 stability attempt stopped around 510s when a seatless SSH login
vanished between logind enumeration and lookup. Published v0.22.5 excludes
seatless logins before lookup; missing graphical properties still fail closed.
During 100 SSH exits, a 30s comparison found 27 failures in 2,208 v0.22.4 checks
and none in v0.22.5. The latter product completed 600.1s/670 inputs at P95 62.8ms,
with decoder depth zero, 30,226 audio blocks and at most one pending handoff.
All 136 resource-monitor SSH exits completed without revocation.

Runtime restart passed on both releases: channels closed, old credentials
returned 404 and fresh paint was required; fixture/text survived. The initial
v0.22.5 stale 669-key baseline failure is retained alongside the passing
correlated retry for all 670 delivered keys.

Intermittent original-pixel comparisons failed on Linux v0.22.4 and macOS
v0.22.5. The driver now snapshots the actual PNG draw and awaits its paint
receipt; focused comparisons pass. Earlier PNG snapshots were not retained,
so their cause remains unconfirmed. Later H.264 draws are compared separately;
full-frame copies occur only during reference checks.

Six Linux system-output tones reached the unmuted Mac AudioContext destination
with advancing clocks. Human listening and accumulated audiovisual delay remain
unqualified; worklet acceptance is not physical speaker evidence.

# Capture Diagnostics And Limits

Instrumented v0.22.5 X11 1440p drew 54.70 FPS/32.4ms. Capture reached 60
callbacks/s but 53-59 changed pictures/s, with codec P95 usually 3-4ms and
0-2 pending credits. Removing encoder pacing still failed at 53.77 FPS/32.7ms.
Consented portal comparisons drew 26.71-27.70 FPS despite negotiated 59.94 FPS;
copying PipeWire buffers did not help. No production backend switch followed.

Independent FFmpeg X11 capture observed 52.13 changed images/s at 60Hz sampling
and 55.4 at 120Hz. The latter's first interval calculation used the wrong
timebase; discard that interval result. Subsequent probes parse the reported
timebase. 1080p scrolling reached 57.73 changed images/s/P95 16.76ms, but GTK
reported no usable presentation timestamps. Downsampled change hashes and
alternate display scaling do not qualify product rendering.

GStreamer grabs the X Server per frame. An external interceptor raised capture
from about 69 to 120 callbacks/s; the original fixture still drew only
54.73 FPS/33.2ms. With the system GTK product fixture, 1080p drew 57.53 FPS
without grabs and 59.07 with grabs; 1440p drew 55.89 and 49.39 respectively.
The published 60Hz capture comparison drew 50.29 FPS. These results show an
acquisition cost, not a sufficient fix. No interceptor or altered library ships.
System-FFmpeg/GStreamer capture failed at 54.77 FPS/34.8ms and, after increasing
pipe read size, 54.52 FPS/33.5ms. That binary is not a published dependency. Fixture/compositor cadence,
sampling and client load remain unresolved in the detailed diagnostic ledger.

Earlier Linux dynamic failures (52.48-53.86 FPS/33.3-33.5ms), input failures
(83.8/84.3ms) and rejected polling, format, cursor, queue and XDamage experiments
remain in the ledger. Native macOS candidate matrices and 611.1s stability are
not published-product acceptance.

`udesk24` GNOME 46 Wayland passed authorization, input, clipboard, audio handoff
and grant restoration. Dynamic 1080p was about 37.6 FPS and capture alone
38-41 FPS; it exposes neither 1440p nor usable hardware encoding.

# Remaining Qualification

- Resolve Linux cadence and complete both published dynamic matrices.
- Complete macOS 1440p and ten-minute interaction when foreground is available.
- Verify real lock/unlock, physical hotplug and application-mode/desktop takeover.
- Qualify physical audio output and accumulated audiovisual delay.
- Preserve unresolved reference failures; regenerate OKF and run affected checks.
- Integrate and clean task worktrees only after acceptance; do not push Redeven.

The v0.22.5 Electron viewer regression passed input/paint authority, composition
cancellation, clipboard, display selection, takeover, reconnect, narrow locales,
dialog keyboard and disconnect. Synthetic contracts do not replace these pending
real-host checks.

# Evidence

Detailed results, binary identities and historical failures remain outside the
repository in `task-evidence/remote-desktop-20261001/product-progress.json`.
Screen/clipboard content is not committed. Representative records:

- `product-performance-macos-v0224-1080-retest.json`: complete macOS matrix.
- `product-performance-*-v0225-*.json`: current published performance failures.
- `product-macos-input-1440-macos-v0225-recovery-input-focus.json`: input failure.
- `product-failure-macos-v0225-stability-*.json`: interrupted stability attempts.
- `product-audiovisual-stability-1080-linux-v0225-stability-native-runtime.json`: Linux stability.
- `product-*-restart-*-v0225-*.json`: correlated Runtime restart evidence.
- `product-shortcut-*-v0225-*.json` and `product-v0225-electron-viewer.log`: interaction regression.
- `product-audio-destination-linux-v0225-audio-destination.json`: destination clocks, listening unconfirmed.
- `identity-churn-probe-server.log`: disappearing seatless login comparison.
- `linux-capture-stage-comparisons.json`: acquisition/encoding diagnostics, including rejected interceptors.
- `server-v0225-portal-*.log` and `server-independent-*.log`: consented portal and host capture comparisons.
- `product-v0225-*-build-metadata.log`: published binary provenance.
