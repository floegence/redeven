---
type: Acceptance Record
title: Wayland desktop qualification results
tags: [desktop, linux, wayland, validation, performance]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
---
# Summary

udesk24 GNOME 46/native 0.22.7 passes office/mode recovery but still fails 1080p/1440p scrolling at 27.458/23.458 FPS after authorized graphics provisioning. User designated functional-only on October 2. Preserve failures; X11 and synthetic fixtures cannot replace them or certify three passing repetitions/window-motion.

# Contract

Task port 24864/private state/forward, without substitute desktop. Reject old 0.22.2 before task-only 0.22.6 upgrade. Launcher canonical-origin repair preserves strict admission; user Runtime/Desktop untouched. VM 106 provisioning was explicitly authorized.

# Boundaries

Raw capture remains 32 FPS; DMA_DRM/BGRx DMA-BUF negotiation fails without fallback. Restore display mode and remove owned resources. Git retains all initial/provisioned/published samples, source/component hashes and audio limits.

# Evidence

- `udesk24-v0226-environment-readback.log`: DRM device boundary.

- `udesk24-v0226-product-wayland.log`: rejected older-binary deployment.

- `product-input-1080-udesk24-v0226-wayland-office-current-1920x1080.json` and `product-input-1080-udesk24-v0226-wayland-office-current-1920x1440.json`: input-to-paint observations; filenames retain the harness's default label, while recorded canvas dimensions identify the actual size.

Private records: `task-evidence/remote-desktop-20261001/`.
