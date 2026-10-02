---
type: Acceptance Record
title: Current-desktop qualification results
description: Assess published remote desktop measurements, retained failures and outstanding real-host qualification.
tags: [desktop, linux, macos, validation, performance]
timestamp: 2026-10-02T08:35:00Z
---
# Summary

Acceptance remains incomplete for the [desktop contract](../architecture/remote-desktop.md).
Published dependencies pass office checks, the macOS 1080p matrix and Linux
ten-minute input stability. Failed or unfinished performance and real-host checks
prevent integration. Preserve the [acceptance thresholds](remote-desktop-validation.md);
a passing retry neither erases a failure nor establishes its cause. Current
macOS foreground/performance work has resumed while unrelated workloads continue. No Redeven push, push gate or full integration gate is authorized.

# Published Dependency And Conditions

Redeven binary `f07da13f791df23a22126419dc9e43415a09e5f2` uses published
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
A resumed v0.22.5 1440p run passed one scroll cell (57.779 FPS/31.7ms)
and failed the second interval threshold (57.680 FPS/33.3ms). Earlier
v0.22.5 scrolling failed at 38.323 FPS/33ms/359.2ms. Xcode compilation was
observed, but attribution to load remains unproven.

Published v0.22.5 stability attempts encountered decoder recovery, an 82.2ms
input P95 and lost foreground. The corrected driver waits for paint authority
and fixture focus before each key without replay. The 1440p matrix and ten-minute
stability remain unqualified.

The v0.22.5 Runtime restart passed: both channels closed, old session/ticket
returned 404, fresh paint was required, and fixture/text survived without replay.
Expected connection-refused messages during the stopped interval are retained.
Toolbar switching between two owned applications passed. Application-mode/desktop
takeover also passed: declining preserves application control, accepting revokes
its input, and taking control back makes the desktop view-only. Detaching both
viewers leaves the owned application running.

## Linux

The v0.22.4 office workflow passed Chinese/emoji paste, pointer, clipboard,
full screen, view-only and takeover. Input P95 was 68.4ms/67.3ms at 1080p/1440p;
an 800x120 original-pixel crop matched its independent reference. v0.22.5
toolbar application switching also passed with current X server timestamps.

Published Linux dynamic matrices fail. v0.22.5 1080p scrolling measured
44.325 FPS/37.4ms/237.8ms refinement, with 44.34 media frames/s and decode P95
1.7ms. Loss precedes decoding; earlier v0.22.4 failures remain in the ledger.

A v0.22.4 stability attempt exposed a seatless SSH-login race in logind lookup.
v0.22.5 excludes those logins before lookup and fails closed for missing graphical
properties. It completed 600.1s/670 inputs at P95 62.8ms, decoder depth zero,
30,226 audio blocks and at most one pending handoff. All 136 monitoring SSH exits
completed without revocation. Runtime restart passed on both releases; earlier
uncorrelated fixture-counter failures remain alongside the corrected results.

Intermittent original-pixel comparisons failed before the driver captured the
actual PNG draw and awaited its receipt. Focused comparisons now pass, but missing
historical PNG snapshots prevent attributing the earlier failures. Later H.264
draws are assessed separately; full-frame copies occur only in reference checks.

Six Linux system-output tones reached the unmuted Mac AudioContext destination
with advancing clocks. Human listening and accumulated audiovisual delay remain
unqualified; worklet acceptance is not physical speaker evidence.

# Released Capture Update

Upstream v0.22.6 publishes `8b57d73` and `dec4e3f` for acquisition and
reconnection. Source, CodeQL, both native architectures, private applications,
host-desktop media and macOS Swift checks passed. The unchanged amd64 private
application job passed on rerun after a host-systemd initialization failure.
The official module/checksum readback passed; Redeven now pins this release in
Go and Swift. Product rebuild and qualification remain pending. Native-candidate
results below do not substitute for authenticated product acceptance.

The Linux XCB candidate passed all twelve 60-second cells: 1080p/1440p scroll
and window motion, each repeated three times. Minimum painted FPS was 55.416,
maximum interval P95 32.6ms and maximum refinement 249.3ms. It uses software
x264, the original publisher's installed libraries and the diagnostic WebSocket
bridge. XCB avoids per-frame server grabs; cached XFixes shapes and batched
pointer queries preserve the cursor without repeatedly copying its bitmap.

An authenticated, isolated Xvfb fixture passed raw-pixel reference equality,
ten mapping lifecycles without file-descriptor growth, protocol-error isolation,
cursor shape/hotspot/position, Chinese paste, keys, clipboard, pointer and encoder
recovery. Fixture failures and corrected results are retained. No system package was installed.

On macOS, separating pixel comparison from encoder completion reduced measured
callback-queue wait P95 from about 8.6ms to 0.02ms. A bounded pending-sample mailbox
passed cancellation/concurrency tests. Real close-during-start/reconfigure and
concurrent owned-window JPEG/H.264 plus desktop H.264 checks passed. The candidate
1440p matrix passed three scroll cells and one window cell; its second window
cell failed at 46.678 FPS/50.8ms. Unrelated Simulator tests and shared system load
were observed; attribution is unproven. Further format/codec diagnostics are not
production changes or acceptance evidence.

Both platforms had reproducible last-display-return defects: Linux stopped
observing outputs while suspended, and macOS retained an empty selection after
all outputs disappeared. Focused tests failed before the candidate fix and pass
after it. Physical hotplug still requires real-host qualification.

The final native 1440p matrix passed all six 60-second cells with continuously
verified fixture focus: minimum 57.060 FPS, maximum interval P95 30.1ms and
refinement 364.4ms. Prior runs retain an unobserved-visibility 44.781 FPS failure
and a foreground-verified 54.852 FPS run with `KEYFRAME_REQUIRED`. Later drain
instrumentation recorded no flushes or errors; it does not establish the earlier
recovery cause. An intervening scroll attempt stopped on actual foreground loss.

# Lifecycle And Diagnostic Limits

Published v0.22.5 product lock/resume passed on Linux and macOS: explicit product
confirmation locked the host, media and input stopped, and normal local-user
unlock resumed only after fresh paint. Neither host is qualified for remote
unlock. Viewer regressions additionally cover confirmation authority changes,
asynchronous audio setup and removed saved displays during takeover.

Earlier acquisition, input and reference failures remain in the ledger. Encoder
removal and Present pacing alone did not fix X11 cadence. Diagnostic interceptors,
unpublished helpers, altered players and candidate-only stability are not formal
dependency evidence; later passes never erase previous failures.

`udesk24` GNOME 46 Wayland passed authorization, input, clipboard, audio handoff
and grant restoration. Dynamic 1080p was about 37.6 FPS and capture alone
38–41 FPS; it exposes neither 1440p nor usable hardware encoding. The X11 change
does not qualify or repair this Wayland host's capture limit.

# Remaining Qualification

- Deploy v0.22.6 and repeat both Linux product dynamic matrices.
- Resolve macOS performance and complete 1440p and ten-minute interaction.
- Verify physical hotplug and rerun affected lifecycle checks after dependency upgrades.
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
- `lifecycle-*-lock*.json`: published lock, media pause and local unlock recovery.
- `macos-takeover-published-app-desktop-normalized-display.json`: ownership transfer.
- `server-xcb-candidate-matrix-summary.json`: all twelve candidate cells.
- `xcb-isolated-qualification-dec4e3f.log`: isolated native X11 checks.
- `macos-handoff-candidate-matrix.log`: retained native macOS matrix failure.
