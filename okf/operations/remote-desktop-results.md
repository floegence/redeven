---
type: Acceptance Record
title: Remote desktop product, reconnect and physical-device evidence
tags: [desktop, linux, macos, validation, performance]
lifecycle: retained_history
reviewed_at: "2026-11-04"
retention_reason: "Keeps historical product failures and platform qualification limits distinct from later repairs."
---
# Summary

Published product runs separately qualify office interaction, reconnect, physical locks and capture formats. Keep failed latency, frame, authority and setup outcomes with their original versions. Later successes cover named fixtures only; physical IME, acoustic output, photons and cross-product parity remain limited.

# Contract

[Viewer](../architecture/remote-desktop-viewer.md), [media](../architecture/remote-desktop-media.md) and [SSH deployment](../architecture/remote-desktop-ssh-deployment.md) own current authority. Generation/mode/lock/failed decode revokes input until fresh paint. Native command IDs prevent naïve client ordinal correlation. Preserve embedded cursors on macOS/Wayland; X11 readback/scaling/IPC/upload remain CPU-visible. Input receipts and command acceptance never establish pixels, application completion or exit. Physical/Unicode routes retain explicit OS consent and no permanent display-policy changes.

# Boundaries

Named hardware/workloads only: no universal GPU/zero-copy/WAN/photon/RustDesk/NoMachine claim. Assisted textarea Unicode is not human IME; synthetic composition/device emulation is not physical-device evidence. Restore units/records byte-exact and remove only owned processes/state/keys/tunnels/containers; keep host services. Untested lock/hotplug/audio/first-time TCC or complete Desktop I/O remain unqualified.

# Evidence

## Initial product and reconnect
Consumer6caee6df1da1/native0.22.6 dec4e3f4: Mac/X11 office, performance and10-minute queue/input pass; Mac1080p/1440p minima57.582/57.657 FPS. Retain Mac38.323 FPS,33.3ms interval,82.2ms input and KEYFRAME_REQUIRED failures. musl cannot load glibc CUDA; x264 remains, higher acquisition cost rejected for negligible FPS. Regression/race pass; local integration2945183 preserves commits. udesk24 functional-only, remote unlock/hardware encoding/parity unqualified. Raw metadata/performance/stability/audio summaries remain at task-evidence/remote-desktop-20261001/product-progress.json and published-v0226-*/product-performance-macos-v0226-* records.

Native0.22.7 repairs player closure despite enabled sound: Linux/macOS AudioWorklet reconnect, fresh-paint authority and X11 two100-sample P95s66.5/67.6ms. Consumer69cd04988970/native29ed2f3f; earlier X11cb2fd0c6c/Mac07337d3098 remain in Git. Native STALE_DESKTOP differs from product pre-dispatch ignore. Wayland DISPLAY_STREAM_LOST retires input/frames, reauthorizes Portal, returns fresh1280x800. Evidence: viewer-reconnect-audio-red.log, browser/Linux/Electron audio green logs,server-product-reconnect-regression-v0226.json. Acoustic output and udesk24 performance remain unpassed.

