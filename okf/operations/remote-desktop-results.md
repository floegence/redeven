---
type: Acceptance Record
title: Current-desktop qualification results
description: Assess published remote desktop measurements, retained failures and outstanding real-host qualification.
tags: [desktop, linux, macos, validation, performance]
timestamp: 2026-10-01T21:00:00Z
---
# Summary

Acceptance remains incomplete for the [desktop contract](../architecture/remote-desktop.md).
Published v0.22.4 passes the macOS 1080p dynamic matrix and office/input checks
on both tested hosts. Linux dynamic failures and unfinished real-host checks
prevent integration. Preserve the thresholds in the
[acceptance method](remote-desktop-validation.md); passing retries do not erase
earlier failures or establish their cause.

# Published Dependency And Conditions

Redeven commit `314718e5765e1193db225f5dc2ab8b32e224dfe7` consumes published
`floe-native-apps` v0.22.4 Go and Swift packages at
`32e7efbce4d3ba9581f7606204eb4768630acc84` for the results below. The feature
now adopts published v0.22.5 at `a2c11dabc0c5d4860887f075e79a577ba82447a0`.
Its release gate and module-proxy/checksum readback passed. Redeven commit
`a0ab99cb3f4fe725de039321d72fc22f42ba4492` binaries use `GOWORK=off` and the
published native Floeterm build, without sibling overrides.

Apple Silicon uses VideoToolbox hardware H.264 at 1080p/1440p. Chromium's
`no-preference` does not prove hardware decoding. The Runtime uses task loopback.
Foreground tests stop on focus loss and record shared system load.

`server` runs Ubuntu 24.04 GNOME X11, RTX 4090 D and driver 550.90.07. The
musl media stack cannot load the host's glibc CUDA library and selects software
`x264enc`; GPU encoding is unqualified. System FFmpeg NVENC encoded a 1440p test
pattern; this does not certify the production stack. The client uses
authenticated Redeven WebSockets through an owned SSH forward on the local LAN.
Ten ping samples had no loss and 4.242/5.985/9.329ms minimum/average/maximum RTT.

The 1440p display lease uses a 2560x1440 framebuffer scaled to physical
3840x2160@59.94Hz scanout because the native 1440p mode is only 30Hz. It restores
1920x1080@60Hz. The driver rejected a task-only CVT 1440p/59.95Hz mode with
RandR `BadMatch`; the mode was removed without switching the display or changing
driver policy. The scaling arrangement must remain explicit in results.

# Current Published Results

## macOS

The complete v0.22.4 1080p matrix contains six 60-second runs: three scrolling
and three window-motion runs. All passed, with minimum 57.321 FPS, maximum
interval P95 29ms and maximum refinement 341.9ms. There were no client errors.
Bandwidth was 14.70-14.86Mbps. Resource evidence records owned CPU processes and
labels GPU counters as shared whole-device observations.

The real Electron office run passed Chinese/emoji client paste, drag-selection,
wheel scrolling, bidirectional clipboard, native full screen, view-only and
explicit takeover. One hundred physical inputs at 1080p measured P95 70.1ms to
the published player's post-render receipt of the changed task marker.

The first published 1440p scroll run passed at 57.523 FPS, interval P95 24.2ms
and refinement 321.1ms. The matrix was interrupted; a later attempt stopped on
foreground loss. Neither is a complete matrix. Separate published 1440p office,
original-pixel reference and 100-key P95 54.5ms checks passed. Published-product
ten-minute stability and the rest of the matrix remain pending.

## Linux

The v0.22.4 office run passed Chinese/emoji composition through explicit paste,
drag-selection, wheel scrolling, bidirectional clipboard, full screen, view-only
and takeover. One hundred physical inputs at 1080p measured P95 68.4ms. The
original-pixel 800x120 text crop matched an independent lossless reference.
Task system-output audio reached the production decoder and AudioWorklet, with
206 accepted blocks and at most one pending handoff. This is not output-device
qualification.

The latest 1080p scrolling matrix recorded 58.847, 58.954 and 52.398 FPS with
interval P95 24.2, 22.5 and 35.4ms. The third run failed and stopped the matrix.
Refinement was 245.2-262.6ms; sampled decoder depth was zero and bandwidth
5.35-5.72Mbps. The host was lightly loaded, while client system load was high.
Client scheduling interference is plausible but unproven.

A later 100-key 1440p run passed with P95 67.3ms. Its 60-second window-motion
test failed at 52.77 FPS, interval P95 34.5ms and refinement 260.4ms. Of 3,183
received H.264 frames, all decoded and 3,176 drew; decode P95 was 2.1ms. The
fixture requested 60.02 updates/s, but transmitted media reached only 52.89
frames/s. This run loses cadence before client decoding. Shared client system
load was high and is retained with the evidence.

