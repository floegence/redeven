---
type: Qualification Record
title: Physical desktop responsiveness and local input
description: Assess the physical-seat input and DRM capture changes on orange and udesk26, separating native feedback from client presentation.
tags: [desktop, input, drm, latency, qualification]
timestamp: 2026-10-09T19:42:00Z
---
# Summary

Floe Native Apps v0.22.33 and Floe Webapp v0.86.11 add idle capture wakeup,
bounded pointer submission and local text mode. The [media contract](../architecture/remote-desktop-media.md)
owns privileged authority; the [viewer contract](../architecture/remote-desktop-viewer.md)
owns input modes. Locks remain physical-only, and mode changes revoke input.
This qualification separates DRM feedback, document contents and presentation.
Native receipts do not establish visible response or input-to-photon latency.

# Contract

## Diagnosis and implementation

The Viewer incorrectly coupled local text to clipboard synchronization. The
explicit `text_input` capability separates them. Local characters use ordered
text transfer; shortcuts remain physical. Fresh physical-seat checks gate both
selection transfer and its paste gesture. Credentials never use this path.

The first idle interaction now wakes DRM capture. Continuous input retains the
frame-rate budget. The upstream pointer owner keeps one latest pending position
and flushes before buttons, wheel, text and keys.

The review used RustDesk `001b0e96173cea4e49f9f7a67bea95a177dd1de3`
(`src/platform/linux.rs`) and Sunshine
`899095522a9ed50bb511d6f1fd103b8ad716d527` (`src/input.cpp`), dated 2026-10-09.
Their active-UID reads and ordered motion batching support avoiding hot-path
subprocesses. Redeven retains live seat checks and its existing owners; no source
was copied.

Disabling orange's unused HDMI-A-1 output removed approximately 500 ms kernel
connector/EDID-query stalls. That host condition was fixed before both comparison
versions; no software speedup or permanent display-policy change is claimed.

## Native comparison

Three baseline and candidate runs each use 100 physical pointer moves, 1920
maximum dimension, 15 FPS and original pixels. udesk26 is amd64 at 1920x1280;
orange is arm64 at 1920x1080. A separate exporter observes matching DRM cursor
positions. The private Unix socket endpoint excludes network and browser work.

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

DRM P95 is below 100 ms in every round; some candidate receipt P95s exceed 10 ms.
Receipts did not improve. One udesk26 baseline observation reached 5836.531 ms.
These samples do not quantify client painting or physical scanout.

Five-second samples have 17–18 changed orange frames, and zero baseline/two
candidate udesk26 frames. They do not establish a 70% static CPU reduction.

## Functional verification

Both hosts passed a real, unprivileged native attachment, current-frame admission,
retired-generation rejection and input teardown. Both passed rapid ASCII,
Chinese, emoji and following Enter against a task-owned GTK document; the target
checks document contents rather than accepting a clipboard receipt as success.

The final orange and udesk26 GNOME-locker tests captured the lock screen, rejected ordinary
input, kept an invalid physical credential locked, accepted the correct physical
credential, retired the old generation, rejected unpainted successor input and
restored control after a new frame receipt. Credentials arrive through a pipe
and are absent from arguments, environment and diagnostic output.

## Idle desktop response

Released protocol clients run the same displays at 60 FPS and original pixels.
A task-owned GTK window toggles black/white on Space. Three connections each
contain twelve samples with 850 ms idle. Ordered H.264 decoding verifies center
pixels; the endpoint is matching encoded-packet arrival, excluding network and
browser presentation. Orange decoder components were extracted into a temporary
directory from its configured package source, without system installation.

Values are median / P95 milliseconds for each round.

| Host and version | Round 1 | Round 2 | Round 3 |
| --- | --- | --- | --- |
| udesk26 v0.22.32 | 86.283 / 193.823 | 76.856 / 192.253 | 73.528 / 98.269 |
| udesk26 v0.22.33 | 73.765 / 94.790 | 62.772 / 84.435 | 50.607 / 89.433 |
| orange v0.22.32 | 241.530 / 267.476 | 255.642 / 282.653 | 246.081 / 257.422 |
| orange v0.22.33 | 96.195 / 265.283 | 100.704 / 274.402 | 103.856 / 224.087 |

Orange's median improves by 58–61%; its first input on a new connection retains
a slow tail. Separate instrumented debugging runs identify that boundary: GTK
receives Space within 3–16 ms and its own center pixel is white within about
40 ms, while the captured primary DRM framebuffer remains black. The framebuffer
ID changes about 190 ms later, then conversion sees white and encoding takes
about 33–42 ms. Capture wakes immediately and keeps sampling. This does not yet
distinguish compositor submission from display-plane selection, nor establish
physical scanout timing. No GPU-cache change or driver installation was made.

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

After rebasing onto local main, Go package/race/vet, the X11/Wayland/macOS browser
Viewer fixtures, 96 panel/localization tests, UI lint/typecheck, Desktop typecheck,
published dependency locks/notices and the Env App build passed. The new Electron
fixture run timed out at native fullscreen while the Mac was locked; it must pass
again after manual unlock. This failure was not hidden by a retry or weakened test.

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
