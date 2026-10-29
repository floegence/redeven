---
type: Acceptance Record
title: Wayland legacy MemFd capture compatibility
tags: [desktop, linux, wayland, validation, compatibility]
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

This record owns the reproduction and acceptance evidence for the Wayland MemFd
compatibility repair. The [media contract](../architecture/remote-desktop-media.md)
owns buffer lifetime, cursor ownership and damage handling. An authorized readable
system-memory frame must work when an older producer omits the MAPPABLE flag;
invalid bounds must fail without reading outside the backing file. A native
capture failure still suspends the generation. Synthetic compatibility evidence
cannot certify an actual GNOME session or physical latency.

# Contract

## Reproduction And Repair
The ordinary Desktop connection to `udesk24`, using its normal saved portal grant, progressed from authorization to active generation 1, then immediately suspended with `CAPTURE_LAYOUT_UNSUPPORTED` in generation 2.

The native repair maps only a readable MemFd with validated file size, aligned mapping offset and bounded pixel range. The old published component remains identifiable and is never modified in place.

## Verification
### Regression And Installed Libraries

Nineteen focused Python checks cover metadata, damage continuity, padded pixels, non-page-aligned MemFd offsets, read-only access, mapping reuse/removal, changed buffer identity, invalid/truncated backing files and idempotent stream cleanup.

The complete release gate remains failed, so these results do not certify the full release qualification matrix.

# Boundaries

A fresh isolated GNOME portal diagnostic timed out waiting for OS sharing consent. The normal product reproduced the original failure, but successful real GNOME capture with the repair remains unverified.

Weak-VM performance thresholds remain waived; functional checks are not waived.

# Evidence

- `scope.json`: product failure sequence and task boundaries.

- `installed-layout-red.log` and `installed-layout-green.log`: same producer, old/new client regression and control/view/reconnect results.

- `unit-red.log`, `unit-green.log` and `native-source-gate.log`: focused regression and upstream source validation.

Private evidence lives in `task-evidence/wayland-buffer-layout-20261005/`:
