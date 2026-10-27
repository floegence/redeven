---
type: Acceptance Record
title: Wayland desktop qualification results
description: Assess real GNOME Wayland office behavior and retained capture failures before and after authorized virtual graphics provisioning.
tags: [desktop, linux, wayland, validation, performance]
timestamp: 2026-10-03T03:35:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

udesk24 GNOME 46/native v0.22.7 passes office/mode recovery. User designated it functional-only on 2026-10-02, so graphics performance does not block scoped delivery. Its 1080p/1440p scrolling still fails at 27.46/23.46 FPS after authorized provisioning. Preserve failures; X11/synthetic results cannot substitute. Overall results own other hosts/delivery.

# Contract

## Verified Deployment And Desktop
The earlier accepted v0.22.6 build used clean source `6caee6df1da1` and native Floeterm. An initial older-v0.22.2 deployment failed before text input and was replaced only in the task Runtime; retain that failure with its original version.

No independent virtual desktop was substituted.

## Product Interaction
The task uses an isolated Runtime on port 24864, private state and an authenticated SSH forward.

This qualifies physical playback for that Linux-to-Mac path; destination-clock progress alone is not acoustic proof or a calibrated latency measurement.

## Desktop Launcher Admission Regression
On 2026-10-03, the real Desktop launcher exposed a product contract bug: desktop session `target_url` included `/_redeven_desktop/`, while Desktop window admission requires the registered loopback origin.

The fix returns the port-forward service's canonical origin, retains Desktop's strict validation, preserves IPC rejection diagnostics and removes misleading host-confirmation guidance after a failed launch.

The already-running user Runtime and Desktop were not restarted or replaced.

## Performance And Diagnostics
Each reported product scroll cell ran at least 60 seconds. The first cell failed the unchanged FPS threshold, so the matrix stopped and retained its failure; three passing repetitions and window-motion qualification were not obtained.

| Captured size | Actual painted FPS | Interval P95 | Refinement | Bandwidth |
| --- | --- | --- | --- | --- |
| 1920x1080 | 36.539 | 31.6ms | 234.4ms | 3.257Mbps |
| 1920x1440 | 39.647 | 33.5ms | 253.9ms | 3.611Mbps |

An unconstrained direct-caps diagnostic first failed with `target not found` and zero frames; the constrained diagnostic and failure are retained separately.

## Authorized Virtual Graphics Comparison
The user explicitly approved provisioning the hypervisor's GL/EGL/Mesa userspace dependencies and normally shutting down and starting only VM 106.

| Capture | Painted FPS | Interval P95 | Refinement |
| --- | --- | --- | --- |
| 1920x1080 | 26.430 | 51.4ms | 387.5ms |
| 2560x1440 | 22.139 | 58.7ms | 334.9ms |

Raw 1080p capture without conversion or encoding was 32.26 FPS with the console open and 32.91 FPS after the user closed noVNC.

Direct DMA_DRM and linear BGRx DMA-BUF diagnostics failed format negotiation and produced no frames; no production fallback was added.

## Published v0.22.7 Follow-up
Clean Redeven source `69cd04988970c8b456f751838523e61625531d3c` uses the official v0.22.7 module and Linux component digest `09bfc6f9061997c43166ff7810092bf5e79ffaac0112d14a0a0711808e1709bc`.

Preserve the failure; the passing retry alone does not establish its cause.

| Capture | Painted FPS | Interval P95 | Refinement |
| --- | --- | --- | --- |
| 1920x1080 | 27.458 | 47.1ms | 303.7ms |
| 2560x1440 | 23.458 | 57.1ms | 335.1ms |

# Boundaries

## Cleanup
Restore temporary display selections to the provisioned desktop's mode, stop only the task Runtime and its fixtures, close its SSH forward and remove its temporary state after evidence collection. Retain credentials and captures only in private evidence, never repository content or audit bodies.

# Evidence

- `udesk24-v0226-environment-readback.log`: DRM device boundary.

- `udesk24-v0226-product-wayland.log`: rejected older-binary deployment.

- `product-input-1080-udesk24-v0226-wayland-office-current-1920x1080.json` and `product-input-1080-udesk24-v0226-wayland-office-current-1920x1440.json`: input-to-paint observations; filenames retain the harness's default label, while recorded canvas dimensions identify the actual size.

Private records live in `task-evidence/remote-desktop-20261001/`:
