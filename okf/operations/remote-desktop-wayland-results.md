---
type: Acceptance Record
title: Wayland desktop qualification results
description: Assess real GNOME Wayland office behavior and retained capture failures before and after authorized virtual graphics provisioning.
tags: [desktop, linux, wayland, validation, performance]
timestamp: 2026-10-03T03:35:00Z
---
# Summary

The real `udesk24` GNOME 46 Wayland desktop passes the tested office workflow
and display-mode recovery with published `floe-native-apps` v0.22.7. The user
designated this host for functional validation only on 2026-10-02; its graphics
performance does not block delivery. It still fails the
[performance contract](remote-desktop-validation.md): current 1080p/1440p
scrolling reaches 27.46/23.46 FPS despite authorized virtual graphics provisioning.
Preserve the failures; X11 or synthetic results cannot replace Wayland evidence.
The [overall record](remote-desktop-results.md) owns delivery and the other hosts.

# Contract

## Verified Deployment And Desktop

The earlier accepted v0.22.6 build used clean source `6caee6df1da1` and native
Floeterm. No sibling wiring, dependency overrides or production system-package
installation were used. An initial older-v0.22.2 deployment failed before text
input and was replaced only in the task Runtime; retain that failure with its
original version. The published v0.22.7 identity is recorded below.

The host is KVM with 16 guest CPUs on an AMD Ryzen 9 7950X. Initially its only DRM
card used `bochs-drm`, with no render device or 2560x1440 mode. Temporary modes
use Mutter `DisplayConfig`; the initial mode was 1280x800@74.994. Guest settings
alone do not certify GPU encoding. No independent virtual desktop was substituted.

## Product Interaction

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

## Desktop Launcher Admission Regression

On 2026-10-03, the real Desktop launcher exposed a product contract bug: desktop
session `target_url` included `/_redeven_desktop/`, while Desktop window admission
requires the registered loopback origin. The window was rejected before native
attachment, so no host authorization prompt could appear. Earlier direct-viewer
and mocked-window tests did not exercise that boundary.

The fix returns the port-forward service's canonical origin, retains Desktop's
strict validation, preserves IPC rejection diagnostics and removes misleading
host-confirmation guidance after a failed launch. Deterministic tests cover the
actual Go manager/forward result and the TypeScript API-client-to-window-validator
flow, including rejection and cleanup of malformed targets.

A task Runtime on `udesk24` port 24929 with an isolated state directory and
published native components v0.22.8 was opened from the production Electron
41.10.5 shell through an SSH-forwarded local URL. The actual Host Applications
**Connect to desktop** button opened the independent viewer and its native
Flowersec resource session. GNOME exported a pending RemoteDesktop portal request
and the native helper remained active waiting for the host user. No restore grant
was copied into this task; system approval was requested normally. This proves
window admission through host authorization request, not approval or frame delivery.
The already-running user Runtime and Desktop were not restarted or replaced.

## Performance And Diagnostics

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

## Authorized Virtual Graphics Comparison

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

## Published v0.22.7 Follow-up

Clean Redeven source `69cd04988970c8b456f751838523e61625531d3c` uses the official
v0.22.7 module and Linux component digest
`09bfc6f9061997c43166ff7810092bf5e79ffaac0112d14a0a0711808e1709bc`.
The isolated Runtime remains on port 24864; no dependency override is used.
An initial deploy attempted a second Runtime while the task's old PID still held
its state lock and failed with `agent.lock`. The deployment harness was corrected
to verify the exact listener, executable and state before replacing that task
Runtime. The successful retry is retained separately.

The published product passes Chinese/emoji paste, pointer, drag selection,
scrolling, clipboard, full screen, view-only and takeover. GTK focus initially
selected all text and caused native drag-and-drop during a selection test; the
harness now sends ArrowRight and observes collapsed selection before dragging.
The corrected office run passes without a production change. Actual
1440p -> 1080p -> 1440p recovery also passes; the
[reconnect record](remote-desktop-recovery-results.md) owns that lifecycle proof.

A 100-input 1440p run failed P95 at 95.9ms. The smallest corresponding retry
passed at 66.8ms; a separate 1080p run passed at 34.5ms. Preserve the failure;
the passing retry alone does not establish its cause. New first scrolling cells
each ran 60 seconds and again failed the unchanged thresholds:

| Capture | Painted FPS | Interval P95 | Refinement |
| --- | --- | --- | --- |
| 1920x1080 | 27.458 | 47.1ms | 303.7ms |
| 2560x1440 | 23.458 | 57.1ms | 335.1ms |

Both selected x264; sampled client decode queue depth remained zero. The fixture
updated at 28.02/s and 23.47/s during those captures. Together with earlier raw
capture comparisons, this places the sustained limit in the host graphics/capture
path without identifying one causal component. Neither a complete performance
matrix nor Wayland ten-minute qualification is passed. The preferred
2560x1440@74.998 mode was restored and read back after the 1080p tests.

# Boundaries

## Cleanup

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
- `udesk24-v0227-deployment.log` and `udesk24-v0227-deployment-green.log`: retained state-lock failure and verified task-only replacement.
- `udesk24-v0227-drag-selection-observed.log` and `udesk24-v0227-published-mode-restoration-display-recovery.json`: corrected office selection and actual display recovery.
- `product-input-1440-udesk24-v0227-published-1440-observed.json`, `product-input-1440-udesk24-v0227-input-minimal-retry.json` and `product-input-1080-udesk24-v0227-input-1080-retry.json`: failed input observation and focused retries.
- `product-performance-udesk24-v0227-scroll-1080-retry.json`, `product-performance-udesk24-v0227-scroll-1440-retry.json` and `udesk24-v0227-1080-mode-restoration.json`: current failed cells and original-mode readback.
