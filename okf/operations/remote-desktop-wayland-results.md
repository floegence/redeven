---
type: Acceptance Record
title: Wayland capture qualification and unresolved limits
tags: [desktop, linux, wayland, validation, performance]
lifecycle: retained_history
reviewed_at: "2026-11-04"
retention_reason: "Preserves unresolved live GNOME failures and the limits of synthetic capture improvements."
---
# Summary

Live GNOME, installed native fixtures and synthetic PipeWire measurements qualify different paths. Retain the functional-only udesk24 designation, failed consent/layout/performance results and exact published identities. Later synthetic improvements do not certify live capture, physical input or full release acceptance.

# Contract

Current [media](../architecture/remote-desktop-media.md) owns lifetime, cursor, damage and encoder leases. Preserve final-frame recovery and interruptible shutdown. Readable authorized legacy MemFd without MAPPABLE must validate size/aligned offset/pixel extent before mapping; missing negotiated cursor metadata fails explicitly. Hardware preferences follow actual capabilities. Source integration never restarts Runtime or admits screen sharing.

# Boundaries

udesk24's October2 performance-only waiver never waives functionality. Synthetic headless/SSH/native tests cannot certify slower live GNOME, physical input or a repaired release. Native failure suspends generation. Restore display modes and remove task-owned resources only; credentials/captures stay private. Published predecessors remain unchanged until qualification succeeds.

# Evidence

## GNOME
udesk24 GNOME46/native0.22.7 office/mode recovery passes; 1080p/1440p scroll remains27.458/23.458 FPS after authorized VM106 provisioning. Raw capture32 FPS; DMA_DRM/BGRx DMA-BUF negotiation fails without fallback. No55 FPS, three repetitions or window-motion pass. Task port24864/private state/forward uses real desktop; old0.22.2 rejected before task-only0.22.6 upgrade, canonical-origin fix retains strict admission and user Runtime/Desktop untouched. Evidence: task-evidence/remote-desktop-20261001/, udesk24-v0226-environment-readback.log, udesk24-v0226-product-wayland.log and both product-input-1080-udesk24-v0226-wayland-office-current dimension-labelled JSONs. Actual canvas dimensions override harness filename labels.

## MemFd
Normal product reproduces CAPTURE_LAYOUT_UNSUPPORTED. Nineteen native tests pass padding/unaligned rows/read-only mapping/identity/truncation/cleanup, but fresh Portal consent times out; repaired real GNOME and complete release remain unpassed. Evidence: task-evidence/wayland-buffer-layout-20261005/{scope.json,installed-layout-red.log,installed-layout-green.log,unit-red.log,unit-green.log,native-source-gate.log}. Git retains failing release/red-green identities.

## Cursor and scheduling
Native0.22.12 synthetic BGRA/header/damage/animated-cursor fixtures prove reply delivery cannot block capture/authority and post-gap changes survive. No observation threshold. Fresh GNOME HOST_CONSENT_TIMEOUT prevents live latency claims. Immutable ba8ecda3294a732c25a4829734896139f6df7ad8 verifies through Go proxy/SumDB; Go/Swift consumers published. Evidence: task-evidence/desktop-cursor-ownership-20261005/, pipewire-qualification.log,portal-input-qualification.log,damage-benchmark.json,benchmark-damage.py,upstream-main-push-final.log,upstream-qualification-status.json.

## Capture pool
Native0.22.14 replaces full-frame copies with bounded pooling;36 native tests pass. Alternating udesk24 synthetic1440p60/x264: encoded46.86–48.06→59.90 FPS,capture19.34–19.96→2.64–2.79ms,paint ACK improves. Not live GNOME/physical-input qualification. Source ec0d9cc8/tables remain in Git. Published host_desktop_pixels.py/pipewire.py/media.py and qualification pixel/PipeWire modules own checks. [Release37320233514](https://github.com/floegence/floe-native-apps/actions/runs/37320233514) records both architectures/macOS/distribution.
