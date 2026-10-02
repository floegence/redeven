---
type: Acceptance Record
title: Wayland desktop qualification results
description: Assess real GNOME Wayland office behavior and retained capture failures before and after authorized virtual graphics provisioning.
tags: [desktop, linux, wayland, validation, performance]
timestamp: 2026-10-02T14:32:09Z
---
# Summary

The real `udesk24` GNOME 46 Wayland desktop passes the tested office workflow
against published `floe-native-apps` v0.22.6. It does not meet the
[remote desktop performance contract](remote-desktop-validation.md). Authorized
virtual graphics provisioning added an actual 2560x1440 mode but did not resolve
the capture limit: subsequent 1080p and 1440p scrolling failed at 26.43 and
22.14 FPS. Keep failed measurements and the environment boundary explicit;
X11 or synthetic results cannot replace Wayland evidence. The
[overall acceptance record](remote-desktop-results.md) owns local delivery and
the other hosts.

# Verified Deployment And Desktop

The accepted binary has clean source
`6caee6df1da1eabdd5d9f4670d6eedcb578de1a3`, native v0.22.6, native Floeterm,
and SHA-256 `0b7d5c0e818fc8ad732956c1e59a4df26cce3ccf3b5b48386f75bd7c432505f5`.
The product setup API prepared the official host-desktop artifact with digest
`d206fd1864ceebf9170501480ccdfa25f4801e9e48867ee047f0d0744cc1eb6c`.
No sibling wiring, dependency overrides or production system-package installation
were used.

The initial final-stage deployment was mistakenly an older v0.22.2 binary.
Its missing text-input selector stopped the test. Binary/module inspection
identified the mismatch; only the task Runtime was replaced, and the current
tests were repeated. Preserve that failed run without labeling it v0.22.6
acceptance.

The host is KVM with 16 guest CPUs on an AMD Ryzen 9 7950X. Initially its only DRM
card used `bochs-drm`, with no `/dev/dri/renderD*`. Mutter advertised
1920x1080@60 and 1920x1440@60, but no 2560x1440. Temporary supported-mode
changes use Mutter `DisplayConfig`; the original mode is 1280x800@74.994.
Guest configuration alone cannot create a passed-through GPU or make this
software path evidence of hardware encoding. No driver or security policy was
changed, and no independent virtual desktop was substituted.

# Product Interaction

The task uses an isolated Runtime on port 24864, private state and an
authenticated SSH forward. The existing task's OS-authorized restore grant
was transferred to that private state and rotated by the upstream adapter.
The authenticated product setting explicitly enabled unattended reuse; it did
not grant OS permission. Authorization restored without a new consent prompt.

Both resolutions passed Chinese/emoji explicit paste, physical-key input,
pointer targeting, bidirectional clipboard, full screen, view-only restriction
and explicit control takeover in a native GTK Wayland fixture. Tests guard
fixture foreground before input and restore task clipboard changes on exit.
Each input run used 100 samples from viewer DOM keydown through changed marker
and post-render receipt: P95 35.2ms at 1920x1080, 47.3ms at 1920x1440.
These are not physical keyboard-to-monitor measurements.

The initial audio replay delivered three remote system-output tones through the
published Opus/player/worklet path to the Mac destination clock. Following
provisioning, a separate replay again delivered three tones with Chromium's mute
flag removed, a running AudioContext, advancing output timestamps and no page
errors. The user explicitly confirmed hearing them from the Mac output. This
qualifies physical playback for that Linux-to-Mac path; destination-clock progress
alone is not acoustic proof or a calibrated latency measurement.

# Performance And Diagnostics

Each reported product scroll cell ran at least 60 seconds. The first cell
failed the unchanged FPS threshold, so the matrix stopped and retained its
failure; three passing repetitions and window-motion qualification were not
obtained.

| Captured size | Actual painted FPS | Interval P95 | Refinement | Bandwidth |
| --- | --- | --- | --- | --- |
| 1920x1080 | 36.539 | 31.6ms | 234.4ms | 3.257Mbps |
| 1920x1440 | 39.647 | 33.5ms | 253.9ms | 3.611Mbps |

Both used x264 and Chromium WebCodecs `no-preference`, with no recorded decoder
or protocol error. The 1920x1440 fixture updated at 51.36/s; the 1080p fixture
reported 71.23/s. Fixture clock rate is not presented FPS or proof of physical
refresh rate.

The pinned media stack's raw PipeWire acquisition, with BGRA conversion but no
encoder, measured 37.36 FPS at 1920x1440 over about 20 seconds. A second raw
1080p diagnostic negotiated native BGRx with no conversion or encoding and
measured 36.36 FPS, interval P95 31.22ms. Its stream caps advertise maximum
60/1, not a delivered 60 FPS. An unconstrained direct-caps diagnostic first
failed with `target not found` and zero frames; the constrained diagnostic and
failure are retained separately.

