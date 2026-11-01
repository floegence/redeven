---
type: Acceptance Record
title: Wayland legacy MemFd capture compatibility
tags: [desktop, linux, wayland, validation, compatibility]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
---
# Summary

Readable authorized MemFd frames must work when older producers omit MAPPABLE. The repair validates size/aligned offset/pixel range before mapping; 19 native tests pass. The normal udesk24 product reproduces CAPTURE_LAYOUT_UNSUPPORTED, but repaired real GNOME capture and complete release qualification remain unpassed.

# Contract

[Media](../architecture/remote-desktop-media.md) owns lifetime/cursor/damage. Tests cover padding/unaligned rows, read-only access, mapping identity/truncation and cleanup; published predecessor remains unchanged.

# Boundaries

Fresh Portal request times out waiting consent. Weak-VM performance waiver never waives functionality; native failure suspends generation. Git retains failing release and red/green records.

# Evidence

- `scope.json`: product failure sequence and task boundaries.

- `installed-layout-red.log` and `installed-layout-green.log`: same producer, old/new client regression and control/view/reconnect results.

- `unit-red.log`, `unit-green.log` and `native-source-gate.log`: focused regression and upstream source validation.

Private evidence lives in `task-evidence/wayland-buffer-layout-20261005/`:
