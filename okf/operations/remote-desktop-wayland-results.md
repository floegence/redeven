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

Historical outcomes are source-bound; Git and private task-evidence retain tables and failures.

- GNOME 46/udesk24/native 0.22.7 office/recovery passed, but 1080/1440p scroll ~27/23 FPS and raw 32 FPS failed 55-FPS/repetition/motion requirements. DMA-BUF negotiation failed without fallback. Task-only VM/state/ports preserved the user Runtime; actual canvas dimensions govern evidence (task-evidence/remote-desktop-20261001).
- MemFd CAPTURE_LAYOUT_UNSUPPORTED was reproduced; padding/alignment/mapping/identity/truncation/cleanup tests passed. Fresh Portal consent timed out, leaving repaired live GNOME/release unqualified (task-evidence/wayland-buffer-layout-20261005).
- Published native 0.22.12 synthetic BGRA/damage/cursor proved reply delivery cannot block capture/authority or lose post-gap changes. HOST_CONSENT_TIMEOUT blocked live latency qualification (task-evidence/desktop-cursor-ownership-20261005).
- Published 0.22.14 bounded pools passed 36 tests and synthetic 1440p60 improved ~47–48 to 59.90 FPS. This was neither live GNOME nor physical input. Release 37320233514 and published native modules retain architecture/format checks.
