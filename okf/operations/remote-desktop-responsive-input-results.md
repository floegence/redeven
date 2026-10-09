---
type: Qualification Record
title: Physical desktop responsiveness and local input
description: Assess the physical-seat input and DRM capture changes on orange and udesk26, separating native feedback from client presentation.
tags: [desktop, input, drm, latency, qualification]
timestamp: 2026-10-09T19:42:00Z
---
# Summary

Published Floe Native Apps v0.22.33 and Floe Webapp v0.86.11 provide immediate
capture wakeup after idle input, bounded pointer submission and a separate local
text mode. The [media contract](../architecture/remote-desktop-media.md) owns
privileged input authority; the [viewer contract](../architecture/remote-desktop-viewer.md)
owns physical versus local text interaction. Locked sessions accept physical
unlock input only. A mode change releases input and never grants frame authority.
This record separates real DRM feedback, document text and client presentation;
native receipts alone do not establish visible response or input-to-photon latency.

# Contract

## Diagnosis and implementation

The previous Viewer disabled local text when clipboard synchronization was
unavailable, even though the physical desktop could accept text through its
separate selection transfer. The explicit `text_input` capability now enables
local composition independently. Ordinary printable keys use one ordered text
path in local mode; shortcuts and non-text keys retain their physical contract.
The service validates the current physical seat before both text transfer and
the following physical paste gesture. Credentials never use this text path.

DRM capture previously waited for its next idle sampling interval after input.
The first admitted interaction now wakes capture; subsequent interactions retain
the configured frame-rate budget. Pointer motion holds one latest pending
position and flushes before buttons, wheel, text and keys. These changes extend
the existing upstream owners instead of adding product-side input queues.

The review used RustDesk `001b0e96173cea4e49f9f7a67bea95a177dd1de3`
(`src/platform/linux.rs`) and Sunshine
`899095522a9ed50bb511d6f1fd103b8ad716d527` (`src/input.cpp`), both dated
2026-10-09. RustDesk offers an active-UID read that avoids spawning `loginctl` on
the hot path. Sunshine serializes queued dispatch and batches compatible motion
while preserving keyboard ordering. These support removing subprocess stalls
and preserving one input owner. Redeven retains its stricter live physical-seat
checks and its existing bounded controller; neither project's source was copied.

Orange also showed approximately 500 ms stalls in kernel connector/EDID queries
for an unused HDMI-A-1 output. Disabling that output during investigation removed
the query stall. It was already disconnected for the comparisons below. This is
a host display condition, not a software speedup; no permanent display policy or
automatic backend fallback was introduced.

## Native comparison

The same hosts and display configuration were used for three v0.22.32 baseline
and three v0.22.33 candidate runs. udesk26 is Linux amd64, 1920x1280; orange is
Linux arm64, 1920x1080. Each run uses 100 alternating physical pointer moves,
1920 maximum dimension, 15 FPS and original pixels. A separate DRM exporter
observes the matching cursor position. The released service uses a private Unix
socket; no network hop, browser decoding or client drawing is in this endpoint.

Each version uses its own compiled protocol client. The comparison helper's
`candidate` label denotes its current-protocol path in both sets, not the version
under measurement. The old-protocol path cannot attach to these services.

Values are milliseconds, empirical P95 for each of three rounds.

| Host and version | Input receipt | Matching DRM feedback |
| --- | --- | --- |
| udesk26 v0.22.32 | 3.699 / 4.194 / 3.696 | 17.659 / 17.692 / 18.118 |
| udesk26 v0.22.33 | 7.655 / 7.191 / 10.015 | 16.946 / 17.094 / 17.039 |
| orange v0.22.32 | 5.060 / 6.750 / 5.678 | 5.498 / 6.523 / 6.035 |
| orange v0.22.33 | 11.566 / 12.063 / 14.842 | 8.907 / 7.869 / 11.809 |

The matching DRM endpoint is below 100 ms in all rounds. The 10 ms input-receipt
target is not met in every candidate round; do not claim that receipts improved.
One udesk26 baseline observation reached 5836.531 ms despite its low P95; retain
that outlier. These samples do not quantify client painting or physical scanout.

The five-second capture samples on orange contained 17–18 changed frames in each
version. They are not a static-screen CPU experiment. udesk26 had zero baseline
frames and two candidate frames in the corresponding sample. Neither set proves
a 70% static CPU reduction, and such a claim must not be inferred from them.

## Functional verification

Both hosts passed a real, unprivileged native attachment, current-frame admission,
retired-generation rejection and input teardown. Both passed rapid ASCII,
Chinese, emoji and following Enter against a task-owned GTK document; the target
checks document contents rather than accepting a clipboard receipt as success.

The final udesk26 GNOME-locker test captured the lock screen, rejected ordinary
input, kept an invalid physical credential locked, accepted the correct physical
credential, retired the old generation, rejected unpainted successor input and
restored control after a new frame receipt. Credentials arrive through a pipe
and are absent from arguments, environment and diagnostic output.

The isolated Desktop was built from Redeven `f6c8c1093a62` with published
dependencies and `GOWORK=off`. Its local Runtime listens on 24236. Desktop SSH
started the task-owned udesk26 Runtime on 24246 with its own state directory.
Env App performed scope confirmation and temporary administrator authorization,
updated the installed service to the v0.22.33 service digest and opened the real
Viewer. The Viewer enabled and selected "Use local input method" while clipboard
synchronization remained disabled. No target-side Portal action was performed.

# Boundaries

Browser/Electron Viewer, Wayland and macOS focused qualification, localized panel
coverage, Go package/race/vet and OKF checks cover the changed contract. They do
not replace a real client-presentation performance sample.

The upstream v0.22.33 release qualification passed source, native amd64/arm64,
host-desktop media amd64/arm64, macOS library and private desktop arm64 jobs. Its
private-desktop amd64 job failed twice during component download, at approximately
31 MB of 142.8 MB, before graphical qualification. Keep this external acquisition
failure visible; the release-wide workflow has not passed.

Further real Viewer typing, pointer, lifecycle and presentation measurements
were interrupted when the local Mac locked and the computer-control tool required
manual unlock. This is a retained verification boundary, not successful acceptance.

# Evidence

- Published Floe Native Apps `host_desktop_drm.py`, `hostdesktop/login_service_linux.go`, `hostdesktop/login_seat_linux.go`: capture wakeup and physical-seat authority.
- Published Floe Native Apps `hostdesktop/login_latency_qualification_linux_test.go`, `hostdesktop/login_text_qualification_linux_test.go`, `hostdesktop/login_unlock_qualification_linux_test.go`: opt-in physical-host measurement and document assertions.
- Published Floe Webapp `createRemotePointer` and `createRemoteInput`: bounded motion and explicit physical/text modes.
- `internal/codeapp/appserver/remote_desktop_viewer/viewer.js` and `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs`: product capability integration and local/physical input regression assertions.
- [Native release qualification](https://github.com/floegence/floe-native-apps/actions/runs/37976652415): retained component-download failure and successful owning jobs.
- [RustDesk active-session reads](https://github.com/rustdesk/rustdesk/blob/001b0e96173cea4e49f9f7a67bea95a177dd1de3/src/platform/linux.rs) and [Sunshine ordered input dispatch](https://github.com/LizardByte/Sunshine/blob/899095522a9ed50bb511d6f1fd103b8ad716d527/src/input.cpp): pinned reference implementations used for architectural comparison.

Raw host logs and captured test material remain in task artifacts outside the
repository. They contain neither host passwords nor diagnostic input contents.
