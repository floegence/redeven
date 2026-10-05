---
type: Acceptance Record
title: Wayland legacy MemFd capture compatibility
description: Verify the fix for immediate post-authorization capture failure with older GNOME PipeWire producers.
tags: [desktop, linux, wayland, validation, compatibility]
timestamp: 2026-10-05T05:30:00Z
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

The ordinary Desktop connection to `udesk24`, using its normal saved portal grant,
progressed from authorization to active generation 1, then immediately suspended
with `CAPTURE_LAYOUT_UNSUPPORTED` in generation 2. The running Runtime contained
Redeven commit `be653778e468` and native v0.22.12. This reproduces a functional
regression independently of the VM's graphics performance.

The host runs Mutter 46.2 and PipeWire 1.0.5; the component supplies libpipewire
1.4.9. Mutter 46 allocates MemFd with READWRITE flags but without MAPPABLE.
PipeWire 1.0 maps by memory type as well as by flag; 1.4 requires MAPPABLE. Thus
requesting MAP_BUFFERS is insufficient: the capture client can receive a valid
MemFd with a null data pointer. The previous implementation rejected this layout.

The native repair maps only a readable MemFd with validated file size, aligned
mapping offset and bounded pixel range. Its read-only mapping follows the
PipeWire buffer lifetime and is reused for subsequent frames. Removal and stream
closure release mappings without closing producer-owned descriptors. Pixel
copies complete before requeue, and existing cursor, sequence and damage rules
remain authoritative. The old published component remains identifiable and is
never modified in place.

## Verification

### Regression And Installed Libraries

The same private synthetic producer was run against old and repaired capture
clients on `udesk24`. It allocates MemFd without MAPPABLE and uses Mutter 46's
384-pixel cursor metadata allocation. The old installed component reproducibly
failed before the first frame with `CAPTURE_LAYOUT_UNSUPPORTED`.

With the repair, both library-mapped and producer-allocated buffers passed
control/view/control transitions. Each mode produced one cursor-free control
frame with 101 shape updates, 101 composited view frames with zero separate shapes,
then one control frame with 101 shapes. No capture errors occurred, and no owned
mapping survived stream closure. This local debug run used the installed private
media libraries with task-owned candidate Python source; it is not published
package provenance evidence. No user desktop pixels or OS input were involved.

Nineteen focused Python checks cover metadata, damage continuity, padded pixels,
non-page-aligned MemFd offsets, read-only access, mapping reuse/removal, changed
buffer identity, invalid/truncated backing files and idempotent stream cleanup.
The upstream source gate also passes Go race/vet, platform builds and the existing
source regression suites.

### Distribution

The immutable v0.22.13 tag resolves through the Go proxy and checksum database to
`eb15a01f9dd0f021d7a70348680ea2919522c349`. A CLI built from that verified module
prepared a new task-owned host-desktop installation on `udesk24`, revalidating
copies of the original archive cache. The resulting component digest is
`a1bc3534cbd4734f26633eecfb8688b430b656740590033e5eefdc56ee27433a`. Both allocation
modes repeated the complete transition checks above with the installed published
helper, independently of the debug source overlay.

Fresh installed host-desktop release checks passed on native amd64 and arm64,
including both PipeWire allocation modes. Redeven's published-player Wayland
browser fixture, remote desktop Go tests and 32 macOS helper Swift tests passed.
The Go/Swift manifests select the exact published version. Source CI, CodeQL and
dependency vulnerability scanning passed. After retrying failed jobs in
[release qualification run 37268136945](https://github.com/floegence/floe-native-apps/actions/runs/37268136945),
general native arm64 and both private desktop architectures passed. General
native amd64 stopped twice with `download_failed` before graphical qualification;
the second attempt received 155,163,507 of 177,082,430 expected bytes. Retained
logs distinguish this acquisition failure from capture behavior. The complete
release gate remains failed, so these results do not certify the full release
qualification matrix.

# Boundaries

A fresh isolated GNOME portal diagnostic timed out waiting for OS sharing consent.
No saved user grant was copied into the diagnostic, and no desktop pixels were
recorded. The normal product reproduced the original failure, but successful
real GNOME capture with the repair remains unverified. A read-only inspection of
both running Redeven executables still found native v0.22.12. The user Runtime
has not been replaced or restarted. Integrated source alone does not update
those processes.

A preliminary synthetic allocator with compact 16-pixel cursor metadata exhibited
metadata corruption with the host's older PipeWire stack. Its logs are retained;
the cause was not established by this repair. The maintained MemFd fixture matches
Mutter 46's actual fixed allocation and keeps every cursor and pixel assertion.
This does not claim support for every producer allocation or GPU driver. Weak-VM
performance thresholds remain waived; functional checks are not waived.

# Evidence

Private evidence lives in `task-evidence/wayland-buffer-layout-20261005/`:

- `scope.json`: product failure sequence and task boundaries.
- `installed-layout-red.log` and `installed-layout-green.log`: same producer, old/new client regression and control/view/reconnect results.
- `unit-red.log`, `unit-green.log` and `native-source-gate.log`: focused regression and upstream source validation.
- `published-module.json`, `published-install.log`, `published-pipewire.log` and `release-host-*/`: public module integrity and installed component behavior.
- `release-final.json` and `retry-native-amd64.log`: completed release qualification status and the remaining acquisition failure.
- `redeven-go.log`, `redeven-session-race.log`, `redeven-viewer.log` and `redeven-swift.log`: consumer verification.
- `real-gnome-layout.log`: fresh-consent timeout without desktop data.
- `runtime-version-recheck.json`: old dependency versions in the unchanged user Runtime processes.
- `memfd-address.log` and `memfd-large.log`: retained compact-allocation investigation and larger metadata observations.
- Upstream `host_desktop_pipewire_test.py` and `qualification/host_desktop_pipewire_source.c`: reproducible buffer and producer contracts.
- [Mutter 46.2 stream producer](https://gitlab.gnome.org/GNOME/mutter/-/blob/46.2/src/backends/meta-screen-cast-stream-src.c) and [PipeWire 1.4.9 stream mapping](https://github.com/PipeWire/pipewire/blob/1.4.9/src/pipewire/stream.c): reviewed allocation and mapping behavior.
