---
type: Qualification Record
title: Physical desktop responsiveness and local input
description: Assess the physical-seat input and DRM capture changes on orange and udesk26, separating native feedback from client presentation.
tags: [desktop, input, drm, latency, qualification]
timestamp: 2026-10-09T20:40:52Z
---
# Summary

Floe Native Apps v0.22.33 and Floe Webapp v0.86.15 add idle capture wakeup,
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
retired-generation rejection and input teardown. udesk26 passed rapid ASCII,
Chinese, emoji and following Enter against a task-owned GTK document; the target
checks document contents rather than accepting a clipboard receipt as success.
Orange completed the same native qualification before its later Flowersec
transport disconnect; that disconnect prevents treating the current live Viewer
session as a complete client qualification.

The published native qualification passed the GNOME-locker path on both hosts:
it captured the lock screen, rejected ordinary input, kept an invalid physical
credential locked, accepted the correct physical credential, retired the old
generation, rejected unpainted successor input and restored control after a new
frame receipt. The current live udesk26 Viewer also passed the lock screen,
cancel path, ordinary-input fencing, invalid credential retention and successful
unlock through physical key events. The host's `cn`/IBus layout required the
physical shifted-symbol key path; after the accepted credential the old
generation was retired and a new desktop frame restored ordinary control.
Credentials arrive through a pipe and are absent from arguments, environment
and diagnostic output.

The current live orange Viewer was opened through the Desktop SSH flow after
the host service was installed. It displayed the real desktop, delivered a
control-mode pointer click and wheel event to the host application, accepted
the `Use local input method` selection while clipboard synchronization stayed
disabled, and reconnected successfully after an explicit disconnect. This is
client interaction evidence; it does not claim a physical input-to-photon
measurement. Orange's network path still showed 21--184 ms RTT variation in
the earlier run, so a stable end-to-end latency claim remains out of scope.

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

Three additional ordinary-window rounds retain median / P95 values of
111.870 / 262.390, 106.663 / 265.567 and 106.118 / 261.526 ms. Waiting three
seconds before the first input instead of 850 ms retains 206.165, 269.847 and
213.358 ms first responses; subsequent samples range from 76.051 to 120.169 ms.
Fullscreen presentation and initial window settling therefore do not explain
the remaining tail by themselves. A separate three-second Xorg ioctl sample
observed no call longer than 1 ms, despite repeated display-detection log entries.
That sample does not establish Xorg query stalls as the retained cause. The
temporary decoder closure was removed and the original target fixture restored.

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
not replace a real client-presentation performance sample or a physical
input-to-photon measurement. The orange live Viewer path remains sensitive to
the host network variation described above.

After rebasing onto local main, Go package/race/vet, the X11/Wayland/macOS browser
Viewer fixtures, 96 panel/localization tests, UI lint/typecheck, Desktop typecheck,
published dependency locks/notices and the Env App build passed. After preserving
local main's Floe Webapp v0.86.12 Env App dependency, its typecheck, 96 panel and
localization tests, build, X11 Viewer fixture, OKF and notice verification passed
again. The three affected Go packages and all 46 Desktop SSH/runtime deployment
tests also passed on that combined dependency tip. The Electron fixture was
rerun after the Mac was unlocked and passed; its log is the current viewer
evidence. This does not replace a real client-presentation latency sample.

The upstream v0.22.33 release qualification passed source, native amd64/arm64,
host-desktop media amd64/arm64, macOS library and private desktop amd64/arm64 jobs,
including its final release gate. The private-desktop amd64 job initially failed
twice during component download, at approximately 31 MB of 142.8 MB. Rerunning
the failed job against the same immutable tag completed acquisition and all
graphical checks; no downloader change or new release was used to recover it.

The orange live Viewer later disconnected with Flowersec `operation_failed` while
the host's measured network RTT varied from 21 to 184 ms. The current orange
session therefore cannot support a stable end-to-end latency claim. The udesk26
Viewer has complete local-text, pointer, cursor, lock-screen UI, cancel and
invalid-credential evidence, while valid-credential entry remains the layout
boundary described above. Client-to-photon latency was not measured.

# Evidence

- Published Floe Native Apps `host_desktop_drm.py`, `hostdesktop/login_service_linux.go`, `hostdesktop/login_seat_linux.go`: capture wakeup and physical-seat authority.
- Published Floe Native Apps `hostdesktop/login_latency_qualification_linux_test.go`, `hostdesktop/login_text_qualification_linux_test.go`, `hostdesktop/login_unlock_qualification_linux_test.go`: opt-in physical-host measurement and document assertions.
- Published Floe Webapp `createRemotePointer` and `createRemoteInput`: bounded motion, explicit physical/text modes and modifier preservation when the remote surface gains focus.
- `internal/codeapp/appserver/remote_desktop_viewer/viewer.js` and `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs`: product capability integration and local/physical input regression assertions.
- [Native release qualification](https://github.com/floegence/floe-native-apps/actions/runs/37976652415): successful release gate and owning jobs, including recovery of the component-download interruption.
- [RustDesk active-session reads](https://github.com/rustdesk/rustdesk/blob/001b0e96173cea4e49f9f7a67bea95a177dd1de3/src/platform/linux.rs) and [Sunshine ordered input dispatch](https://github.com/LizardByte/Sunshine/blob/899095522a9ed50bb511d6f1fd103b8ad716d527/src/input.cpp): pinned reference implementations used for architectural comparison.

Raw host logs and captured test material remain in task artifacts outside the
repository. They contain neither host passwords nor diagnostic input contents.