These comparisons locate a limit in the authorized capture path before product
encoding and client decode. They do not prove that GPU absence is the sole
cause or identify an exact Mutter/virtual-display scheduling defect. Changing
bitrate cannot repair a raw 36-37 FPS source. The software-mode observations
must not be relabeled as passing hardware tests.

# Authorized Virtual Graphics Comparison

The user explicitly approved provisioning the hypervisor's GL/EGL/Mesa userspace
dependencies and normally shutting down and starting only VM 106. The guest now
uses `virtio-gl`, `virtio_gpu` and `renderD128`; the hypervisor's QEMU process uses
the existing Radeon render device. The preferred virtual display size is
2560x1440 through QEMU's `xres`/`yres` properties. A second normal guest restart
was required for that advertised mode. The user performed both graphical logins.

The previous mounted installer ISO had no read permissions and prevented the
first start. Ejecting that virtual CD allowed the installed guest to boot;
the ISO file, its permissions and the VM's system disk were unchanged. No other
VM configuration, kernel driver or system security policy was changed, and the
hypervisor was not rebooted. This was explicit test-host provisioning, not a
product installation path or a replacement private desktop.

The same published product binary passed its office flow at both actual capture
sizes. The first 60-second scrolling cell at each size failed, so neither result
is a complete three-repetition matrix:

| Capture | Painted FPS | Interval P95 | Refinement |
| --- | --- | --- | --- |
| 1920x1080 | 26.430 | 51.4ms | 387.5ms |
| 2560x1440 | 22.139 | 58.7ms | 334.9ms |

Both still selected software `x264enc`; the new render device does not certify a
hardware encoder. The 1080p fixture itself updated at 26.95/s. Raw 1080p capture
without conversion or encoding was 32.26 FPS with the console open and 32.91 FPS
after the user closed noVNC. A separate no-capture scrolling fixture measured
49.71 updates/s. Console closure alone therefore did not resolve the deficit.

An explicit four-buffer 1440p raw-capture diagnostic measured 26.61 FPS. Direct
DMA_DRM and linear BGRx DMA-BUF diagnostics failed format negotiation and produced
no frames; no production fallback was added. A bounded GPU performance-profile
comparison measured 19.16 FPS and did not improve the result. Only this VM held
the render device during that comparison; the original `auto` profile was restored
and read back. Instantaneous GPU utilization reached 100% during one product
sample, but this is not a causal profile or an attribution of every missed frame.

The 1440p display prerequisite is now resolved. The unchanged FPS and frame-time
thresholds remain unmet on this host; neither virtual GPU presence nor successful
office input closes that qualification boundary.

# Cleanup Boundary

Restore temporary display selections to the provisioned desktop's mode, stop only
the task Runtime and its fixtures, close its SSH forward and remove its temporary
state after evidence collection. The explicitly authorized virtual display
configuration remains separate from temporary test resources. Existing user
Runtimes, applications and OS security settings remain outside task cleanup.
Retain credentials and captures only in private evidence, never repository content
or audit bodies.

# Evidence

Private records live in `task-evidence/remote-desktop-20261001/`:

- `udesk24-v0226-environment-readback.log`: DRM device boundary.
- `udesk24-v0226-product-wayland.log`: rejected older-binary deployment.
- `product-input-1080-udesk24-v0226-wayland-office-current-1920x1080.json` and `product-input-1080-udesk24-v0226-wayland-office-current-1920x1440.json`: input-to-paint observations; filenames retain the harness's default label, while recorded canvas dimensions identify the actual size.
- `product-performance-udesk24-v0226-wayland-office-current-1920x1080.json` and `product-performance-udesk24-v0226-wayland-office-current-1920x1440.json`: failed 60-second cells.
- `udesk24-v0226-raw-capture.json`, `udesk24-v0226-raw-capture-direct-1080.json` and `udesk24-v0226-raw-capture-direct-unconstrained-failure.json`: source isolation and retained negotiation failure.
- `udesk24-v0226-audio-listening.json`: Opus/worklet and destination-clock replay.
- `udesk24-v0226-audio-listening-virtio-gl-replay.json`: separate replay with explicit human listening confirmation.
- `udesk24-virtio-gl-configuration-results.json`: authorized configuration, actual dimensions, failed product cells and diagnostic comparisons.
- `hypervisor-vm106-1440-mode.log` and `hypervisor-vm106-gpu-profile-comparison.log`: display provisioning and bounded profile observation.