The published ten-minute input/audio attempt stopped after about 510 seconds
with `session_unavailable` despite a focused fixture and active, unlocked login.
A deterministic regression reproduced a seatless SSH login disappearing between
logind enumeration and property lookup. Published v0.22.5 excludes seatless
logins before lookup; missing graphical-session properties still fail closed.
Its published product rerun completed 600.1s and 670 physical inputs at P95
62.8ms. Decoder queue depth stayed zero; 30,226 audio blocks reached the worklet
with at most one pending handoff. Resource sampling opened 136 SSH sessions
without revocation. Physical audio output and audiovisual delay remain unqualified.

A read-only 30s comparison made 2,208 checks/version during 100 SSH exits:
v0.22.4 returned 27 `UnknownObject` errors, v0.22.5 none.

Runtime restart passed on v0.22.4 and v0.22.5: channels closed, old session and
ticket returned 404, and a new session required fresh paint while the fixture
and text survived. The first v0.22.5 restart assertion used a pre-key snapshot
(669 characters versus 670 delivered keys). A focused retry with correlated
pre/post snapshots passed; retain the original harness failure.

A v0.22.4 1440p original-pixel hash failed after wheel scrolling. A focused retry
and v0.22.5 1080p check matched the reference exactly. The initial 1440p cause
remains unresolved; retain both results.

# Diagnostics And Retained Failures

An intrusive v0.22.5 1440p window diagnostic drew 54.70 FPS/32.4ms over 30s.
Capture averaged 60 callbacks/s but only 53-59 changed pictures/s in several
intervals. Typical codec P95 was 3-4ms, submission-to-publication P95 6-8ms and
frame credits 0-2. The fixture requested 59.84 updates/s. This locates lost
cadence before encoding without distinguishing capture timing from compositor
presentation. Short instrumented runs do not replace product matrices. Earlier
1080p diagnostics drew about 56.3 FPS; client load cannot explain every failure.

Retained v0.22.2 Linux 1440p matrices failed at 52.48-53.86 FPS/33.3-33.5ms.
Input runs failed at 83.8/84.3ms, and ten-minute input failed at 80.4ms. Reference
crops matched; observed media handoff was bounded without physical-output proof.
Faster X11 polling, format/cursor changes, extra queues and XDamage did not resolve
cadence and were not adopted.

`udesk24` GNOME 46 Wayland completed user authorization, native input, clipboard,
audio and grant restoration. Its 1080p dynamic result was about 37.6 FPS; capture
alone reached 38-41 FPS. It exposes neither 1440p nor usable hardware encoding.
No Linux GPU qualification follows from this host. A view-only public portal
comparison on `server` still requires host consent. Previous requests timed out,
including a request with the fixture hidden; no request is kept active.

Native macOS candidates passed twelve matrix runs and 611.1-second stability;
these do not qualify published-product behavior.

# Remaining Qualification

- Resolve Linux cadence and the intermittent reference mismatch; complete both published product matrices.
- Complete the macOS 1440p matrix and published ten-minute interaction checks.
- Coordinate real Linux/macOS lock and host-side unlock; distinguish refusal from remote-unlock success.
- Verify shortcuts, display hotplug, application/desktop takeover and macOS Runtime restart/reconnect.
- Qualify physical audio output and accumulated audiovisual delay.
- Regenerate OKF, rerun affected checks and integrate locally only after acceptance.

# Evidence

Task evidence is retained outside the repository under
`task-evidence/remote-desktop-20261001`; screen and clipboard content is not
committed. Representative records are:

- `product-performance-macos-v0224-1080-retest.json` and `macos-resources-macos-v0224-1080-retest.jsonl`: published matrix and resource observations.
- `product-macos-v0224-electron-1080.log`: real Electron office and physical input.
- `product-linux-v0224-office-entry.log`: Linux office, reference, audio and physical input.
- `product-performance-linux-v0224-1080-frameclock.json`: passing cells and retained failed cell.
- `product-linux-v0224-1440-stage-window.log` and `product-linux-v0224-1440-refinement-trace.log`: reference failure and focused retry.
- `product-linux-v0224-1440-input-window.log`: passing input and failed dynamic cadence.
- `product-linux-v0224-ten-minute.log` and `product-linux-restart-linux-v0224-runtime-restart.json`: identity suspension and real restart behavior.
- `identity-churn-probe-server.log`: real login enumeration race and candidate comparison.
- `server-v0224-native-stage-scroll-server.log` and `server-v0224-native-stage-window-server.log`: intrusive native stage timings.
- `server-v0225-detailed-1440-window-server.log`: capture, change, submission, codec and credit observations.
- `product-audiovisual-stability-1080-linux-v0225-stability-native-runtime.json` and `linux-resources-linux-v0225-stability-native-runtime.jsonl`: published stability and SSH sampling.
- `product-failure-linux-v0225-stability-native-runtime.json` and `product-linux-restart-linux-v0225-restart-correlated.json`: stale harness snapshot and corrected restart.
- `product-v0225-*-build-metadata.log` and focused Go/Swift/browser logs: published artifacts, native build and platform contracts.
- `product-progress.json`: task state, Runtime identities and historical observations.