## Encoding and drag
X11 i7-14700KF/RTX4090D,NVIDIA550.90.07,1080p60,Mac decoding: native0.22.10 click P95 light84.8→71.7ms,scroll88.3→75.2ms,decode-to-draw lower. Initial NVENC omitted SPS restrictions. Physical Unix/DRM0.22.29 excludes SSH/browser. [Release37204885377](https://github.com/floegence/floe-native-apps/actions/runs/37204885377)/[source0.22.10](https://github.com/floegence/floe-native-apps/tree/v0.22.10) retain exact scope.

October4 Desktop SSH/HTTP2/Floe0.81.6 same X11 hardware: four drag baseline P95s84.06–86.51ms versus three69.13–74.06ms, all retained. Four cursor shapes/decoder recovery/view-only-control restoration pass. [Floe release37211906286](https://github.com/floegence/floe-webapp/actions/runs/37211906286) and checkRemoteDesktopViewer.mjs own qualification; correlated frames prove no photons/parity.

## Physical input
Native0.22.33 wake/local composition with web0.86.19; old and new three100-move rounds at max1920/15FPS/original pixels. Receipt/DRM ms:

| Host/version | Receipts | DRM |
| --- | --- | --- |
| udesk26 .32 |3.699/4.194/3.696|17.659/17.692/18.118|
| udesk26 .33 |7.655/7.191/10.015|16.946/17.094/17.039|
| Orange .32 |5.060/6.750/5.678|5.498/6.523/6.035|
| Orange .33 |11.566/12.063/14.842|8.907/7.869/11.809|

udesk26amd64/1920x1280 and Orangearm64/1920x1080 verify attachment/stale rejection/teardown/ASCII/Chinese/emoji/Enter; later pixels prove bounded AB24 normalization. One udesk26 Viewer cursor P95 44.0/41.2/47.6ms with6/8/6 matches has no matched baseline or70% reduction. GTK Space black/white at60FPS/original, median/P95 per round:

| Host/version | Rounds ms |
| --- | --- |
| udesk26 .32 |86.283/193.823;76.856/192.253;73.528/98.269|
| udesk26 .33 |73.765/94.790;62.772/84.435;50.607/89.433|
| Orange .32 |241.530/267.476;255.642/282.653;246.081/257.422|
| Orange .33 |96.195/265.283;100.704/274.402;103.856/224.087|

Physical-only fixes Orange lock IME leakage; Chromium/WebKit/Firefox cover empty codes/stale composition/release without weakening ordinary text. udesk26 unlock passes. Native login_latency/text/unlock qualification and host_desktop_drm/login seat sources retain raw logs outside Git without passwords/input text. Task ports24236/24246/24247 excluded23998; full physical-host acceptance remains incomplete.

The udesk26 lock-screen delay has a measurable scheduling cause: DRM capture polls
unchanged scanout at 5 Hz to bound idle CPU/GPU work, while a real input calls the
native `interacted` wake path and returns capture to the negotiated rate for a
short window. This explains why the first lock-screen response can feel slower
than an already-active desktop. The viewer now arms physical unlock as soon as a
lock frame is painted, removing the extra click without changing that native
wake or any authority check. Fixed high-rate lock capture is intentionally not
enabled; future latency work should measure input-to-first-changed-frame and
retain the idle resource bound together.

## AFBC and device Viewer
Native0.22.34 commit2bcd721e2eeb68947c3943627ab0135068f2b808 decodes Orange1920x1080 Wayland legacy AFBC via EGL on HDMI-A-2. Actual pixels/lock/invalid-valid unlock/new generation and udesk26 regression pass without Portal/driver/ACL/compositor changes. Unsupported drivers/modifiers/private swizzle/HDR/AR24/multiplane reject. Published drm/worker.c,scanout_format tests,host_desktop_drm_native_test.py,host_desktop_afbc_pattern.py and login_capture_linux_test.go retain format/errno/FD/pixel proofs.

October11 actual Desktop Update/Env-authorized0.22.34 deployment on udesk26: real picture/input,assisted Unicode,physical unlock,switch/fullscreen/disconnect and ten socket-loss recoveries. Median2015.7/P95 2230.2ms excludes photons; wrong password stays locked. Initial shortcut lacks evidence, later switching passes. Black-lock interval unmeasured; real IME/matched cursor/command RTT/complete Orange/parity unqualified. Orange route/ARP/ICMP/banner is connectivity only. Product owners:remoteDesktopDeployment.ts,viewer.js,attachment.go; Git retains independent GTK receipts.

## Orange follow-up and reacceptance
Orange0.22.37 passes13 release jobs plus Viewer Unicode/lock/unlock/input/media. Consumerbb6683b5ce18,GOWORK=off;b7d994aff911 fixes Node26 linked entry (31checks). Missing published MPP assets still block setup while old service works. Mac Pinyin deferred/host Pinyin unvalidated; improved paired latency/FPS does not erase missing idle replies/SSH recovery failures/later RustDesk tails-disconnects, and LAN loss limits comparison.

October17 consumer7230cf1ae40316efed23c6ff572d03656aded6cc,epoch62,nativeGo0.23.3/Swift0.22.27/Electron41.10.7: actual pixels/input qualify named platforms, not Runtime auth from startup alone. Root-manager interruption requires consent/admission. Portal stale damage y1280/height2 is repaired by8a41f8f convergence; product matches0.23.4, persistent stale frames remain forbidden. Private evidence /Volumes/JianDisk/.codex-cc/artifacts/redeven-desktop-platform-reacceptance-20261016 retains gdm/Linux lock/reconnect images and portal-v0234 input/reconnect/events plus app receipts. Audio/latency/hotplug/first-time TCC remain excluded; failed candidates stay unpublished.
